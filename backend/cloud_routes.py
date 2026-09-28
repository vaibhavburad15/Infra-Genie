"""
cloud_routes.py — FastAPI router for AWS cloud account connectivity.

Endpoints
─────────
  POST   /api/cloud/aws/connect                 Start connection (generate External ID + CFN template)
  POST   /api/cloud/aws/{connection_id}/verify  Verify via STS AssumeRole
  GET    /api/cloud/aws                         List user's connected AWS accounts
  DELETE /api/cloud/aws/{connection_id}         Disconnect (soft-delete)

Security
────────
• Every endpoint requires a valid JWT (require_user dependency — inlined here
  to avoid a circular import with main.py, same pattern as agent_routes.py).
• DB queries are always scoped to current_user.id — one user CANNOT access
  another user's cloud accounts.
• Temporary STS credentials are used in-memory inside the service layer and
  are NEVER returned to the frontend.
• The external_id is included in the connect response (user needs it for CFN)
  but is NEVER included in list/detail responses.
• Structured error responses use a consistent { status, error_code, message }
  shape so the frontend can render actionable help text.
"""

import logging
import uuid as _uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    get_db,
    User,
    CloudAccountConnect,
    CloudAccountVerify,
    CloudAccountOut,
    CloudAccountConnectResponse,
    CloudAccountStatus,
)
from aws_connection import AWSConnectionError, aws_connection_service
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cloud", tags=["cloud-accounts"])

# ── Auth (inlined to avoid circular import — keep in sync with main.py) ───────
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


# ── POST /api/cloud/aws/connect ───────────────────────────────────────────────

