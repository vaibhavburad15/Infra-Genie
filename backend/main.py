"""
InfraGenie - FastAPI Backend (multi-tenant SaaS shape).

Routes:
  Auth     : /auth/{register, login, me, email-otp/{request, verify}}
  Orgs     : /orgs (list/create), /orgs/{id}, /orgs/{id}/members, /orgs/{id}/switch
  Audit    : /audit-log
  Subscr.  : /subscription/me, /subscription/change
  Projects : /projects (CRUD, upload, analyze)
  Deploys  : /projects/{pid}/deployments, /deployments/{did}/approve
  Reports  : /projects/{pid}/reports
  Metrics  : /metrics/overview   (for Monitoring / Security / Cost / etc.)
  AI       : POST /stream/insights (SSE), /projects/{pid}/logs/stream (SSE)

v3 changes highlighted with `# v3` comments.
"""
import os
import signal
import sys
import smtplib
import secrets
import shutil
import asyncio
import json as _json
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional, TypedDict
from uuid import UUID

from fastapi import (FastAPI, Depends, HTTPException, UploadFile, File, Request)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy import func as sqlfunc
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings
from models import (
    init_db, get_db,
    User, Organization, Membership, Subscription, Project, Deployment,
    Report, AuditLog,
    UserCreate, UserOut, TokenResponse, EmailOtpRequest, EmailOtpVerify,
    ProjectCreate, ProjectOut, DeploymentOut, ReportOut, ApproveDeployment,
    OrganizationCreate, OrganizationOut, MembershipOut, MembershipInvite,
    AuditLogOut,
    ProjectStatus, DeploymentStatus, OrgRole, PlanTier,
)
from tasks import get_queue, get_redis_conn, task_analyze_project, task_run_deployment
from llm import chat_stream


def _exit_gracefully(signum, frame):
    try: sys.exit(0)
    except SystemExit: pass

for _sig in (signal.SIGINT, signal.SIGTERM):
    try: signal.signal(_sig, _exit_gracefully)
    except Exception: pass


app = FastAPI(title="InfraGenie API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173",
                   "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# Uploaded archives go OUTSIDE the watched source tree so uvicorn --reload
# never sees writes here (default ~/uploads; override via INFRA_UPLOAD_DIR).
UPLOAD_DIR = settings.resolved_upload_dir
UPLOAD_DIR.mkdir(exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
ADMIN_CONTACT_MESSAGE = ("Admin accounts cannot be created from registration. "
                         "Contact Vaibhav or Raj for admin access.")
SELF_SERVICE_ROLES = {"user", "developer", "devops_engineer"}


class EmailOtpEntry(TypedDict):
    otp: str
    expires_at: datetime
    verified: bool


EMAIL_OTP_STORE: dict[str, EmailOtpEntry] = {}


@app.on_event("startup")
async def startup():
    await init_db()


# ── Helpers ───────────────────────────────────────────────────────────────────

def hash_password(p: str) -> str: return pwd_context.hash(p)
def verify_password(plain: str, hashed: str) -> bool: return pwd_context.verify(plain, hashed)
def normalize_email(e: str) -> str: return e.strip().lower()
def create_email_otp() -> str: return f"{secrets.randbelow(1_000_000):06d}"


def create_access_token(data: dict) -> str:
    to_encode = dict(data)
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=["HS256"])


def store_email_otp(email: str, otp: str) -> None:
    EMAIL_OTP_STORE[normalize_email(email)] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=settings.email_otp_expire_minutes),
        "verified": False,
    }


def get_valid_otp_entry(email: str) -> Optional[EmailOtpEntry]:
    k = normalize_email(email)
    e = EMAIL_OTP_STORE.get(k)
    if not e: return None
    if e["expires_at"] < datetime.utcnow():
        EMAIL_OTP_STORE.pop(k, None)
        return None
    return e


