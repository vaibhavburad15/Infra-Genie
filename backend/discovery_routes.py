"""
discovery_routes.py — AWS Infrastructure Discovery API for Infra Genie.

Endpoints
─────────
  POST  /api/cloud/aws/{connection_id}/discover
        Trigger a full discovery run on a CONNECTED AWS account.
        Runs boto3 calls in a thread pool, persists results to DB.
        Returns the complete structured discovery result.

  GET   /api/cloud/aws/{connection_id}/discover
        Return the last cached discovery result without re-running AWS calls.
        Returns 404 if no discovery has been run yet.

  GET   /api/cloud/aws/{connection_id}/discover/summary
        Return only the lightweight summary counts (vpc_count, ec2_count, etc.)
        for the last discovery. Fast — no AWS calls.

Security
────────
• Every endpoint requires a valid JWT (same _require_user pattern as
  cloud_routes.py and agent_routes.py — inlined to avoid circular imports).
• DB queries are always scoped to current_user.id.
• The full discovery result may contain internal network topology; it is
  only returned to the authenticated owner of the connection.

Architecture note
─────────────────
Discovery is deterministic — no LLM involved here. The AWSDiscoveryService
calls read-only AWS APIs and returns structured JSON. The LLM receives this
JSON as environment context during Deployment Planning (Step 6).
"""

import logging
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import get_db, User, CloudAccount, CloudAccountStatus
from aws_connection import AWSConnectionError
from aws_discovery import aws_discovery_service
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cloud", tags=["aws-discovery"])

# ── Auth (inlined — same pattern as cloud_routes.py) ─────────────────────────
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def _require_user(
    token: str = Depends(_oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    cred_exc = HTTPException(
        status_code=401,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        uid = payload.get("sub")
        if not isinstance(uid, str):
            raise cred_exc
    except JWTError:
        raise cred_exc
    res = await db.execute(select(User).where(User.id == uid))
    u = res.scalar_one_or_none()
    if u is None or not u.is_active:
        raise cred_exc
    return u


# ── POST /api/cloud/aws/{connection_id}/discover ──────────────────────────────

@router.post(
    "/aws/{connection_id}/discover",
    summary="Run AWS infrastructure discovery",
    description=(
        "Triggers a full read-only scan of the connected AWS account. "
        "Discovers VPCs, subnets, security groups, EC2, EKS, RDS, S3, "
        "load balancers, ECR, and IAM roles. Results are stored in the DB "
        "and returned immediately. The account must be in CONNECTED status."
    ),
)
async def run_discovery(
    connection_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Trigger a full AWS infrastructure discovery scan.

    This endpoint:
    1. Verifies the connection is CONNECTED and owned by the current user.
    2. Assumes the cross-account IAM role to get temporary credentials.
    3. Calls all read-only AWS Describe/List APIs in a thread pool.
    4. Persists the structured result to cloud_accounts.discovery_result.
    5. Returns the complete discovery result.

    All AWS calls are read-only — nothing is created, modified, or deleted.

    Typical runtime: 5–20 seconds depending on account size.
    """
    try:
        result = await aws_discovery_service.run_discovery(
            db=db,
            connection_id=connection_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except AWSConnectionError as exc:
        return JSONResponse(
            status_code=_aws_error_to_http_status(exc.error_code),
            content={
                "status": "FAILED",
                "error_code": exc.error_code,
                "message": exc.message,
            },
        )
    except Exception as exc:
        logger.exception(
            "[DISCOVERY] Unexpected error | connection=%s | user=%s",
            connection_id, current_user.id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Discovery failed: {str(exc)}",
        )

    logger.info(
        "[AUDIT] aws_discovery.completed | user=%s | connection=%s | vpcs=%d | ec2=%d",
        current_user.id, connection_id,
        len(result.get("vpcs", [])),
        len(result.get("ec2_instances", [])),
    )

    return {
        "status": "SUCCESS",
        "connection_id": str(connection_id),
        "discovered_at": result.get("discovered_at"),
        "result": result,
    }


# ── GET /api/cloud/aws/{connection_id}/discover ───────────────────────────────

@router.get(
    "/aws/{connection_id}/discover",
    summary="Get last discovery result",
    description=(
        "Returns the most recent cached discovery result without making "
        "any AWS API calls. Returns 404 if no discovery has been run yet."
    ),
)
async def get_discovery_result(
    connection_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Return cached discovery result.

    Does NOT re-run any AWS API calls — returns whatever was stored
    during the last POST /discover run.
    """
    record = await _get_account_for_user(db, connection_id, current_user.id)

    if not record.discovery_result:
        raise HTTPException(
            status_code=404,
            detail=(
                "No discovery result found for this connection. "
                "Run POST /discover first."
            ),
        )

    return {
        "status": "SUCCESS",
        "connection_id": str(connection_id),
        "discovered_at": (
            record.discovery_ran_at.isoformat() + "Z"
            if record.discovery_ran_at else None
        ),
        "result": record.discovery_result,
    }


# ── GET /api/cloud/aws/{connection_id}/discover/summary ───────────────────────

@router.get(
    "/aws/{connection_id}/discover/summary",
    summary="Get discovery summary counts",
    description=(
        "Returns lightweight counts from the last discovery run "
        "(vpc_count, ec2_instance_count, eks_cluster_count, etc.) "
        "without returning the full resource details. "
        "Returns 404 if no discovery has been run yet."
    ),
)
async def get_discovery_summary(
    connection_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Return only the summary section of the last discovery result.

    Fast lightweight endpoint — ideal for dashboard widgets.
    """
    record = await _get_account_for_user(db, connection_id, current_user.id)

    if not record.discovery_result:
        raise HTTPException(
            status_code=404,
            detail=(
                "No discovery result found for this connection. "
                "Run POST /discover first."
            ),
        )

    summary = record.discovery_result.get("summary", {})
    return {
        "status": "SUCCESS",
        "connection_id": str(connection_id),
        "account_id": record.account_id,
        "region": record.region,
        "discovered_at": (
            record.discovery_ran_at.isoformat() + "Z"
            if record.discovery_ran_at else None
        ),
        "summary": summary,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_account_for_user(
    db: AsyncSession,
    connection_id: _uuid.UUID,
    user_id,
) -> CloudAccount:
    """Load a cloud account scoped to the authenticated user."""
    res = await db.execute(
        select(CloudAccount).where(
            CloudAccount.id == connection_id,
            CloudAccount.user_id == user_id,
        )
    )
    record = res.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Cloud account connection not found.")
    return record


def _aws_error_to_http_status(error_code: str) -> int:
    mapping = {
        "AccessDenied": 403,
        "AccessDeniedException": 403,
        "UnauthorizedOperation": 403,
        "InvalidClientTokenId": 401,
        "ExpiredTokenException": 401,
        "TokenRefreshRequired": 401,
        "NoSuchEntity": 404,
        "AccountMismatch": 400,
        "ValidationError": 400,
    }
    return mapping.get(error_code, 500)