@router.post(
    "/aws/connect",
    response_model=CloudAccountConnectResponse,
    status_code=201,
    summary="Start AWS account connection",
    description=(
        "Validates the AWS Account ID and region, generates a unique External ID, "
        "creates a PENDING cloud account record, and returns the CloudFormation "
        "template the user must deploy in their own AWS account."
    ),
)
async def connect_aws_account(
    payload: CloudAccountConnect,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Step 1 of the connection flow.

    The caller provides their AWS Account ID and preferred region.
    The backend generates a cryptographically random External ID and returns
    a CloudFormation template they should launch in their AWS console.

    The template creates InfraGenieExecutionRole with a trust policy that:
      • Allows ONLY the Infra Genie AWS account to assume the role.
      • Enforces the External ID as a condition (confused-deputy protection).
      • Attaches AdministratorAccess — TESTING ONLY, see template comments.
    """
    try:
        record = await aws_connection_service.create_connection(
            db=db,
            user_id=current_user.id,
            account_id=payload.account_id,
            region=payload.region,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cfn_template = aws_connection_service.generate_cloudformation_template(
        infragenie_account_id=settings.aws_infragenie_account_id,
        external_id=record.external_id,
        role_name=settings.aws_role_name,
    )

    logger.info(
        "[AUDIT] cfn_template.generated | user=%s | account=%s | connection=%s",
        current_user.id, record.account_id, record.id,
    )

    return CloudAccountConnectResponse(
        connection_id=record.id,
        provider="AWS",
        account_id=record.account_id,
        region=record.region,
        external_id=record.external_id,    # needed by the user to embed in CFN
        role_name=settings.aws_role_name,
        status=CloudAccountStatus.pending,
        infragenie_account_id=settings.aws_infragenie_account_id,
        cloudformation_template=cfn_template,
    )


# ── POST /api/cloud/aws/{connection_id}/verify ────────────────────────────────

@router.post(
    "/aws/{connection_id}/verify",
    summary="Verify AWS connection via STS AssumeRole",
    description=(
        "Accepts the Role ARN created by CloudFormation, calls AWS STS AssumeRole, "
        "verifies identity with GetCallerIdentity, tests EC2 DescribeRegions, "
        "and marks the connection CONNECTED on success."
    ),
)
async def verify_aws_connection(
    connection_id: _uuid.UUID,
    payload: CloudAccountVerify,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Step 2 of the connection flow.

    The caller provides the Role ARN output by CloudFormation
    (arn:aws:iam::<account_id>:role/InfraGenieExecutionRole).

    The backend:
      1. Validates the ARN format and confirms account ID matches.
      2. Sets status = VERIFYING.
      3. Calls STS AssumeRole with the stored External ID.
      4. Calls STS GetCallerIdentity to confirm the correct account.
      5. Calls EC2 DescribeRegions as a harmless connectivity test.
      6. Marks status = CONNECTED on success.
      7. Sets status = FAILED with a descriptive error on any failure.

    SECURITY:
    Temporary STS credentials are used in-memory inside the service layer.
    They are NEVER stored in the database or returned in this response.
    """
    try:
        record = await aws_connection_service.verify_connection(
            db=db,
            connection_id=connection_id,
            user_id=current_user.id,
            role_arn=payload.role_arn,
        )
    except ValueError as exc:
        # ARN validation failure — 400
        raise HTTPException(status_code=400, detail=str(exc))
    except AWSConnectionError as exc:
        # Map specific error codes to appropriate HTTP statuses
        http_status = _aws_error_to_http_status(exc.error_code)
        return JSONResponse(
            status_code=http_status,
            content={
                "status": "FAILED",
                "error_code": exc.error_code,
                "message": exc.message,
            },
        )

    return {
        "status": "CONNECTED",
        "account_id": record.account_id,
        "region": record.region,
        "role_arn": record.role_arn,
        "last_verified_at": (
            record.last_verified_at.isoformat() + "Z"
            if record.last_verified_at else None
        ),
        "message": "AWS account connected successfully.",
    }


# ── GET /api/cloud/aws ────────────────────────────────────────────────────────

@router.get(
    "/aws",
    response_model=list[CloudAccountOut],
    summary="List connected AWS accounts",
    description=(
        "Returns metadata for all AWS accounts the authenticated user has connected. "
        "NEVER returns AWS credentials, access keys, or the External ID."
    ),
)
async def list_aws_connections(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Safe metadata only — no credentials, no external_id.

    The response is user-scoped: a user will only ever see their own accounts.
    """
    records = await aws_connection_service.list_connections(
        db=db, user_id=current_user.id
    )
    return [CloudAccountOut.from_orm_with_summary(r) for r in records]


# ── DELETE /api/cloud/aws/{connection_id} ─────────────────────────────────────

@router.delete(
    "/aws/{connection_id}",
    status_code=200,
    summary="Disconnect an AWS account",
    description=(
        "Marks the connection as DISCONNECTED in the Infra Genie database. "
        "Does NOT delete the IAM role from the customer's AWS account — "
        "the user must manually delete the CloudFormation stack to fully "
        "revoke Infra Genie's access."
    ),
)
async def disconnect_aws_account(
    connection_id: _uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(_require_user),
):
    """
    Soft-disconnect.

    This removes Infra Genie's stored credentials reference but does NOT call
    AWS to delete the IAM role.  Instruct the user to delete the
    CloudFormation stack (InfraGenie-CrossAccount-<account_id>) from their
    AWS console if they want to fully revoke access.
    """
    try:
        await aws_connection_service.disconnect(
            db=db,
            connection_id=connection_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "status": "DISCONNECTED",
        "message": (
            "Connection removed from Infra Genie. "
            "To fully revoke access, delete the CloudFormation stack "
            "'InfraGenie-CrossAccount-<your-account-id>' from your AWS console."
        ),
    }


# ── Helper ────────────────────────────────────────────────────────────────────

def _aws_error_to_http_status(error_code: str) -> int:
    """Map AWS error codes to semantically appropriate HTTP status codes."""
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
        "MalformedPolicyDocument": 400,
        "EntityAlreadyExists": 409,
    }
    return mapping.get(error_code, 500)
