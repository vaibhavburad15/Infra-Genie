"""
InfraGenie — Agent Registry & Configuration API (v3 multi-tenant aware)

Routes:
  GET  /agents            → full agent roster (metadata + per-user state + real stats)
  GET  /agents/{id}      → single agent with state
  PUT  /agents/{id}       → enable / disable an agent for the current user

The agent roster defined here (AGENT_ROSTER) is the single source of truth for
the frontend's "AI Agent Fleet" page. Enable/disable state is persisted per user
in the `agent_configs` table in PostgreSQL — NOT in browser localStorage.

Auth: mirrors main.py's `require_user` (v3 JWT scheme) locally so this router can
be imported from main without a circular import. Keep in sync if the JWT scheme
ever changes.

Pipeline mapping (matches backend/agents.py):
  core (always-on): analyzer, discovery
  optional (8 live generation agents): docker, terraform, kubernetes, cicd,
                                       architecture, monitoring, security, cost
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models import AgentConfig, AgentConfigUpdate, User, get_db

router = APIRouter(prefix="/agents", tags=["agents"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def require_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Mirror of main.require_user — kept local to avoid a circular import."""
    cred_exc = HTTPException(401, "Invalid credentials",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        uid = payload.get("sub")
        if not isinstance(uid, str):
            raise cred_exc
    except JWTError:
        raise cred_exc
    res = await db.execute(select(User).where(User.id == uuid.UUID(uid)))
    u = res.scalar_one_or_none()
    if u is None or not u.is_active:
        raise cred_exc
    return u


# ── Agent roster (single source of truth) ────────────────────────────────────

_LLM_MODEL = getattr(settings, "llm_model", "Qwen3-Coder-Next FP8")

AGENT_ROSTER: List[dict] = [
    {
        "agent_id": "analyzer",
        "name": "Project Analyzer",
        "role": "Understands the application",
        "category": "analysis",
        "outputs": ["Language · Framework · Dependencies", "Complexity grade"],
        "description": (
            "Scans the uploaded repository, detects the primary language and "
            "framework, resolves dependency graphs, and produces a structured "
            "summary the rest of the pipeline consumes."
        ),
        "optional": False,
        "model": _LLM_MODEL,
        "median_runtime_sec": 14,
    },
    {
        "agent_id": "discovery",
        "name": "Application Discovery",
        "role": "Identifies services and topology",
        "category": "analysis",
        "outputs": ["Services · Ports · Entry points", "Component dependencies"],
        "description": (
            "Discovers services, ports, entry points, and inter-service "
            "dependencies. Prerequisite for containerization and infrastructure "
            "generation."
        ),
        "optional": False,
        "model": _LLM_MODEL,
        "median_runtime_sec": 11,
    },
    {
        "agent_id": "docker",
        "name": "Docker Agent",
        "role": "Containerizes the application",
        "category": "artifacts",
        "outputs": ["Dockerfile", "docker-compose.yml"],
        "description": (
            "Generates production-grade Dockerfiles (multi-stage, layer-cached, "
            "minimal base images) and a Compose file for local orchestration."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 22,
    },
    {
        "agent_id": "terraform",
        "name": "Terraform Agent",
        "role": "Designs cloud infrastructure",
        "category": "artifacts",
        "outputs": ["modules/*.tf", "variables.tf", "outputs.tf"],
        "description": (
            "Produces AWS-first Terraform modules — VPC, subnets, IAM, ECS/EKS, "
            "RDS as applicable. Structured for review and safe to `terraform "
            "plan` before apply."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 34,
    },
    {
        "agent_id": "kubernetes",
        "name": "Kubernetes Agent",
        "role": "Creates K8s deployment resources",
        "category": "artifacts",
        "outputs": ["k8s/*.yaml", "HPA · Ingress · Probes"],
        "description": (
            "Emits Kubernetes manifests: Deployments, Services, Ingress, "
            "HorizontalPodAutoscaler, readiness/liveness probes, ConfigMaps, "
            "and Secrets scaffolding."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 28,
    },
    {
        "agent_id": "cicd",
        "name": "CI/CD Agent",
        "role": "Automates deployment workflows",
        "category": "artifacts",
        "outputs": [".github/workflows/deploy.yml", "Build · Test · Push · Deploy"],
        "description": (
            "Generates GitHub Actions workflows for the full pipeline — test → "
            "build → scan → push → deploy."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 17,
    },
    {
        "agent_id": "architecture",
        "name": "Architecture Agent",
        "role": "Analyzes scalability and resilience",
        "category": "operations",
        "outputs": ["Architecture rationale", "Scalability plan"],
        "description": (
            "Reviews the generated stack for scalability, resilience, and "
            "coupling. Produces a written rationale and identifies weak spots "
            "before deployment."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 19,
    },
    {
        "agent_id": "monitoring",
        "name": "Monitoring Agent",
        "role": "Configures observability",
        "category": "operations",
        "outputs": ["prometheus.yml", "Grafana dashboards", "Loki config"],
        "description": (
            "Sets up Prometheus scrape configs, Grafana dashboards for the "
            "discovered services, and Loki log aggregation."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 21,
    },
    {
        "agent_id": "security",
        "name": "Security Agent",
        "role": "Hardens the deployment",
        "category": "operations",
        "outputs": ["Hardening notes", "RBAC · Network policies", "Secret handling"],
        "description": (
            "Identifies security risks, generates hardening recommendations, "
            "RBAC roles, network policies, and secret-management scaffolding."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 26,
    },
    {
        "agent_id": "cost",
        "name": "Cost Optimization Agent",
        "role": "Estimates and reduces spend",
        "category": "operations",
        "outputs": ["Monthly estimate", "Optimization recommendations"],
        "description": (
            "Estimates monthly infrastructure spend for the generated Terraform "
            "plan and flags waste — oversized instances, idle resources, and "
            "cheaper equivalent services."
        ),
        "optional": True,
        "model": _LLM_MODEL,
        "median_runtime_sec": 15,
    },
]


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_config(db: AsyncSession, user_id: uuid.UUID, agent_id: str) -> Optional[AgentConfig]:
    result = await db.execute(
        select(AgentConfig).where(
            AgentConfig.user_id == user_id,
            AgentConfig.agent_id == agent_id,
        )
    )
    return result.scalar_one_or_none()


def _serialize(meta: dict, cfg: Optional[AgentConfig]) -> dict:
    return {
        **meta,
        "enabled": cfg.enabled if cfg else True,
        "runs": cfg.runs if cfg else 0,
        "successes": cfg.successes if cfg else 0,
        "last_run_at": cfg.last_run_at.isoformat() + "Z" if cfg and cfg.last_run_at else None,
        "updated_at": cfg.updated_at.isoformat() + "Z" if cfg and cfg.updated_at else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """Return the full agent roster merged with the current user's state."""
    result = await db.execute(
        select(AgentConfig).where(AgentConfig.user_id == current_user.id)
    )
    configs = {c.agent_id: c for c in result.scalars().all()}
    agents = [_serialize(meta, configs.get(meta["agent_id"])) for meta in AGENT_ROSTER]
    return {
        "agents": agents,
        "core_agent_ids": [a["agent_id"] for a in AGENT_ROSTER if not a["optional"]],
        "total": len(agents),
        "enabled": sum(1 for a in agents if a["enabled"]),
    }


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user),
):
    meta = next((a for a in AGENT_ROSTER if a["agent_id"] == agent_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown agent")
    cfg = await _get_config(db, current_user.id, agent_id)
    return _serialize(meta, cfg)


@router.put("/{agent_id}")
async def set_agent_enabled(
    agent_id: str,
    payload: AgentConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """Enable or disable an agent for the current user (persisted in PostgreSQL)."""
    meta = next((a for a in AGENT_ROSTER if a["agent_id"] == agent_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown agent")
    if not meta["optional"] and not payload.enabled:
        raise HTTPException(status_code=400, detail="Core agents cannot be disabled")

    cfg = await _get_config(db, current_user.id, agent_id)
    if cfg is None:
        cfg = AgentConfig(user_id=current_user.id, agent_id=agent_id, enabled=payload.enabled)
        db.add(cfg)
    else:
        cfg.enabled = payload.enabled
    await db.commit()
    await db.refresh(cfg)
    return _serialize(meta, cfg)
