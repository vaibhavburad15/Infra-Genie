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
from sqlalchemy import select, delete
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings
from models import (
    init_db, get_db,
    User, Organization, Membership, Project, Deployment, CloudAccount,
    Report, AuditLog,
    UserCreate, UserOut, TokenResponse, EmailOtpRequest, EmailOtpVerify,
    ProjectCreate, ProjectOut, DeploymentOut, ReportOut, ApproveDeployment, DeploymentCreate,
    OrganizationCreate, OrganizationOut, MembershipOut, MembershipInvite,
    AuditLogOut,
    ProjectStatus, DeploymentStatus, CloudAccountStatus, OrgRole,
)
from tasks import get_queue, get_redis_conn, task_analyze_project, task_plan_deployment
from zip_validation import ZipValidationError, validate_zip_stream


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
# Only two roles are available at self-service signup:
#   "user"         — individual user, no organization created
#   "organization" — creates an org and makes the registrant its owner
# All other roles (admin, developer, viewer, devops_engineer) are assigned
# via team invitations only.
SELF_SERVICE_ROLES = {"user", "organization"}


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
    """Return the user's active organization.

    Resolution order:
      1. current_org_id if it points to a valid org the user is a member of.
      2. Their first membership org (and update current_org_id).

    Plain 'user'-role accounts have no org. Callers that require an org
    (projects, deployments, etc.) will get a 403 if none is found.
    Organization-role users always have at least the org created at signup.
    """
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
        org = org_res.scalar_one_or_none()
        if org is not None:
            user.current_org_id = org.id
            await db.commit()
            return org

    raise HTTPException(
        403,
        "No organization found for this account. "
        "Register with the 'organization' role to create one, "
        "or ask an organization owner to invite you.",
    )


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

    org = None
    if role == "organization":
        # Only organization-role signups get their own org.
        org_name = (payload.org_name or f"{user.username}'s organization").strip()
        slug = (org_name + "-" + secrets.token_hex(4)).replace(" ", "-").lower()
        org = Organization(name=org_name, slug=slug)
        db.add(org)
        await db.flush()
        db.add(Membership(user_id=user.id, org_id=org.id,
                          role=OrgRole.owner.value, joined_at=datetime.utcnow()))
        user.current_org_id = org.id

    await db.commit()
    await db.refresh(user)
    if org:
        await db.refresh(org)
    EMAIL_OTP_STORE.pop(normalize_email(payload.email), None)
    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        current_org=OrganizationOut.model_validate(org) if org else None,
    )


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


# ── v3 Org / Member / Audit routes ───────────────────────────────────────────

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
    org = Organization(name=base, slug=slug)
    db.add(org)
    await db.flush()
    db.add(Membership(user_id=current_user.id, org_id=org.id,
                      role=OrgRole.owner.value, joined_at=datetime.utcnow()))
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

    filename = file.filename or "upload.zip"
    if not filename.lower().endswith(".zip"):
        raise HTTPException(400, "Only .zip files are supported.")
    try:
        validate_zip_stream(file.file)
    except ZipValidationError as exc:
        raise HTTPException(400, str(exc)) from exc

    safe_name = Path(filename).name
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
    # Delete reports first (they reference deployments via FK; must be cleared
    # before deployments are deleted to avoid a FK violation).
    await db.execute(delete(Report).where(Report.project_id == p.id))
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


