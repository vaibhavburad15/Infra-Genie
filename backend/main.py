"""
InfraGenie — FastAPI Backend
Routes: /auth, /projects, /deployments, /reports, /stream
"""
import os
import smtplib
import uuid
import shutil
import secrets
import asyncio
import json as _json
from datetime import datetime, timedelta
from email.message import EmailMessage
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
    UserCreate, UserOut, TokenResponse, EmailOtpRequest, EmailOtpVerify,
    ProjectCreate, ProjectOut,
    DeploymentOut, ReportOut, ApproveDeployment,
    ProjectStatus, DeploymentStatus,
)
from tasks import get_queue, get_redis_conn, task_analyze_project, task_run_deployment
from llm import chat_stream

# Install simple signal handlers so subprocesses exit cleanly on Ctrl+C
import signal
import sys

def _exit_gracefully(signum, frame):
    # Use sys.exit to ensure a clean shutdown without an exception traceback
    try:
        sys.exit(0)
    except SystemExit:
        pass

for _sig in (signal.SIGINT, signal.SIGTERM):
    try:
        signal.signal(_sig, _exit_gracefully)
    except Exception:
        # Some platforms may not support signal handling identically; ignore failures
        pass

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
ADMIN_CONTACT_MESSAGE = "Admin accounts cannot be created from registration. Contact Vaibhav or Raj for admin access."
SELF_SERVICE_ROLES = {"user", "developer", "devops_engineer"}
EMAIL_OTP_STORE: dict[str, dict[str, object]] = {}


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


def normalize_email(email: str) -> str:
    return email.strip().lower()


def create_email_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def store_email_otp(email: str, otp: str) -> None:
    EMAIL_OTP_STORE[normalize_email(email)] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=settings.email_otp_expire_minutes),
        "verified": False,
    }


