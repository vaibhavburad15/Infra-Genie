"""
SQLAlchemy models + Pydantic schemas in one file.
Tables: users, projects, deployments, reports
"""
import uuid
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Column, String, Text, DateTime, Boolean, ForeignKey,
    JSON, Enum as SAEnum, create_engine
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from pydantic import BaseModel, EmailStr
import enum

from config import settings

# ── SQLAlchemy setup ──────────────────────────────────────────────────────────

async_engine = create_async_engine(
    settings.database_url.replace("postgresql://", "postgresql+asyncpg://"),
    echo=False,
)
AsyncSessionLocal = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    source_type = Column(String(50), default="upload")  # upload | github
    github_url = Column(String(500), nullable=True)
    file_path = Column(String(500), nullable=True)
    status = Column(SAEnum(ProjectStatus), default=ProjectStatus.pending)
    analysis_result = Column(JSON, nullable=True)   # AI analysis output
    deployment_plan = Column(JSON, nullable=True)   # Generated plan
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="projects")
    deployments = relationship("Deployment", back_populates="project", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="project", cascade="all, delete-orphan")


class Deployment(Base):
    __tablename__ = "deployments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    status = Column(SAEnum(DeploymentStatus), default=DeploymentStatus.pending)
    environment = Column(String(100), default="production")
    artifacts = Column(JSON, nullable=True)          # Generated Dockerfile, terraform, k8s yamls, etc.
    agent_logs = Column(JSON, nullable=True)         # Per-agent execution logs
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="deployments")


class Report(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    deployment_id = Column(UUID(as_uuid=True), ForeignKey("deployments.id"), nullable=True)
    report_type = Column(String(100))   # monitoring | security | cost | telemetry
    content = Column(JSON, nullable=True)
    insights = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="reports")


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    username: str
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