def send_email_otp(email: str, otp: str) -> None:
    if not settings.smtp_host:
        print(f"[OTP] {email}: {otp}")
        return
    msg = EmailMessage()
    msg["Subject"] = "Infra Genie verification code"
    msg["From"] = settings.smtp_from_email or settings.smtp_username or "no-reply@infragenie.io"
    msg["To"] = email
    msg.set_content(
        f"Your Infra Genie verification code is {otp}. "
        f"It expires in {settings.email_otp_expire_minutes} minutes."
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
        if settings.smtp_use_tls:
            s.starttls()
        uname = settings.smtp_username or settings.smtp_from_email
        if uname and settings.smtp_password:
            s.login(uname, settings.smtp_password.replace(" ", ""))
        s.send_message(msg)


# ── v3 SaaS membership helpers ────────────────────────────────────────────────

async def require_user(token: str = Depends(oauth2_scheme),
                       db: AsyncSession = Depends(get_db)) -> User:
    cred_exc = HTTPException(401, "Invalid credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_access_token(token)
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


async def resolve_current_org(user: User, db: AsyncSession) -> Organization:
    """Pick the user's current_org_id if valid, otherwise their first membership,
    otherwise create a personal org on the fly (so a fresh user always has one)."""
    if user.current_org_id:
        res = await db.execute(select(Organization).where(
            Organization.id == user.current_org_id))
        if (org := res.scalar_one_or_none()) is not None:
            return org
    member_res = await db.execute(
        select(Membership).where(Membership.user_id == user.id).limit(1))
    first = member_res.scalar_one_or_none()
    if first is not None:
        org_res = await db.execute(select(Organization).where(Organization.id == first.org_id))
        org = org_res.scalar_one_one() if False else org_res.scalar_one_or_none()
        if org is not None:
            user.current_org_id = org.id
            await db.commit()
            return org
    # bootstrap a personal org
    slug = (user.username + "-" + secrets.token_hex(4)).lower()
    org = Organization(
        name=f"{user.username}'s workspace",
        slug=slug, plan=PlanTier.free.value,
        plan_seats=1, plan_projects=3, plan_deployments_per_month=10,
    )
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=user.id, org_id=org.id, role=OrgRole.owner.value, joined_at=datetime.utcnow()))
    db.add(Subscription(org_id=org.id, plan=PlanTier.free.value, status="active"))
    user.current_org_id = org.id
    await db.commit()
    await db.refresh(org)
    return org


async def get_current_user_with_org(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user),
):
    return current_user


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.post("/auth/email-otp/request", tags=["auth"])
async def request_email_otp(payload: EmailOtpRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    otp = create_email_otp()
    store_email_otp(payload.email, otp)
    try:
        send_email_otp(payload.email, otp)
    except smtplib.SMTPAuthenticationError:
        EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
        raise HTTPException(400, "SMTP auth failed; check SMTP_USERNAME/SMTP_PASSWORD "
                                 "and use a Gmail app password without spaces.")
    except smtplib.SMTPException as exc:
        EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
        raise HTTPException(400, f"Unable to send OTP email: {exc}")
    resp = {"message": "OTP sent", "expires_in_minutes": settings.email_otp_expire_minutes}
    if not settings.smtp_host:
        resp["dev_otp"] = otp
    return resp


@app.post("/auth/email-otp/verify", tags=["auth"])
async def verify_email_otp(payload: EmailOtpVerify):
    e = get_valid_otp_entry(payload.email)
    if not e:
        raise HTTPException(400, "OTP expired or not requested")
    if str(e.get("otp")) != payload.otp.strip():
        raise HTTPException(400, "Invalid OTP")
    e["verified"] = True
    return {"message": "Email verified"}


@app.post("/auth/register", response_model=TokenResponse, tags=["auth"])
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    role = (payload.role or "user").strip().lower()
    if role == "admin":
        raise HTTPException(403, ADMIN_CONTACT_MESSAGE)
    if role not in SELF_SERVICE_ROLES:
        raise HTTPException(400, "Invalid role selected")
    e = get_valid_otp_entry(payload.email)
    if not e or not e.get("verified"):
        raise HTTPException(400, "Verify your email OTP before creating an account")
    if (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    if (await db.execute(select(User).where(User.username == payload.username))).scalar_one_or_none():
        raise HTTPException(400, "Username already taken")
    user = User(email=payload.email, username=payload.username,
                hashed_password=hash_password(payload.password), role=role)
    db.add(user)
    await db.flush()
    # v3: bootstrap a personal org + owner membership for the new user
    org_name = (payload.org_name or f"{user.username}'s workspace").strip()
    slug = (org_name + "-" + secrets.token_hex(4)).replace(" ", "-").lower()
    org = Organization(name=org_name, slug=slug, plan=PlanTier.free.value,
                       plan_seats=1, plan_projects=3, plan_deployments_per_month=10)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=user.id, org_id=org.id,
                      role=OrgRole.owner.value, joined_at=datetime.utcnow()))
    db.add(Subscription(org_id=org.id, plan=PlanTier.free.value, status="active"))
    user.current_org_id = org.id
    await db.commit()
    await db.refresh(user)
    await db.refresh(org)
    EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user),
                         current_org=OrganizationOut.model_validate(org))