def send_email_otp(email: str, otp: str) -> None:
    if not settings.smtp_host:
        print(f"[OTP] {email}: {otp}")
        return

    message = EmailMessage()
    message["Subject"] = "Infra Genie email verification code"
    message["From"] = settings.smtp_from_email or settings.smtp_username or "no-reply@infragenie.io"
    message["To"] = email
    message.set_content(
        "Your Infra Genie verification code is {otp}. It expires in {minutes} minutes.".format(
            otp=otp,
            minutes=settings.email_otp_expire_minutes,
        )
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        smtp_username = settings.smtp_username or settings.smtp_from_email
        if smtp_username and settings.smtp_password:
            smtp_password = settings.smtp_password.replace(" ", "")
            smtp.login(smtp_username, smtp_password)
        smtp.send_message(message)


def get_valid_otp_entry(email: str) -> Optional[dict[str, object]]:
    email_key = normalize_email(email)
    otp_entry = EMAIL_OTP_STORE.get(email_key)
    if not otp_entry:
        return None

    expires_at = otp_entry.get("expires_at")
    if not isinstance(expires_at, datetime) or expires_at < datetime.utcnow():
        EMAIL_OTP_STORE.pop(email_key, None)
        return None

    return otp_entry


async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not isinstance(user_id, str):
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exc
    return user


# ── Auth routes ───────────────────────────────────────────────────────────────


@app.post("/auth/email-otp/request", tags=["auth"])
async def request_email_otp(payload: EmailOtpRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    otp = create_email_otp()
    store_email_otp(payload.email, otp)
    try:
        send_email_otp(payload.email, otp)
    except smtplib.SMTPAuthenticationError:
        EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
        raise HTTPException(
            status_code=400,
            detail="SMTP authentication failed. Check SMTP_USERNAME and SMTP_PASSWORD, and use a Gmail app password without spaces.",
        )
    except smtplib.SMTPException as exc:
        EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
        raise HTTPException(status_code=400, detail=f"Unable to send OTP email: {exc}")

    response = {
        "message": "OTP sent to your email",
        "expires_in_minutes": settings.email_otp_expire_minutes,
    }
    if not settings.smtp_host:
        response["dev_otp"] = otp
    return response


@app.post("/auth/email-otp/verify", tags=["auth"])
async def verify_email_otp(payload: EmailOtpVerify):
    otp_entry = get_valid_otp_entry(payload.email)
    if not otp_entry:
        raise HTTPException(status_code=400, detail="OTP expired or not requested")

    if str(otp_entry.get("otp")) != payload.otp.strip():
        raise HTTPException(status_code=400, detail="Invalid OTP")

    otp_entry["verified"] = True
    return {"message": "Email verified successfully"}

@app.post("/auth/register", response_model=TokenResponse, tags=["auth"])
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    role = (payload.role or "user").strip().lower()
    if role == "admin":
        raise HTTPException(status_code=403, detail=ADMIN_CONTACT_MESSAGE)
    if role not in SELF_SERVICE_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role selected")

    otp_entry = get_valid_otp_entry(payload.email)
    if not otp_entry or not otp_entry.get("verified"):
        raise HTTPException(status_code=400, detail="Verify your email OTP before creating an account")

    # Check duplicate email/username
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Username already taken")

    user = User(
        email=payload.email,
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)

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

    # Save uploaded file (sanitize the client-supplied filename)
    safe_name = Path(file.filename or "upload.zip").name
    dest = UPLOAD_DIR / f"{project_id}_{safe_name}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    project.file_path = str(dest)
    project.source_type = "upload"
    await db.commit()
    await db.refresh(project)

    # Enqueue analysis (generous job timeout: cloning + slow vLLM + 8 agents)
    q = get_queue()
    q.enqueue(task_analyze_project, str(project_id), job_timeout=1800)

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
    q.enqueue(task_analyze_project, str(project_id), job_timeout=1800)

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
    q.enqueue(task_run_deployment, str(deployment_id), job_timeout=600)

    await db.refresh(deployment)
    return deployment


# ── Reports routes ────────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/reports", response_model=List[ReportOut], tags=["reports"])
async def list_reports(project_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Report).where(Report.project_id == project_id).order_by(Report.created_at.desc()))
    return result.scalars().all()


# ── Streaming AI chat ─────────────────────────────────────────────────────────

@app.get("/stream/insights", tags=["ai"])
async def stream_insights(
    project_id: str,
    question: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream AI insights about a project (owner-only — was previously askable
    for anyone with a JWT and any project id)."""
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid project id")

    result = await db.execute(
        select(Project).where(Project.id == pid, Project.owner_id == current_user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    async def generate():
        messages = [
            {"role": "system", "content": "You are InfraGenie, an AI infrastructure expert. Answer questions about deployment and infrastructure."},
            {"role": "user", "content": f"Project ID: {project_id}\nQuestion: {question}"},
        ]
        async for chunk in chat_stream(messages):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Analysis log streaming ────────────────────────────────────────────────────

@app.get("/projects/{project_id}/logs", tags=["projects"])
async def get_project_logs(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all persisted log lines for a project (for drawer initial load)."""
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    return {"logs": project.logs or []}


@app.get("/projects/{project_id}/logs/stream", tags=["projects"])
async def stream_project_logs(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    SSE stream of real-time agent log lines while a project is being analyzed.

    Protocol:
      data: {"ts":"...","level":"info|success|error|system","agent":"...","message":"..."}
      data: {"__done__": true}   ← signals end of stream

    NOTE: The `db` session injected via Depends(get_db) is closed by FastAPI as
    soon as this route function *returns* — which happens immediately, since
    StreamingResponse(generate(), ...) just wraps a not-yet-started generator.
    The generator itself only runs afterwards, while the response is being
    streamed to the client — by which point `db` is already closed and any
    ORM object loaded from it (like `project`) is detached.

    So: read everything we need from `project` up front, while `db` is still
    alive, and never touch `db` (or `project`) again inside `generate()`.
    """
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    pid = str(project_id)
    channel = f"project_logs:{pid}"

    # Snapshot everything generate() needs into plain values NOW, while `db`
    # is still open. Do not pass `project` itself (an ORM instance bound to
    # this soon-to-be-closed session) into the generator.
    initial_logs = list(project.logs or [])
    initial_status = project.status

    async def generate():
        # First: flush all already-persisted logs (in case the client connected late).
        # Uses the snapshot taken above — no DB access here, so no detached-instance risk.
        for entry in initial_logs:
            yield f"data: {_json.dumps(entry)}\n\n"

        # If analysis already finished, close immediately
        if initial_status not in (ProjectStatus.analyzing, ProjectStatus.pending):
            yield f"data: {_json.dumps({'__done__': True})}\n\n"
            return

        # Subscribe to Redis pub/sub and relay events
        r = get_redis_conn()
        pubsub = r.pubsub()
        pubsub.subscribe(channel)

        try:
            # Keep-alive: yield empty comments every 15 s so proxies don't cut the connection
            TIMEOUT = 600   # max 10 minutes
            elapsed = 0
            TICK = 0.3      # poll interval in seconds

            while elapsed < TIMEOUT:
                msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0)
                if msg and msg["type"] == "message":
                    raw = msg["data"]
                    if isinstance(raw, bytes):
                        raw = raw.decode()
                    yield f"data: {raw}\n\n"
                    try:
                        parsed = _json.loads(raw)
                        if parsed.get("__done__"):
                            return
                    except Exception:
                        pass
                else:
                    await asyncio.sleep(TICK)
                    elapsed += TICK
                    # Send SSE keep-alive comment every 15 s
                    if int(elapsed) % 15 == 0 and elapsed % 1 < TICK:
                        yield ": keep-alive\n\n"
        finally:
            try:
                pubsub.unsubscribe(channel)
                pubsub.close()
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "InfraGenie API"}