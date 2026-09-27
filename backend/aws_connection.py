"""
aws_connection.py — AWS cross-account connection services for InfraGenie.

Architecture
────────────
Two service classes handle all AWS interaction:

  AWSSTSService
    Low-level wrapper around boto3 STS.  Handles AssumeRole and
    GetCallerIdentity.  Never stores credentials — callers use the
    returned session in-memory and discard it.

  AWSConnectionService
    Business logic layer:
      • generate_external_id()          — crypto-random UUID v4
      • generate_cloudformation_template() — parameterised CFN YAML/JSON
      • validate_role_arn()             — structural + account-ID checks
      • create_connection()             — DB record, status=PENDING
      • verify_connection()             — AssumeRole → GetCallerIdentity
                                          → EC2 DescribeRegions → CONNECTED
      • list_connections()              — user-scoped, safe metadata only
      • disconnect()                    — soft-delete (status=DISCONNECTED)

TESTING / PROTOTYPE NOTE
────────────────────────
The CloudFormation template produced by generate_cloudformation_template()
attaches the AWS managed policy AdministratorAccess to DevOpsIQExecutionRole.

THIS IS INTENTIONAL FOR THE PROTOTYPE / TESTING PHASE ONLY.
After the full deployment workflow has been validated, replace
AdministratorAccess with a custom least-privilege policy containing only
the IAM actions that DevOpsIQ actually calls.

The template is structured so the permission attachment is isolated in a
dedicated "Permissions" section — search for "TESTING ONLY" to find the
exact lines to swap out when hardening for production.

SECURITY INVARIANTS
───────────────────
• Temporary STS credentials (AccessKeyId / SecretAccessKey / SessionToken)
  are NEVER written to the database, logs, or API responses.
• The External ID is stored in the database but is NEVER returned in the
  "list connections" API response — it is only exposed at connection-setup
  time so the user can embed it in the CloudFormation template.
• All DB queries are scoped to the authenticated user's ID (multi-tenant).
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import boto3
import botocore.exceptions
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from models import CloudAccount, CloudAccountStatus

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

ROLE_NAME = "DevOpsIQExecutionRole"
ROLE_SESSION_NAME = "DevOpsIQSession"

# Regex for a syntactically valid IAM role ARN.
# Groups: (partition, account_id, role_name)
_ARN_RE = re.compile(
    r"^arn:(aws|aws-cn|aws-us-gov):iam::(\d{12}):role/(.+)$"
)

# AWS regions accepted by the UI.  Extend as DevOpsIQ supports more regions.
VALID_REGIONS: set[str] = {
    "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
    "ap-southeast-1", "ap-southeast-2",
    "us-east-1", "us-east-2", "us-west-1", "us-west-2",
    "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
    "ca-central-1", "sa-east-1",
    "me-south-1", "af-south-1",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)   # naive UTC, matches DB convention


def _mask(value: str, keep: int = 4) -> str:
    """Return a masked version of a sensitive string for safe logging."""
    if len(value) <= keep:
        return "****"
    return value[:keep] + "****"


# ── AWSSTSService ─────────────────────────────────────────────────────────────

class AWSSTSService:
    """
    Low-level AWS STS wrapper.

    All methods are synchronous (boto3 is synchronous).  Call them from
    FastAPI route handlers using asyncio.to_thread() if needed, or simply
    call them directly — the network latency is typically < 1 s.

    SECURITY: This class never logs AccessKeyId (beyond a short prefix),
    SecretAccessKey, or SessionToken.
    """

    def assume_role(
        self,
        *,
        role_arn: str,
        external_id: str,
        session_name: str = ROLE_SESSION_NAME,
        duration_seconds: int = 900,   # 15 minutes — minimum allowed by AWS
    ) -> boto3.Session:
        """
        Call AWS STS AssumeRole and return a boto3 Session loaded with the
        returned temporary credentials.

        Parameters
        ──────────
        role_arn        ARN of the IAM role to assume in the customer account.
        external_id     Must match the ExternalId condition in the role's trust
                        policy.  Prevents the confused-deputy attack.
        session_name    Human-readable label visible in CloudTrail.
        duration_seconds Lifetime of the temporary credentials (900 – 43200 s).

        Returns
        ───────
        boto3.Session   Pre-loaded with the temporary credentials.
                        Use this session for all subsequent API calls.

        Raises
        ──────
        AWSConnectionError  Wraps any boto3/botocore exception with a
                            human-readable message.
        """
        logger.info(
            "[AWS-STS] AssumeRole attempt | role=%s | session=%s",
            role_arn, session_name,
        )
        sts_client = boto3.client("sts", region_name=settings.aws_default_region)
        try:
            response = sts_client.assume_role(
                RoleArn=role_arn,
                RoleSessionName=session_name,
                ExternalId=external_id,
                DurationSeconds=duration_seconds,
            )
        except botocore.exceptions.ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            logger.warning(
                "[AWS-STS] AssumeRole FAILED | role=%s | error_code=%s | message=%s",
                role_arn, error_code, exc.response["Error"]["Message"],
            )
            raise AWSConnectionError.from_client_error(exc) from exc
        except botocore.exceptions.NoCredentialsError as exc:
            logger.error("[AWS-STS] No credentials configured for DevOpsIQ backend: %s", exc)
            raise AWSConnectionError(
                "DevOpsIQ backend has no AWS credentials configured. "
                "Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or use an instance role.",
                error_code="NoCredentials",
            ) from exc
        except Exception as exc:
            logger.exception("[AWS-STS] AssumeRole unexpected error | role=%s", role_arn)
            raise AWSConnectionError(
                f"Unexpected error during AssumeRole: {exc}",
                error_code="UnknownError",
            ) from exc

        creds = response["Credentials"]
        # Log only a masked prefix — never log the full secret key or token.
        logger.info(
            "[AWS-STS] AssumeRole SUCCESS | role=%s | key_prefix=%s | expiry=%s",
            role_arn,
            _mask(creds["AccessKeyId"]),
            creds["Expiration"].isoformat(),
        )

        # Build a session from the temporary credentials.
        # DO NOT store creds anywhere — use this session in-memory only.
        session = boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=settings.aws_default_region,
        )
        return session

    def get_caller_identity(self, session: boto3.Session) -> dict:
        """
        Call STS GetCallerIdentity using the provided session.

        Returns the raw AWS response dict:
          { "Account": "...", "UserId": "...", "Arn": "..." }

        Raises AWSConnectionError on failure.
        """
        try:
            sts = session.client("sts")
            identity = sts.get_caller_identity()
            logger.info(
                "[AWS-STS] GetCallerIdentity | account=%s | arn=%s",
                identity.get("Account"), identity.get("Arn"),
            )
            return identity
        except botocore.exceptions.ClientError as exc:
            logger.warning("[AWS-STS] GetCallerIdentity FAILED: %s", exc)
            raise AWSConnectionError.from_client_error(exc) from exc
        except Exception as exc:
            logger.exception("[AWS-STS] GetCallerIdentity unexpected error")
            raise AWSConnectionError(f"GetCallerIdentity failed: {exc}", error_code="UnknownError") from exc

    def describe_regions(self, session: boto3.Session, region: str) -> list[dict]:
        """
        Call EC2 DescribeRegions as a harmless read-only connectivity test.

        Uses the customer-region for the EC2 endpoint — proves that the
        temporary credentials are valid AND that the target region is
        accessible.

        Returns a list of region dicts on success.
        Raises AWSConnectionError on failure.
        """
        try:
            ec2 = session.client("ec2", region_name=region)
            response = ec2.describe_regions(AllRegions=False)
            regions = response.get("Regions", [])
            logger.info(
                "[AWS-EC2] DescribeRegions SUCCESS | region=%s | count=%d",
                region, len(regions),
            )
            return regions
        except botocore.exceptions.ClientError as exc:
            logger.warning("[AWS-EC2] DescribeRegions FAILED: %s", exc)
            raise AWSConnectionError.from_client_error(exc) from exc
        except Exception as exc:
            logger.exception("[AWS-EC2] DescribeRegions unexpected error")
            raise AWSConnectionError(f"EC2 DescribeRegions failed: {exc}", error_code="UnknownError") from exc


# ── AWSConnectionService ──────────────────────────────────────────────────────

class AWSConnectionService:
    """
    High-level service for the full AWS account connection lifecycle.

    Every method that touches the database takes an AsyncSession argument —
    sessions are owned by the FastAPI route handlers (dependency injection)
    and are NOT created inside this service.

    Multi-tenancy: every DB query is scoped by user_id so one user can never
    read or modify another user's cloud account records.
    """

    def __init__(self) -> None:
        self._sts = AWSSTSService()

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def generate_external_id() -> str:
        """
        Return a cryptographically random UUID v4 to use as the External ID.

        Requirements:
        - Unique per customer connection.
        - Not predictable / not based on the AWS Account ID.
        - Not hardcoded.
        - Stored in cloud_accounts.external_id; never returned in list APIs.
        """
        return str(uuid.uuid4())

    @staticmethod
    def validate_region(region: str) -> None:
        if region not in VALID_REGIONS:
            raise ValueError(
                f"Unsupported region '{region}'. "
                f"Supported: {', '.join(sorted(VALID_REGIONS))}"
            )

    @staticmethod
    def validate_role_arn(role_arn: str, expected_account_id: str) -> None:
        """
        Structural and semantic validation of a customer-supplied Role ARN.

        Checks:
        1. Matches ARN syntax.
        2. Is an IAM role ARN (not a user, group, etc.).
        3. Account ID in the ARN matches the stored account_id.
        4. Role name is the expected DevOpsIQExecutionRole (configurable).

        Raises ValueError with a descriptive message on any failure.
        """
        m = _ARN_RE.match(role_arn)
        if not m:
            raise ValueError(
                "Invalid Role ARN format. Expected: "
                "arn:aws:iam::<account_id>:role/<role_name>"
            )
        arn_account_id = m.group(2)
        arn_role_name = m.group(3)

        if arn_account_id != expected_account_id:
            raise ValueError(
                f"ARN account ID '{arn_account_id}' does not match the "
                f"registered AWS Account ID '{expected_account_id}'."
            )

        expected_role = settings.aws_role_name   # DevOpsIQExecutionRole
        if arn_role_name != expected_role:
            raise ValueError(
                f"Unexpected role name '{arn_role_name}'. "
                f"DevOpsIQ expects the role to be named '{expected_role}'."
            )

    # ── CloudFormation template ───────────────────────────────────────────────

    @staticmethod
    def generate_cloudformation_template(
        devopsiq_account_id: str,
        external_id: str,
        role_name: str = ROLE_NAME,
    ) -> dict:
        """
        Generate a parameterised AWS CloudFormation template (JSON) that
        creates the cross-account IAM role in the customer's AWS account.

        The template is returned as a Python dict (JSON-serialisable).

        Parameters
        ──────────
        devopsiq_account_id
            The AWS Account ID where DevOpsIQ is running.  Used to restrict
            the trust policy so ONLY DevOpsIQ can assume the role.
        external_id
            The unique External ID generated for this connection.  Embedded
            as the sts:ExternalId condition in the trust policy.
        role_name
            The name for the IAM role.  Defaults to DevOpsIQExecutionRole.

        TESTING-ONLY PERMISSION
        ───────────────────────
        The Policies section attaches AdministratorAccess.
        This is INTENTIONAL for prototype/testing to validate the end-to-end
        workflow without permission failures.

        TO MIGRATE TO PRODUCTION:
        Replace the ManagedPolicyArns entry
            arn:aws:iam::aws:policy/AdministratorAccess
        with your custom least-privilege policy ARN, e.g.:
            arn:aws:iam::<DEVOPSIQ_ACCOUNT_ID>:policy/DevOpsIQLeastPrivilegePolicy

        Search for "TESTING ONLY" in this file to find all relevant places.
        """
        return {
            "AWSTemplateFormatVersion": "2010-09-09",
            "Description": (
                "DevOpsIQ Cross-Account IAM Role. "
                "Creates DevOpsIQExecutionRole that trusts the DevOpsIQ AWS account "
                "and uses the External ID condition to prevent confused-deputy attacks. "
                "NOTE: AdministratorAccess is attached for TESTING ONLY. "
                "Replace with a least-privilege policy before production use."
            ),
            "Parameters": {
                "DevOpsIQAccountId": {
                    "Type": "String",
                    "Default": devopsiq_account_id,
                    "Description": "AWS Account ID where DevOpsIQ backend is running.",
                },
                "ExternalId": {
                    "Type": "String",
                    "Default": external_id,
                    "Description": (
                        "Unique External ID generated by DevOpsIQ for this connection. "
                        "Must match the value stored in DevOpsIQ."
                    ),
                },
                "RoleName": {
                    "Type": "String",
                    "Default": role_name,
                    "Description": "Name for the cross-account IAM role.",
                },
            },
            "Resources": {
                "DevOpsIQExecutionRole": {
                    "Type": "AWS::IAM::Role",
                    "Properties": {
                        "RoleName": {"Ref": "RoleName"},
                        "Description": (
                            "Cross-account role assumed by DevOpsIQ to manage "
                            "infrastructure in this AWS account."
                        ),
                        # ── Trust policy ──────────────────────────────────────
                        # ONLY the DevOpsIQ AWS account may assume this role,
                        # AND only when it supplies the correct External ID.
                        # Do NOT change Principal to "*" — that would allow any
                        # AWS account to assume this role.
                        "AssumeRolePolicyDocument": {
                            "Version": "2012-10-17",
                            "Statement": [
                                {
                                    "Sid": "AllowDevOpsIQAssumeRole",
                                    "Effect": "Allow",
                                    "Principal": {
                                        "AWS": {
                                            "Fn::Sub": (
                                                "arn:aws:iam::${DevOpsIQAccountId}:root"
                                            )
                                        }
                                    },
                                    "Action": "sts:AssumeRole",
                                    "Condition": {
                                        "StringEquals": {
                                            "sts:ExternalId": {"Ref": "ExternalId"}
                                        }
                                    },
                                }
                            ],
                        },
                        # ── Permissions ───────────────────────────────────────
                        # TESTING ONLY — AdministratorAccess is intentionally
                        # broad so the complete deployment workflow can be
                        # validated without permission failures.
                        #
                        # PRODUCTION MIGRATION:
                        # Replace the AdministratorAccess ARN below with the ARN
                        # of your custom DevOpsIQLeastPrivilegePolicy.  That
                        # policy should contain only the IAM actions that
                        # DevOpsIQ actually calls (EC2, EKS, S3, IAM read,
                        # CloudFormation, etc.).  Create the policy AFTER the
                        # complete deployment workflow is tested so you know the
                        # exact set of actions needed.
                        "ManagedPolicyArns": [
                            "arn:aws:iam::aws:policy/AdministratorAccess"
                            # TESTING ONLY ↑ — replace with least-privilege ARN in production
                        ],
                        "Tags": [
                            {"Key": "ManagedBy", "Value": "DevOpsIQ"},
                            {"Key": "Purpose", "Value": "CrossAccountAccess"},
                            {"Key": "ExternalId", "Value": {"Ref": "ExternalId"}},
                            {
                                "Key": "PermissionNote",
                                "Value": (
                                    "AdministratorAccess-TESTING-ONLY-"
                                    "replace-with-least-privilege-in-production"
                                ),
                            },
                        ],
                    },
                }
            },
            "Outputs": {
                "RoleArn": {
                    "Description": "ARN of the DevOpsIQ cross-account IAM role.",
                    "Value": {"Fn::GetAtt": ["DevOpsIQExecutionRole", "Arn"]},
                    "Export": {"Name": {"Fn::Sub": "${AWS::StackName}-RoleArn"}},
                },
                "RoleName": {
                    "Description": "Name of the DevOpsIQ cross-account IAM role.",
                    "Value": {"Ref": "DevOpsIQExecutionRole"},
                },
            },
        }

    # ── Database operations ───────────────────────────────────────────────────

    async def create_connection(
        self,
        *,
        db: AsyncSession,
        user_id: uuid.UUID,
        account_id: str,
        region: str,
    ) -> CloudAccount:
        """
        Validate inputs, generate an External ID, persist a PENDING cloud
        account record, and emit an audit log entry.

        Returns the newly created CloudAccount ORM instance.
        """
        self.validate_region(region)

        external_id = self.generate_external_id()

        record = CloudAccount(
            user_id=user_id,
            provider="AWS",
            account_id=account_id,
            external_id=external_id,
            region=region,
            status=CloudAccountStatus.pending,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        logger.info(
            "[AUDIT] aws_connection.created | user=%s | account=%s | connection=%s",
            user_id, account_id, record.id,
        )
        return record

    async def get_connection(
        self,
        *,
        db: AsyncSession,
        connection_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> CloudAccount:
        """
        Load a cloud account record, enforcing user-scoped access.
        Raises ValueError if not found or access is denied.
        """
        res = await db.execute(
            select(CloudAccount).where(
                CloudAccount.id == connection_id,
                CloudAccount.user_id == user_id,
            )
        )
        record = res.scalar_one_or_none()
        if record is None:
            raise ValueError("Cloud account connection not found.")
        return record

    async def list_connections(
        self,
        *,
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> list[CloudAccount]:
        """
        Return all cloud accounts for the authenticated user.
        Safe: does NOT include external_id or any credentials.
        """
        res = await db.execute(
            select(CloudAccount)
            .where(CloudAccount.user_id == user_id)
            .order_by(CloudAccount.created_at.desc())
        )
        return list(res.scalars().all())

    async def verify_connection(
        self,
        *,
        db: AsyncSession,
        connection_id: uuid.UUID,
        user_id: uuid.UUID,
        role_arn: str,
    ) -> CloudAccount:
        """
        Full end-to-end verification:
          1. Load and validate the cloud account record.
          2. Validate Role ARN format and account-ID match.
          3. Set status = VERIFYING.
          4. Call STS AssumeRole (using stored External ID).
          5. Call STS GetCallerIdentity → verify returned account ID.
          6. Call EC2 DescribeRegions → confirm API access.
          7. Mark status = CONNECTED.
          8. Set last_verified_at.

        On any failure, set status = FAILED and store the error message.

        Returns the updated CloudAccount ORM instance.
        """
        record = await self.get_connection(
            db=db, connection_id=connection_id, user_id=user_id
        )

        # Validate ARN before touching AWS
        try:
            self.validate_role_arn(role_arn, record.account_id)
        except ValueError as exc:
            record.status = CloudAccountStatus.failed
            record.connection_error = str(exc)
            record.updated_at = _utcnow()
            await db.commit()
            raise

        # Persist role ARN and set VERIFYING
        record.role_arn = role_arn
        record.status = CloudAccountStatus.verifying
        record.connection_error = None
        record.updated_at = _utcnow()
        await db.commit()

        logger.info(
            "[AUDIT] aws_connection.assume_role_attempt | user=%s | account=%s | role=%s",
            user_id, record.account_id, role_arn,
        )

        try:
            # ── Step 1: AssumeRole ────────────────────────────────────────────
            session = self._sts.assume_role(
                role_arn=role_arn,
                external_id=record.external_id,
                session_name=f"{ROLE_SESSION_NAME}-{str(record.id)[:8]}",
            )
            logger.info(
                "[AUDIT] aws_connection.assume_role_success | user=%s | account=%s",
                user_id, record.account_id,
            )

            # ── Step 2: GetCallerIdentity ─────────────────────────────────────
            identity = self._sts.get_caller_identity(session)
            returned_account = identity.get("Account", "")
            if returned_account != record.account_id:
                raise AWSConnectionError(
                    f"AWS account ID mismatch: expected '{record.account_id}' "
                    f"but STS returned '{returned_account}'. "
                    "Verify you used the correct AWS account.",
                    error_code="AccountMismatch",
                )
            logger.info(
                "[AUDIT] aws_connection.identity_verified | user=%s | account=%s | arn=%s",
                user_id, returned_account, identity.get("Arn"),
            )

            # ── Step 3: EC2 DescribeRegions (harmless read-only test) ─────────
            self._sts.describe_regions(session, record.region)

            # ── Mark CONNECTED ────────────────────────────────────────────────
            record.status = CloudAccountStatus.connected
            record.connection_error = None
            record.last_verified_at = _utcnow()
            record.updated_at = _utcnow()
            await db.commit()
            await db.refresh(record)

            logger.info(
                "[AUDIT] aws_connection.verified | user=%s | account=%s | connection=%s",
                user_id, record.account_id, record.id,
            )
            return record

        except AWSConnectionError as exc:
            record.status = CloudAccountStatus.failed
            record.connection_error = exc.message
            record.updated_at = _utcnow()
            await db.commit()
            logger.warning(
                "[AUDIT] aws_connection.verify_failed | user=%s | account=%s | error=%s",
                user_id, record.account_id, exc.error_code,
            )
            raise
        except Exception as exc:
            record.status = CloudAccountStatus.failed
            record.connection_error = f"Unexpected error: {exc}"
            record.updated_at = _utcnow()
            await db.commit()
            logger.exception(
                "[AUDIT] aws_connection.verify_error | user=%s | account=%s",
                user_id, record.account_id,
            )
            raise AWSConnectionError(
                f"Verification failed: {exc}", error_code="UnknownError"
            ) from exc

    async def disconnect(
        self,
        *,
        db: AsyncSession,
        connection_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """
        Soft-disconnect: mark the record as DISCONNECTED.

        IMPORTANT: This does NOT delete the IAM role from the customer's AWS
        account.  The user must manually delete the CloudFormation stack
        (named DevOpsIQ-CrossAccount-<account_id>) from their AWS console if
        they want to fully revoke DevOpsIQ's access.

        Why soft-delete?  Deleting the CFN stack from within DevOpsIQ would
        require an additional AssumeRole call and adds risk.  The explicit
        instruction to the user is safer and more transparent.
        """
        record = await self.get_connection(
            db=db, connection_id=connection_id, user_id=user_id
        )
        record.status = CloudAccountStatus.disconnected
        record.updated_at = _utcnow()
        await db.commit()
        logger.info(
            "[AUDIT] aws_connection.disconnected | user=%s | account=%s | connection=%s",
            user_id, record.account_id, record.id,
        )


# ── AWSConnectionError ────────────────────────────────────────────────────────

class AWSConnectionError(Exception):
    """
    Raised by AWSSTSService and AWSConnectionService for all AWS-related
    failures.  Carries both a human-readable message and a machine-readable
    error code so the API layer can map it to appropriate HTTP responses.

    SECURITY: Never include AWS credentials, session tokens, or secret keys
    in the message or error_code fields.
    """

    # Maps botocore ClientError codes → human-readable messages.
    _CODE_MAP: dict[str, str] = {
        "AccessDenied": (
            "AWS role assumption was denied. "
            "Verify the IAM trust policy allows DevOpsIQ's account "
            "and the External ID matches exactly."
        ),
        "AccessDeniedException": (
            "AWS role assumption was denied. "
            "Verify the IAM trust policy allows DevOpsIQ's account "
            "and the External ID matches exactly."
        ),
        "InvalidClientTokenId": "AWS authentication failed. The credentials may be invalid.",
        "ExpiredTokenException": (
            "AWS temporary credentials expired. Please retry the connection."
        ),
        "MalformedPolicyDocument": "The IAM trust policy is invalid.",
        "ValidationError": "The AWS CloudFormation/IAM configuration is invalid.",
        "NoSuchEntity": (
            "DevOpsIQExecutionRole was not found in the customer's account. "
            "Complete the CloudFormation setup first, then click Verify."
        ),
        "EntityAlreadyExists": "The IAM role already exists in the target account.",
        "TokenRefreshRequired": "AWS token refresh required. Please reconnect.",
        "UnauthorizedOperation": (
            "DevOpsIQ is not authorised to perform this operation. "
            "Check the IAM role permissions."
        ),
    }

    def __init__(self, message: str, error_code: str = "AWSError") -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code

    @classmethod
    def from_client_error(cls, exc: botocore.exceptions.ClientError) -> "AWSConnectionError":
        code = exc.response["Error"]["Code"]
        human = cls._CODE_MAP.get(code, f"AWS error: {exc.response['Error']['Message']}")
        return cls(human, error_code=code)


# ── Module-level singletons (import and use directly in routes) ───────────────

aws_connection_service = AWSConnectionService()
aws_sts_service = AWSSTSService()