@app.post("/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == form_data.username))
    u = res.scalar_one_or_none()
    if not u or not verify_password(form_data.password, u.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    org = await resolve_current_org(u, db)
    # audit the login
    db.add(AuditLog(actor_id=u.id, org_id=org.id,
                    action="user.login", target_type="user",
                    target_id=str(u.id)))
    await db.commit()
    return TokenResponse(access_token=create_access_token({"sub": str(u.id)}),
                         user=UserOut.model_validate(u),
                         current_org=OrganizationOut.model_validate(org))


@app.get("/auth/me", response_model=UserOut, tags=["auth"])
async def get_me(current_user: User = Depends(require_user)):
    return UserOut.model_validate(current_user)


# ── v3 Org / Member / Audit / Subscription routes ────────────────────────────

@app.get("/orgs", response_model=List[OrganizationOut], tags=["orgs"])
async def list_orgs(current_user: User = Depends(require_user),
                    db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Organization)
        .join(Membership, Membership.org_id == Organization.id)
        .where(Membership.user_id == current_user.id))
    return res.scalars().all()


@app.post("/orgs", response_model=OrganizationOut, tags=["orgs"])
async def create_org(payload: OrganizationCreate,
                     current_user: User = Depends(require_user),
                     db: AsyncSession = Depends(get_db)):
    base = (payload.name or "").strip()
    if not base:
        raise HTTPException(400, "Organization name is required")
    slug = (payload.slug or base).strip().replace(" ", "-").lower()
    slug = "".join(c if c.isalnum() or c in "-_" else "" for c in slug)[:80] or secrets.token_hex(4)
    org = Organization(name=base, slug=slug, plan=PlanTier.free.value,
                       plan_seats=3, plan_projects=10, plan_deployments_per_month=30)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=current_user.id, org_id=org.id,
                      role=OrgRole.owner.value, joined_at=datetime.utcnow()))
    db.add(Subscription(org_id=org.id, plan=PlanTier.free.value, status="active"))
    await db.commit()
    await db.refresh(org)
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="org.create", target_type="org", target_id=str(org.id)))
    await db.commit()
    return OrganizationOut.model_validate(org)


@app.post("/orgs/{org_id}/switch", tags=["orgs"])
async def switch_org(org_id: UUID, current_user: User = Depends(require_user),
                    db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Membership).where(
        Membership.user_id == current_user.id,
        Membership.org_id == org_id))
    if not res.scalar_one_or_none():
        raise HTTPException(403, "You are not a member of that organization")
    current_user.current_org_id = org_id
    await db.commit()
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    return {"ok": True, "current_org_id": org_id, "current_org_name": org.name if org else None}


@app.get("/orgs/{org_id}/members", response_model=List[MembershipOut], tags=["orgs"])
async def list_members(org_id: str, current_user: User = Depends(require_user),
                       db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Membership).where(
        Membership.user_id == current_user.id, Membership.org_id == org_id))
    if not res.scalar_one_or_none():
        raise HTTPException(403, "Not a member")
    members = (await db.execute(select(Membership).where(Membership.org_id == org_id))).scalars().all()
    return members