@app.post("/api/deployments", response_model=DeploymentOut, status_code=202, tags=["deployments"])
@app.post("/deployments", response_model=DeploymentOut, status_code=202, tags=["deployments"])
async def create_deployment(payload: DeploymentCreate,
                            current_user: User = Depends(require_user),
                            db: AsyncSession = Depends(get_db)):
    """Queue workspace generation and a read-only Terraform plan."""
    org = await resolve_current_org(current_user, db)
    project = (await db.execute(select(Project).where(
        Project.id == payload.project_id, Project.org_id == org.id
    ))).scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    if project.status not in (ProjectStatus.ready, ProjectStatus.deployed):
        raise HTTPException(409, "Analyze the project before creating a deployment plan.")
    if not project.deployment_plan:
        raise HTTPException(409, "Project analysis artifacts are not ready. Re-run project analysis.")

    account = (await db.execute(select(CloudAccount).where(
        CloudAccount.id == payload.cloud_account_id,
        CloudAccount.user_id == current_user.id,
    ))).scalar_one_or_none()
    if not account:
        raise HTTPException(404, "Connected AWS account not found")
    if account.status != CloudAccountStatus.connected:
        raise HTTPException(409, "Connect and verify this AWS account before planning.")
    if not account.discovery_result or not account.discovery_ran_at:
        raise HTTPException(409, "Run AWS Discovery for this account before planning.")

    deployment = Deployment(
        project_id=project.id,
        user_id=current_user.id,
        org_id=org.id,
        cloud_account_id=account.id,
        status=DeploymentStatus.draft,
        environment=payload.environment,
        # Use explicitly supplied region if provided; else fall back to the account's region.
        region=payload.region or account.region,
        artifacts=project.deployment_plan,
        agent_logs={"logs": []},
    )
    db.add(deployment)
    await db.flush()
    db.add(AuditLog(
        org_id=org.id,
        actor_id=current_user.id,
        action="deployment.plan.request",
        target_type="deployment",
        target_id=str(deployment.id),
        metadata_json={"project_id": str(project.id), "cloud_account_id": str(account.id)},
    ))
    await db.commit()
    await db.refresh(deployment)
    try:
        deployment.status = DeploymentStatus.planning
        deployment.updated_at = datetime.utcnow()
        await db.commit()
        get_queue().enqueue(task_plan_deployment, str(deployment.id), job_timeout=2400)
    except Exception as exc:
        deployment.status = DeploymentStatus.failed
        deployment.error_message = "Could not queue Terraform planning: " + str(exc)[:1000]
        await db.commit()
        raise HTTPException(503, "Could not queue deployment planning. Check the worker and Redis.")
    return deployment


@app.get("/api/deployments/{deployment_id}", response_model=DeploymentOut, tags=["deployments"])
async def get_deployment(deployment_id: UUID,
                         current_user: User = Depends(require_user),
                         db: AsyncSession = Depends(get_db)):
    org = await resolve_current_org(current_user, db)
    deployment = (await db.execute(select(Deployment).where(
        Deployment.id == deployment_id, Deployment.org_id == org.id
    ))).scalar_one_or_none()
    if not deployment:
        raise HTTPException(404, "Deployment not found")
    return deployment


@app.get("/api/deployments/{deployment_id}/plan", tags=["deployments"])
async def get_deployment_plan(deployment_id: UUID,
                              current_user: User = Depends(require_user),
                              db: AsyncSession = Depends(get_db)):
    """Return the Terraform plan summary for a deployment.

    Does NOT include AWS credentials, session tokens, or other secrets.
    The terraform_plan field contains only the human-readable plan output
    (equivalent to `terraform show`).
    """
    org = await resolve_current_org(current_user, db)
    deployment = (await db.execute(select(Deployment).where(
        Deployment.id == deployment_id, Deployment.org_id == org.id
    ))).scalar_one_or_none()
    if not deployment:
        raise HTTPException(404, "Deployment not found")
    account = None
    if deployment.cloud_account_id:
        account = (await db.execute(select(CloudAccount).where(
            CloudAccount.id == deployment.cloud_account_id
        ))).scalar_one_or_none()
    project = (await db.execute(select(Project).where(
        Project.id == deployment.project_id
    ))).scalar_one_or_none()
    return {
        "deployment_id": str(deployment.id),
        "status": deployment.status.value if deployment.status else None,
        "account_id": account.account_id if account else None,
        "region": deployment.region,
        "environment": deployment.environment,
        "project_name": project.name if project else None,
        "summary": deployment.plan_summary,
        "terraform_plan": deployment.terraform_plan,
        "plan_created_at": (
            deployment.plan_created_at.isoformat() + "Z"
            if deployment.plan_created_at else None
        ),
        "error_message": deployment.error_message,
    }


