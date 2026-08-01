"""
InfraGenie — FastAPI Backend
Routes: /auth, /projects, /deployments, /reports, /stream
"""
import os
import uuid
import shutil
from datetime import datetime, timedelta
from typing import List, Optional
from pathlib import Path

from fastapi import (
    FastAPI, Depends, HTTPException, status, UploadFile, File,
    BackgroundTasks, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings
from models import (
    init_db, get_db,
    User, Project, Deployment, Report,
    UserCreate, UserOut, TokenResponse,
    ProjectCreate, ProjectOut,
    DeploymentOut, ReportOut, ApproveDeployment,
    ProjectStatus, DeploymentStatus,
)
from tasks import get_queue, task_analyze_project, task_run_deployment
from llm import chat_stream

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title="InfraGenie API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


@app.on_event("startup")
async def startup():
    await init_db()


# ── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exc
    return user


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=TokenResponse, tags=["auth"])
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check duplicate email/username
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    user = User(
        email=payload.email,
        username=payload.username,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.from_orm(user))


@app.post("/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.from_orm(user))


@app.get("/auth/me", response_model=UserOut, tags=["auth"])
async def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.from_orm(current_user)


# ── Project routes ────────────────────────────────────────────────────────────

@app.get("/projects", response_model=List[ProjectOut], tags=["projects"])
async def list_projects(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Project).where(Project.owner_id == current_user.id).order_by(Project.created_at.desc()))
    return result.scalars().all()


@app.post("/projects", response_model=ProjectOut, tags=["projects"])
async def create_project(payload: ProjectCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = Project(
        name=payload.name,
        description=payload.description or "",
        source_type=payload.source_type,
        github_url=payload.github_url,
        owner_id=current_user.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@app.post("/projects/{project_id}/upload", response_model=ProjectOut, tags=["projects"])
async def upload_project(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    # Save uploaded file
    dest = UPLOAD_DIR / f"{project_id}_{file.filename}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    project.file_path = str(dest)
    project.source_type = "upload"
    await db.commit()
    await db.refresh(project)

    # Enqueue analysis
    q = get_queue()
    q.enqueue(task_analyze_project, str(project_id), job_timeout=600)

    return project


@app.post("/projects/{project_id}/analyze", response_model=ProjectOut, tags=["projects"])
async def analyze_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger analysis for a GitHub-sourced project."""
    result = await db.execute(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    q = get_queue()
    q.enqueue(task_analyze_project, str(project_id), job_timeout=600)

    project.status = ProjectStatus.analyzing
    await db.commit()
    await db.refresh(project)
    return project


@app.get("/projects/{project_id}", response_model=ProjectOut, tags=["projects"])
async def get_project(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@app.delete("/projects/{project_id}", tags=["projects"])
async def delete_project(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Project).where(Project.id == project_id, Project.owner_id == current_user.id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    await db.delete(project)
    await db.commit()
    return {"detail": "deleted"}


# ── Deployment routes ─────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/deployments", response_model=List[DeploymentOut], tags=["deployments"])
async def list_deployments(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Deployment).where(Deployment.project_id == project_id).order_by(Deployment.created_at.desc()))
    return result.scalars().all()


@app.get("/deployments/{deployment_id}", response_model=DeploymentOut, tags=["deployments"])
async def get_deployment(deployment_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Deployment not found")
    return d


@app.post("/deployments/{deployment_id}/approve", response_model=DeploymentOut, tags=["deployments"])
async def approve_deployment(
    deployment_id: uuid.UUID,
    payload: ApproveDeployment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    deployment = result.scalar_one_or_none()
    if not deployment:
        raise HTTPException(404, "Deployment not found")

    if not payload.approved:
        deployment.status = DeploymentStatus.failed
        await db.commit()
        await db.refresh(deployment)
        return deployment

    # Approve and run
    deployment.status = DeploymentStatus.running
    deployment.approved_by = current_user.id
    deployment.approved_at = datetime.utcnow()
    await db.commit()

    q = get_queue()
    q.enqueue(task_run_deployment, str(deployment_id), job_timeout=300)

    await db.refresh(deployment)
    return deployment


# ── Reports routes ────────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/reports", response_model=List[ReportOut], tags=["reports"])
async def list_reports(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Report).where(Report.project_id == project_id).order_by(Report.created_at.desc()))
    return result.scalars().all()


# ── Streaming AI chat ─────────────────────────────────────────────────────────

@app.get("/stream/insights", tags=["ai"])
async def stream_insights(project_id: str, question: str, current_user: User = Depends(get_current_user)):
    """Stream AI insights about a project."""
    async def generate():
        messages = [
            {"role": "system", "content": "You are InfraGenie, an AI infrastructure expert. Answer questions about deployment and infrastructure."},
            {"role": "user", "content": f"Project ID: {project_id}\nQuestion: {question}"},
        ]
        async for chunk in chat_stream(messages):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "InfraGenie API"}