@app.post("/orgs/{org_id}/members/invite", tags=["orgs"])
async def invite_member(org_id: str, payload: MembershipInvite,
                        current_user: User = Depends(require_user),
                        db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Membership).where(
        Membership.user_id == current_user.id, Membership.org_id == org_id))
    m = res.scalar_one_or_none()
    if not m or m.role not in (OrgRole.owner.value, OrgRole.admin.value):
        raise HTTPException(403, "Only owners / admins can invite")
    user_res = await db.execute(select(User).where(User.email == payload.email))
    inv = user_res.scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "User not registered yet (they must register first).")
    existing = (await db.execute(select(Membership).where(
        Membership.user_id == inv.id, Membership.org_id == org_id))).scalar_one_or_none()
    if existing:
        return {"ok": True, "already": True}
    db.add(Membership(user_id=inv.id, org_id=org_id, role=payload.role,
                      joined_at=datetime.utcnow()))
    db.add(AuditLog(org_id=org_id, actor_id=current_user.id,
                    action="org.member.invite", target_type="user",
                    target_id=str(inv.id), metadata_json={"role": payload.role}))
    await db.commit()
    return {"ok": True}


@app.get("/audit-log", response_model=List[AuditLogOut], tags=["audit"])
async def list_audit(limit: int = 100, current_user: User = Depends(require_user),
                     db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(
        select(AuditLog).where(AuditLog.org_id == org.id)
        .order_by(AuditLog.created_at.desc()).limit(min(limit, 500)))
    return res.scalars().all()


@app.get("/subscription/me", tags=["subscription"])
async def my_subscription(current_user: User = Depends(require_user),
                          db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    sub = (await db.execute(select(Subscription).where(Subscription.org_id == org.id))).scalar_one_or_none()
    return {
        "plan": sub.plan if sub else org.plan,
        "status": sub.status if sub else "active",
        "current_period_end": sub.current_period_end if sub else None,
        "seats": org.plan_seats, "projects": org.plan_projects,
        "deployments_per_month": org.plan_deployments_per_month,
    }


# ── Project routes (now scoped by org, with quota check) ─────────────────────

@app.get("/projects", response_model=List[ProjectOut], tags=["projects"])
async def list_projects(current_user: User = Depends(require_user),
                        db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.org_id == org.id).order_by(Project.created_at.desc()))
    return res.scalars().all()


@app.post("/projects", response_model=ProjectOut, tags=["projects"])
async def create_project(payload: ProjectCreate,
                         current_user: User = Depends(require_user),
                         db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    # quota
    count = (await db.execute(select(sqlfunc.count(Project.id)).where(
        Project.org_id == org.id))).scalar_one() or 0
    if org.plan_projects and count >= org.plan_projects:
        raise HTTPException(402, f"Project quota reached for plan '{org.plan}' "
                                 f"({org.plan_projects}). Upgrade in Settings.")
    p = Project(name=payload.name, description=payload.description or "",
                source_type=payload.source_type, github_url=payload.github_url,
                owner_id=current_user.id, org_id=org.id)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="project.create", target_type="project", target_id=str(p.id),
                    metadata_json={"name": p.name, "source_type": p.source_type}))
    await db.commit()
    return p


@app.post("/projects/{project_id}/upload", response_model=ProjectOut, tags=["projects"])
async def upload_project(project_id, file: UploadFile = File(...),
                         current_user: User = Depends(require_user),
                         db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")
    safe_name = Path(file.filename or "upload.zip").name
    dest = UPLOAD_DIR / f"{project_id}_{safe_name}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    p.file_path = str(dest)
    p.source_type = "upload"
    await db.commit()
    await db.refresh(p)
    get_queue().enqueue(task_analyze_project, str(project_id), job_timeout=1800)
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="project.upload", target_type="project", target_id=str(p.id)))
    await db.commit()
    return p


@app.post("/projects/{project_id}/analyze", response_model=ProjectOut, tags=["projects"])
async def analyze_project(project_id,
                          current_user: User = Depends(require_user),
                          db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")
    get_queue().enqueue(task_analyze_project, str(project_id), job_timeout=1800)
    p.status = ProjectStatus.analyzing
    await db.commit()
    await db.refresh(p)
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="project.analyze", target_type="project", target_id=str(p.id)))
    await db.commit()
    return p


