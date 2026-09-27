"""
SQLAlchemy ORM + Pydantic schemas for InfraGenie (multi-tenant SaaS shape).

Tables (some added in v3 for the SaaS structure):
  users        — accounts
  organizations — tenant boundary (every project belongs to one org)
  memberships  — user ↔ org with role (owner | admin | developer | viewer)
  projects     — per-tenant project; owner_id is the user who created it
  deployments  — per-project deployment record (created on analysis completion)
  reports      — generated reports (created on deployment completion)
  audit_log    — every privileged action (login, project analysis, deploy approval)
"""
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, List, Optional

from sqlalchemy import (
    String, Text, DateTime, Boolean, ForeignKey, Integer,
    JSON, Enum as SAEnum, Index, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pydantic import BaseModel, EmailStr, field_serializer, field_validator
import enum

from config import settings


def serialize_utc_datetime(v: Optional[datetime]) -> Optional[str]:
    if v is None:
        return None
    if v.tzinfo is None:
        return v.isoformat() + "Z"
    return v.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

# ── Async engine ──────────────────────────────────────────────────────────────

async_engine: AsyncEngine = create_async_engine(
    settings.database_url.replace("postgresql://", "postgresql+asyncpg://"),
    echo=False,
)
AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=async_engine, expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """Create any missing tables, then add v3 columns via IF NOT EXISTS ALTERs
    (idempotent — safe to re-run on every startup)."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user'"))
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_org_id UUID"))
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS logs JSON"))
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID"))
        await conn.execute(text(
            "ALTER TABLE projects ADD COLUMN IF NOT EXISTS detailed_analysis JSON"))
        await conn.execute(text(
            "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS org_id UUID"))
        await conn.execute(text(
            "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS duration_seconds INTEGER"))
        await conn.execute(text(
            "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS artifact_dir VARCHAR(500)"))
        # Cloud accounts table (AWS cross-account connection)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cloud_accounts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id),
                provider VARCHAR(20) NOT NULL DEFAULT 'AWS',
                account_id VARCHAR(20) NOT NULL,
                role_arn VARCHAR(300),
                external_id VARCHAR(100) NOT NULL,
                region VARCHAR(50) NOT NULL DEFAULT 'ap-south-1',
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                connection_error TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                last_verified_at TIMESTAMP
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_cloud_accounts_user_provider "
            "ON cloud_accounts (user_id, provider)"
        ))
        # Remove subscription-related columns and table (idempotent)
        await conn.execute(text(
            "DROP TABLE IF EXISTS subscriptions CASCADE"))
        await conn.execute(text(
            "ALTER TABLE organizations DROP COLUMN IF EXISTS plan"))
        await conn.execute(text(
            "ALTER TABLE organizations DROP COLUMN IF EXISTS plan_seats"))
        await conn.execute(text(
            "ALTER TABLE organizations DROP COLUMN IF EXISTS plan_projects"))
        await conn.execute(text(
            "ALTER TABLE organizations DROP COLUMN IF EXISTS plan_deployments_per_month"))


# ── Enums ─────────────────────────────────────────────────────────────────────

class ProjectStatus(str, enum.Enum):
    pending = "pending"
    analyzing = "analyzing"
    ready = "ready"
    deploying = "deploying"
    deployed = "deployed"
    failed = "failed"


class DeploymentStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"
    awaiting_approval = "awaiting_approval"


class OrgRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    developer = "developer"
    viewer = "viewer"


# ── ORM Models ────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user")
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    current_org_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)

    projects: Mapped[List["Project"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    memberships: Mapped[List["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)

    memberships: Mapped[List["Membership"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    projects: Mapped[List["Project"]] = relationship(back_populates="organization")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (Index("ix_membership_user_org", "user_id", "org_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default=OrgRole.viewer.value)
    invited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    joined_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    source_type: Mapped[Optional[str]] = mapped_column(String(50), default="upload")
    github_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[Optional[ProjectStatus]] = mapped_column(SAEnum(ProjectStatus), default=ProjectStatus.pending)

    # AI-generated analysis (subjective, augmented by LLM)
    analysis_result: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Deterministic static analysis (no LLM required — runs from repo files alone).
    # This is the field the SaaS UI surfaces as "Project Overview / Framework / etc."
    detailed_analysis: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Generated deployment plan (Dockerfile / Terraform / K8s / CI / etc.)
    deployment_plan: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Real-time agent log lines
    logs: Mapped[Optional[List[dict[str, Any]]]] = mapped_column(JSON, nullable=True, default=list)

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    org_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner: Mapped["User"] = relationship(back_populates="projects")
    organization: Mapped[Optional["Organization"]] = relationship(back_populates="projects")
    deployments: Mapped[List["Deployment"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    reports: Mapped[List["Report"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    org_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    status: Mapped[Optional[DeploymentStatus]] = mapped_column(SAEnum(DeploymentStatus), default=DeploymentStatus.pending)
    environment: Mapped[Optional[str]] = mapped_column(String(100), default="production")
    artifacts: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    agent_logs: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    artifact_dir: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="deployments")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    deployment_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("deployments.id", ondelete="SET NULL"), nullable=True)
    report_type: Mapped[Optional[str]] = mapped_column(String(100))
    content: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    insights: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="reports")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    target_type: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class CloudAccountStatus(str, enum.Enum):
    pending = "PENDING"
    verifying = "VERIFYING"
    connected = "CONNECTED"
    failed = "FAILED"
    disconnected = "DISCONNECTED"


class CloudAccount(Base):
    """
    Stores a user's connected cloud account (currently AWS only).

    Security notes:
    - external_id is the cryptographically random UUID we generate and hand to
      the customer so they can embed it in their IAM trust policy.  This prevents
      the "confused deputy" attack.
    - role_arn is supplied by the user AFTER they create the CloudFormation stack.
    - We NEVER store AWS access keys, secret keys, or STS session tokens here.
      Temporary credentials obtained via AssumeRole are used in-memory only and
      discarded after each API call.
    - user_id is always validated so User A can never see User B's accounts.
    """
    __tablename__ = "cloud_accounts"
    __table_args__ = (
        Index("ix_cloud_accounts_user_provider", "user_id", "provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="AWS")
    account_id: Mapped[str] = mapped_column(String(20), nullable=False)
    role_arn: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    region: Mapped[str] = mapped_column(String(50), nullable=False, default="ap-south-1")
    status: Mapped[CloudAccountStatus] = mapped_column(
        SAEnum(CloudAccountStatus), nullable=False, default=CloudAccountStatus.pending
    )
    connection_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship("User")


class AgentConfig(Base):
    """Per-user enable/disable state + run stats for a pipeline agent."""

    __tablename__ = "agent_configs"
    __table_args__ = (
        Index("ix_agent_config_user_agent", "user_id", "agent_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(100), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    runs: Mapped[int] = mapped_column(Integer, default=0)
    successes: Mapped[int] = mapped_column(Integer, default=0)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    role: str = "user"
    org_name: Optional[str] = None  # only used when role == "organization"

    @field_validator("role")
    @classmethod
    def validate_signup_role(cls, v: str) -> str:
        allowed = {"user", "organization"}
        if v not in allowed:
            raise ValueError("role must be 'user' or 'organization'")
        return v


class EmailOtpRequest(BaseModel):
    email: EmailStr


class EmailOtpVerify(BaseModel):
    email: EmailStr
    otp: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    role: str
    is_active: bool
    current_org_id: Optional[uuid.UUID] = None
    created_at: datetime

    @field_serializer('created_at', mode='plain')
    def serialize_created_at(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    current_org: Optional["OrganizationOut"] = None


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    source_type: str = "upload"
    github_url: Optional[str] = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    source_type: str
    github_url: Optional[str]
    status: ProjectStatus
    analysis_result: Optional[dict]
    detailed_analysis: Optional[dict]
    deployment_plan: Optional[dict]
    logs: Optional[list] = []
    created_at: datetime
    updated_at: datetime

    @field_serializer('created_at', 'updated_at', mode='plain')
    def serialize_dates(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class DeploymentOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    status: DeploymentStatus
    environment: str
    artifacts: Optional[dict]
    agent_logs: Optional[dict]
    approved_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    duration_seconds: Optional[int]
    artifact_dir: Optional[str]
    created_at: datetime

    @field_serializer('approved_at', 'started_at', 'completed_at', 'created_at', mode='plain')
    def serialize_dates(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class ReportOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    deployment_id: Optional[uuid.UUID]
    report_type: str
    content: Optional[dict]
    insights: Optional[str]
    created_at: datetime

    @field_serializer('created_at', mode='plain')
    def serialize_created_at(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class ApproveDeployment(BaseModel):
    approved: bool


class AgentConfigUpdate(BaseModel):
    enabled: bool


# ── v3 SaaS schemas ───────────────────────────────────────────────────────────

class OrganizationCreate(BaseModel):
    name: str
    slug: Optional[str] = None


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime

    @field_serializer('created_at', mode='plain')
    def serialize_created_at(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class MembershipOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: str
    joined_at: Optional[datetime]

    @field_serializer('joined_at', mode='plain')
    def serialize_joined_at(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class MembershipInvite(BaseModel):
    email: EmailStr
    # Allowed roles for invited team members (signup roles are not valid here)
    role: str = OrgRole.developer.value

    @field_validator("role")
    @classmethod
    def validate_invite_role(cls, v: str) -> str:
        allowed = {OrgRole.admin.value, OrgRole.developer.value, OrgRole.viewer.value}
        if v not in allowed:
            raise ValueError(f"role must be one of: {', '.join(sorted(allowed))}")
        return v


class AuditLogOut(BaseModel):
    id: uuid.UUID
    actor_id: Optional[uuid.UUID]
    action: str
    target_type: Optional[str]
    target_id: Optional[str]
    metadata_json: Optional[dict]
    created_at: datetime

    @field_serializer('created_at', mode='plain')
    def serialize_created_at(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


# ── Cloud Account schemas ─────────────────────────────────────────────────────

class CloudAccountConnect(BaseModel):
    """Request body for POST /api/cloud/aws/connect"""
    account_id: str
    region: str = "ap-south-1"

    @field_validator("account_id")
    @classmethod
    def validate_aws_account_id(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped.isdigit() or len(stripped) != 12:
            raise ValueError("AWS Account ID must be exactly 12 digits")
        return stripped

    @field_validator("region")
    @classmethod
    def validate_region(cls, v: str) -> str:
        # Basic sanity check; full list validated in service layer
        if not v.strip():
            raise ValueError("Region is required")
        return v.strip()


class CloudAccountVerify(BaseModel):
    """Request body for POST /api/cloud/aws/{connection_id}/verify"""
    role_arn: str

    @field_validator("role_arn")
    @classmethod
    def validate_arn(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("arn:aws:iam::"):
            raise ValueError("role_arn must be a valid IAM role ARN (arn:aws:iam::...)")
        return v


class CloudAccountOut(BaseModel):
    """Safe representation — NEVER includes credentials or the external_id."""
    id: uuid.UUID
    provider: str
    account_id: str
    role_arn: Optional[str]
    region: str
    status: CloudAccountStatus
    connection_error: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]
    last_verified_at: Optional[datetime]

    @field_serializer("created_at", "updated_at", "last_verified_at", mode="plain")
    def serialize_dates(self, v: Optional[datetime]) -> Optional[str]:
        return serialize_utc_datetime(v)

    class Config:
        from_attributes = True


class CloudAccountConnectResponse(BaseModel):
    """Returned after POST /api/cloud/aws/connect — includes setup info."""
    connection_id: uuid.UUID
    provider: str
    account_id: str
    region: str
    external_id: str        # needed by the user to embed in CloudFormation
    role_name: str
    status: CloudAccountStatus
    devopsiq_account_id: str
    cloudformation_template: dict   # the full CFN template as JSON


TokenResponse.model_rebuild()