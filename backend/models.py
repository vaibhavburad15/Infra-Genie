"""
SQLAlchemy ORM + Pydantic schemas for InfraGenie (multi-tenant SaaS shape).

Tables (some added in v3 for the SaaS structure):
  users        — accounts
  organizations — tenant boundary (every project belongs to one org)
  memberships  — user ↔ org with role (owner | admin | developer | viewer)
  subscriptions — current plan tier per org
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
from pydantic import BaseModel, EmailStr, field_serializer
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


class PlanTier(str, enum.Enum):
    free = "free"
    starter = "starter"
    pro = "pro"
    enterprise = "enterprise"


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
    plan: Mapped[str] = mapped_column(String(50), nullable=False, default=PlanTier.free.value)
    plan_seats: Mapped[Optional[int]] = mapped_column(Integer, default=1)
    plan_projects: Mapped[Optional[int]] = mapped_column(Integer, default=3)
    plan_deployments_per_month: Mapped[Optional[int]] = mapped_column(Integer, default=10)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)

    memberships: Mapped[List["Membership"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    projects: Mapped[List["Project"]] = relationship(back_populates="organization")
    subscription: Mapped[Optional["Subscription"]] = relationship(back_populates="organization", uselist=False)


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


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(String(50), nullable=False, default=PlanTier.pro.value)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    current_period_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization: Mapped["Organization"] = relationship(back_populates="subscription")


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
    deployment_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("deployments.id"), nullable=True)
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


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    role: str = "user"
    org_name: Optional[str] = None  # if present, creates the user as owner of a new org


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


# ── v3 SaaS schemas ───────────────────────────────────────────────────────────

class OrganizationCreate(BaseModel):
    name: str
    slug: Optional[str] = None


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    plan_seats: Optional[int]
    plan_projects: Optional[int]
    plan_deployments_per_month: Optional[int]
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
    role: str = "developer"


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


TokenResponse.model_rebuild()