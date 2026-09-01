"""
SQLAlchemy models + Pydantic schemas in one file.
Tables: users, projects, deployments, reports
"""
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator, List, Optional

from sqlalchemy import (
    String, Text, DateTime, Boolean, ForeignKey,
    JSON, Enum as SAEnum, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pydantic import BaseModel, EmailStr
import enum

from config import settings

# ── SQLAlchemy setup ──────────────────────────────────────────────────────────

async_engine: AsyncEngine = create_async_engine(
    settings.database_url.replace("postgresql://", "postgresql+asyncpg://"),
    echo=False,
)
AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user'"))
        await conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS logs JSON"))


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


# ── ORM Models ────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="user")
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, default=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    projects: Mapped[List["Project"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    source_type: Mapped[Optional[str]] = mapped_column(
        String(50), default="upload"
    )  # upload | github
    github_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[Optional[ProjectStatus]] = mapped_column(
        SAEnum(ProjectStatus), default=ProjectStatus.pending
    )
    analysis_result: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )  # AI analysis output
    deployment_plan: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )  # Generated plan
    logs: Mapped[Optional[List[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, default=list
    )  # Real-time agent log lines
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    owner: Mapped["User"] = relationship(back_populates="projects")
    deployments: Mapped[List["Deployment"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    reports: Mapped[List["Report"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    status: Mapped[Optional[DeploymentStatus]] = mapped_column(
        SAEnum(DeploymentStatus), default=DeploymentStatus.pending
    )
    environment: Mapped[Optional[str]] = mapped_column(
        String(100), default="production"
    )
    artifacts: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )  # Generated Dockerfile, terraform, k8s yamls, etc.
    agent_logs: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )  # Per-agent execution logs
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    project: Mapped["Project"] = relationship(back_populates="deployments")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    deployment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("deployments.id"), nullable=True
    )
    report_type: Mapped[Optional[str]] = mapped_column(
        String(100)
    )  # monitoring | security | cost | telemetry
    content: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    insights: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=datetime.utcnow
    )

    project: Mapped["Project"] = relationship(back_populates="reports")


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    role: str = "user"


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
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


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
    deployment_plan: Optional[dict]
    logs: Optional[list] = []
    created_at: datetime
    updated_at: datetime

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
    created_at: datetime

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

    class Config:
        from_attributes = True


class ApproveDeployment(BaseModel):
    approved: bool