@app.post("/api/deployments/{deployment_id}/approve", response_model=DeploymentOut, tags=["deployments"])
async def approve_deployment_v2(deployment_id: UUID, payload: ApproveDeployment,
                                current_user: User = Depends(require_user),
                                db: AsyncSession = Depends(get_db)):
    """Record an explicit user approval (or rejection) for a deployment plan.

    This endpoint is the safety gate before any infrastructure is created.

    On approval  → status transitions to APPROVED. No further action is taken.
                   terraform apply is NOT queued or executed here.
    On rejection → status transitions to REJECTED.

    The apply step (APPLYING → DEPLOYED) is a separate, future phase that
    requires a subsequent explicit trigger.
    """
    org = await resolve_current_org(current_user, db)

    # Re-load with a lock to prevent duplicate concurrent approvals.
    deployment = (await db.execute(select(Deployment).where(
        Deployment.id == deployment_id, Deployment.org_id == org.id
    ))).scalar_one_or_none()
    if not deployment:
        raise HTTPException(404, "Deployment not found")

    # Verify the requesting user owns the deployment (belt-and-suspenders on top of org check).
    if deployment.user_id and deployment.user_id != current_user.id:
        # Org admins/owners may also approve — only reject if user_id is set and mismatches.
        membership = (await db.execute(select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.org_id == org.id,
        ))).scalar_one_or_none()
        if not membership or membership.role not in (OrgRole.owner.value, OrgRole.admin.value):
            raise HTTPException(403, "Only the deployment owner or an org admin can approve this deployment.")

    # Idempotency: if already approved, return current state rather than erroring.
    current_status = deployment.status
    if current_status == DeploymentStatus.approved and payload.approved:
        return deployment

    # Only plans in PLAN_READY or AWAITING_APPROVAL may be actioned.
    if current_status not in (DeploymentStatus.plan_ready, DeploymentStatus.awaiting_approval):
        status_label = current_status.value if current_status is not None else "unknown"
        raise HTTPException(
            409,
            f"Cannot approve a deployment in '{status_label}' status. "
            "Only deployments in 'awaiting_approval' or 'plan_ready' status can be approved.",
        )

    # ── Rejection path ────────────────────────────────────────────────────────
    if not payload.approved:
        deployment.status = DeploymentStatus.rejected
        deployment.updated_at = datetime.utcnow()
        db.add(AuditLog(
            org_id=org.id,
            actor_id=current_user.id,
            action="deployment.reject",
            target_type="deployment",
            target_id=str(deployment.id),
            metadata_json={"deployment_id": str(deployment.id)},
        ))
        await db.commit()
        await db.refresh(deployment)
        return deployment

    # ── Approval path ─────────────────────────────────────────────────────────
    if not deployment.plan_fingerprint or not deployment.terraform_workspace:
        raise HTTPException(409, "This deployment does not have a complete Terraform plan. "
                                 "Wait for the plan to finish before approving.")

    deployment.approved_by = current_user.id
    deployment.approved_at = datetime.utcnow()
    deployment.status = DeploymentStatus.approved
    deployment.error_message = None
    deployment.updated_at = datetime.utcnow()

    db.add(AuditLog(
        org_id=org.id,
        actor_id=current_user.id,
        action="deployment.approve",
        target_type="deployment",
        target_id=str(deployment.id),
        metadata_json={
            "deployment_id": str(deployment.id),
            "plan_fingerprint": deployment.plan_fingerprint[:16],
            "region": deployment.region,
        },
    ))
    await db.commit()
    await db.refresh(deployment)

    # ── STOP HERE ─────────────────────────────────────────────────────────────
    # terraform apply is NOT queued or executed.
    # The deployment remains in APPROVED status.
    # The apply phase (APPLYING → DEPLOYED) is implemented separately.

    return deployment


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
    d_success = sum(1 for d in deployments if d.status in (DeploymentStatus.success, DeploymentStatus.deployed))
    d_failed = sum(1 for d in deployments if d.status == DeploymentStatus.failed)
    d_running = sum(1 for d in deployments if d.status in (
        DeploymentStatus.running, DeploymentStatus.planning,
        DeploymentStatus.approved, DeploymentStatus.applying,
    ))

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
    }


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

# ── AWS Cloud Account connectivity API ───────────────────────────────────────
# Imported at the bottom for the same reason as agent_routes (circular-import
# avoidance — cloud_routes uses require_user from this module via a lazy import).
from cloud_routes import router as cloud_router
app.include_router(cloud_router)

# ── AWS Discovery API ─────────────────────────────────────────────────────────
# Deterministic read-only AWS scanner — no LLM involved.
# Discovers VPCs, subnets, EC2, EKS, RDS, S3, load balancers, IAM, ECR.
from discovery_routes import router as discovery_router
app.include_router(discovery_router)