@app.get("/projects/{project_id}", response_model=ProjectOut, tags=["projects"])
async def get_project(project_id,
                      current_user: User = Depends(require_user),
                      db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@app.delete("/projects/{project_id}", tags=["projects"])
async def delete_project(project_id,
                         current_user: User = Depends(require_user),
                         db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")
    await db.delete(p)
    await db.commit()
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="project.delete", target_type="project", target_id=str(project_id)))
    await db.commit()
    return {"detail": "deleted"}


# ── Deployment routes ─────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/deployments", response_model=List[DeploymentOut], tags=["deployments"])
async def list_deployments(project_id,
                           current_user: User = Depends(require_user),
                           db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    proj_res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    if not proj_res.scalar_one_or_none():
        raise HTTPException(404, "Project not found")
    res = await db.execute(select(Deployment).where(
        Deployment.project_id == project_id).order_by(Deployment.created_at.desc()))
    return res.scalars().all()


@app.post("/deployments/{deployment_id}/approve", response_model=DeploymentOut, tags=["deployments"])
async def approve_deployment(deployment_id, payload: ApproveDeployment,
                             current_user: User = Depends(require_user),
                             db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Deployment).where(
        Deployment.id == deployment_id, Deployment.org_id == org.id))
    d = res.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Deployment not found")
    if not payload.approved:
        d.status = DeploymentStatus.failed
        await db.commit()
        await db.refresh(d)
        db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                        action="deployment.reject", target_type="deployment",
                        target_id=str(d.id)))
        await db.commit()
        return d
    # ── Deployment execution is not yet implemented ────────────────────────
    # Approving records intent but does NOT queue a job. The deployment stays
    # in awaiting_approval so the frontend can surface the "coming soon" state.
    d.approved_by = current_user.id
    d.approved_at = datetime.utcnow()
    # Leave status as awaiting_approval — real provisioning is not wired up yet.
    db.add(AuditLog(org_id=org.id, actor_id=current_user.id,
                    action="deployment.approve", target_type="deployment",
                    target_id=str(d.id)))
    await db.commit()
    await db.refresh(d)
    return d


# ── Reports + Metrics ─────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/reports", response_model=List[ReportOut], tags=["reports"])
async def list_reports(project_id,
                       current_user: User = Depends(require_user),
                       db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    proj_res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    if not proj_res.scalar_one_or_none():
        raise HTTPException(404, "Project not found")
    res = await db.execute(select(Report).where(
        Report.project_id == project_id).order_by(Report.created_at.desc()))
    return res.scalars().all()


@app.get("/metrics/overview", tags=["metrics"])
async def metrics_overview(current_user: User = Depends(require_user),
                           db: AsyncSession = Depends(get_db)):
    """Real numbers from the database for Monitoring/Security/Cost/Infrastructure
    sidebar pages (no more "coming soon")."""
    org = await resolve_current_org(current_user, db)
    projects = (await db.execute(select(Project).where(Project.org_id == org.id))).scalars().all()
    deployments = (await db.execute(select(Deployment).where(Deployment.org_id == org.id))).scalars().all()
    reports = (await db.execute(
        select(Report).join(Project, Project.id == Report.project_id)
        .where(Project.org_id == org.id))).scalars().all()

    p_total = len(projects)
    p_deployed = sum(1 for p in projects if p.status == ProjectStatus.deployed)
    p_failed = sum(1 for p in projects if p.status == ProjectStatus.failed)
    p_analyzing = sum(1 for p in projects if p.status == ProjectStatus.analyzing)

    d_total = len(deployments)
    d_success = sum(1 for d in deployments if d.status == DeploymentStatus.success)
    d_failed = sum(1 for d in deployments if d.status == DeploymentStatus.failed)
    d_running = sum(1 for d in deployments if d.status == DeploymentStatus.running)

    durations = [d.duration_seconds for d in deployments
                 if d.duration_seconds is not None and d.duration_seconds > 0]
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0

    # Language / framework spread across the org
    lang_count: dict[str, int] = {}
    fw_count: dict[str, int] = {}
    has_db = 0
    has_docker = 0
    for p in projects:
        det = p.detailed_analysis or {}
        s = det.get("summary", {})
        lang = s.get("primary_language")
        if lang: lang_count[lang] = lang_count.get(lang, 0) + 1
        fw = s.get("primary_framework")
        if fw: fw_count[fw] = fw_count.get(fw, 0) + 1
        if det.get("has_database_hint"): has_db += 1
        if det.get("has_dockerfile"): has_docker += 1

    return {
        "projects": {"total": p_total, "deployed": p_deployed,
                     "failed": p_failed, "analyzing": p_analyzing},
        "deployments": {"total": d_total, "success": d_success,
                        "failed": d_failed, "running": d_running,
                        "avg_duration_seconds": avg_duration},
        "languages": sorted(
            [{"name": k, "count": v} for k, v in lang_count.items()],
            key=lambda x: -x["count"]),
        "frameworks": sorted(
            [{"name": k, "count": v} for k, v in fw_count.items()],
            key=lambda x: -x["count"]),
        "databases": has_db,
        "with_docker": has_docker,
        "reports_total": len(reports),
        "tier": {"plan": org.plan, "seats": org.plan_seats,
                 "projects": org.plan_projects,
                 "deployments_per_month": org.plan_deployments_per_month},
    }


# ── Streaming AI chat (owner-scoped) ─────────────────────────────────────────

@app.get("/stream/insights", tags=["ai"])
async def stream_insights(project_id: str, question: str,
                          current_user: User = Depends(require_user),
                          db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    if not res.scalar_one_or_none():
        raise HTTPException(404, "Project not found")

    async def generate():
        msgs = [
            {"role": "system", "content":
             "You are InfraGenie - an AI infrastructure expert. Answer questions "
             "about deployment, monitoring, cost, and security for the user's project."},
            {"role": "user", "content": f"Project ID: {project_id}\nQuestion: {question}"},
        ]
        async for chunk in chat_stream(msgs):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Log streaming ─────────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/logs", tags=["projects"])
async def get_project_logs(project_id,
                          current_user: User = Depends(require_user),
                          db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")
    return {"logs": p.logs or []}


@app.get("/projects/{project_id}/logs/stream", tags=["projects"])
async def stream_project_logs(project_id,
                              current_user: User = Depends(require_user),
                              db: AsyncSession = Depends(get_db)):
    """SSE feed of real-time project logs (system / info / success / error / llm).
    `llm` kind is streamed tokens from the running agent pipeline - displayed
    in a distinct copper \"thoughts\" color in the UI so the user can watch the
    model reason in real time. Also forwards {'__structured__: True} lines from
    the static analyzer so the UI can render its results without an extra fetch."""
    org = await resolve_current_org(current_user, db)
    res = await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org.id))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Project not found")

    pid = str(project_id)
    channel = f"project_logs:{pid}"
    initial_logs = list(p.logs or [])
    initial_status = p.status

    async def generate():
        for entry in initial_logs:
            yield f"data: {_json.dumps(entry, default=str)}\n\n"
        if initial_status not in (ProjectStatus.analyzing, ProjectStatus.pending):
            yield f"data: {_json.dumps({'__done__': True, 'status': initial_status})}\n\n"
            return
        r = get_redis_conn()
        pubsub = r.pubsub()
        pubsub.subscribe(channel)
        try:
            TIMEOUT = 600.0; elapsed = 0.0; TICK = 0.3
            while elapsed < TIMEOUT:
                msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0)
                if msg and msg["type"] == "message":
                    raw = msg["data"]
                    if isinstance(raw, bytes): raw = raw.decode()
                    yield f"data: {raw}\n\n"
                    try:
                        parsed = _json.loads(raw)
                        if parsed.get("__done__"):
                            return
                    except Exception:
                        pass
                else:
                    await asyncio.sleep(TICK); elapsed += TICK
                    if int(elapsed) % 15 == 0 and elapsed % 1 < TICK:
                        yield ": keep-alive\n\n"
        finally:
            try: pubsub.unsubscribe(channel); pubsub.close()
            except Exception: pass

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "InfraGenie API v3", "version": "3.0.0"}


# ── Agent registry & configuration API ───────────────────────────────────────
# Imported at the bottom so agent_routes can define its own auth dependency
# without a circular import on main.
from agent_routes import router as agent_router
app.include_router(agent_router)
