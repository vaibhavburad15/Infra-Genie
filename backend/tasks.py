"""
InfraGenie - background tasks (RQ workers).

Workflow for task_analyze_project() in v3:
  1. Resolve source (upload zip OR GitHub URL -> shallow clone into settings.repo_clone_dir)
  2. Run deterministic static analyzer (no LLM needed)
  3. Stream static findings to logs AND db so UI shows the SAAS-quality
     "Project Overview / Frameworks / Versions / ..." panel immediately -
     even when the LLM is unreachable.
  4. LLM preflight health check
  5. Launch specialist agents in parallel (passing the static analysis into
     each prompt so the LLM augments real detection, never invents it)
  6. Stream each agent's tokens into the live log feed (kind=llm)

Cloning fix (v3): GitPython's `kill_after_timeout` is POSIX-only and crashes
on Windows with "'kill_after_timeout' is not supported on Windows". We now
build clone kwargs conditionally on the platform. The cross-platform code
returns a `RuntimeError` with a clear user-facing message on failure
(auth missing, private repo, network). Logs always include the absolute
local path the repo was checked out to (settings.resolved_clone_dir/<slug>).
"""
import asyncio
import hashlib
import json as _json
import os
import shutil
import sys
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import redis
from rq import Queue
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# GitPython import is guarded so Pylance keeps working in environments that
# have not pip-installed it yet (Pylance would otherwise mark every name
# imported from tasks.py as unknown in main.py).
Repo = None  # type: Any
_GIT_AVAILABLE = True
try:  # pragma: no cover
    from git import Repo  # type: ignore[no-redef]
except ImportError:  # pragma: no cover
    _GIT_AVAILABLE = False

from config import settings
from llm import check_llm_health, LLMUnavailableError
from static_analysis import analyze_repo_static

sync_engine = create_engine(settings.database_url)
_SessionMaker = sessionmaker(bind=sync_engine)


def _get_sync_session() -> Session:
    return _SessionMaker()


def get_redis_conn() -> redis.Redis:
    return redis.from_url(settings.redis_url)


def get_queue() -> Queue:
    return Queue("infragenie", connection=get_redis_conn())


# ── Log helpers ───────────────────────────────────────────────────────────────

LOG_KIND_INFO = "info"
LOG_KIND_SUCCESS = "success"
LOG_KIND_ERROR = "error"
LOG_KIND_LLM = "llm"       # streamed LLM tokens - rendered in copper "thoughts" color
LOG_KIND_SYSTEM = "system"


def _emit_log(r: redis.Redis, db: Session, project, kind: str, agent: str,
              message: str, *, extra: Optional[dict[str, Any]] = None) -> None:
    entry: dict[str, Any] = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "level": str(kind),  # type: ignore[arg-type]
        "kind": str(kind),    # type: ignore[arg-type]
        "agent": agent,
        "message": message,
    }
    if extra:
        entry.update(extra)
    try:
        current = list(project.logs or [])
        current.append(entry)
        if len(current) > 500:
            current = current[-500:]
        project.logs = current
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    try:
        r.publish(f"project_logs:{project.id}", _json.dumps(entry, default=str))
    except Exception:
        pass


def _finish_stream(r: redis.Redis, project, error: Optional[str] = None) -> None:
    payload: dict[str, Any] = {"__done__": True}
    if error:
        payload["error"] = error
    try:
        r.publish(f"project_logs:{project.id}", _json.dumps(payload))
    except Exception:
        pass


def persist_audit(db: Session, project, action: str, target_type: str,
                  target_id: str, *, metadata: Optional[dict[str, Any]] = None) -> None:
    """Best-effort audit log row. Failure here must never abort the run."""
    try:
        from models import AuditLog
        db.add(AuditLog(
            org_id=getattr(project, "org_id", None),
            actor_id=getattr(project, "owner_id", None),
            action=action,
            target_type=target_type,
            target_id=target_id,
            metadata_json=metadata or {},
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


# ── Repository cloning (cross-platform) ──────────────────────────────────────

def _build_clone_kwargs() -> dict[str, Any]:
    """GitPython clone kwargs - kill_after_timeout is POSIX-only; without this
    gate Python raises `TypeError: 'kill_after_timeout' is not supported on
    Windows` before the clone even starts."""
    kw: dict[str, Any] = {"depth": 1, "single_branch": True}
    if sys.platform != "win32":
        kw["kill_after_timeout"] = 120.0
    return kw


def _safe_slug(text: str) -> str:
    h = hashlib.sha1(text.encode()).hexdigest()[:8]
    if "://" in text:
        tail = text.split("://", 1)[1].split("/")[-1] or "repo"
    else:
        tail = text.split("/")[-1] or "repo"
    tail = tail.replace(".git", "").strip("/")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in tail)[:40]
    return f"{safe}_{h}"


def clone_repo(url: str) -> Path:
    """Shallow-clone `url` into settings.resolved_clone_dir/<slug>. Logs and
    raises a `RuntimeError` with a friendly message on failure."""
    if not _GIT_AVAILABLE:
        raise RuntimeError(
            "GitPython is not installed in this environment. "
            "Run `pip install -r backend/requirements.txt` first."
        )
    base = settings.resolved_clone_dir
    base.mkdir(parents=True, exist_ok=True)
    target = base / _safe_slug(url)
    if target.exists():
        try:
            shutil.rmtree(target)
        except Exception:
            # On Windows, locked files (git index, pack files) can prevent rmtree.
            # Forcibly clear read-only flags and retry.
            import stat

            def _force_remove(func, path, _exc):
                try:
                    os.chmod(path, stat.S_IWRITE)
                    func(path)
                except Exception:
                    pass

            shutil.rmtree(target, onerror=_force_remove)
        # If the directory still exists after both attempts, use a fresh slug
        if target.exists():
            import uuid
            target = target.parent / (target.name + "_" + uuid.uuid4().hex[:6])
    try:
        Repo.clone_from(url, str(target), **_build_clone_kwargs())
    except Exception as exc:
        msg = (str(exc) or type(exc).__name__).strip()
        low = msg.lower()
        if "could not read username" in low or "could not resolve" in low:
            pretty = "Repository not found or is private (requires authentication)."
        elif "connection timed out" in low or "unable to access" in low:
            pretty = "Could not reach GitHub (network / DNS issue)."
        else:
            pretty = ("git error: " + msg)[:240]
        raise RuntimeError(f"Failed to clone '{url}': {pretty}") from exc
    return target


def _extract_zip(zf_path: Path) -> Path:
    """Extract a user-uploaded zip to settings.resolved_clone_dir/<uuid>."""
    base = settings.resolved_clone_dir
    base.mkdir(parents=True, exist_ok=True)
    target = base / f"upload_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{os.urandom(3).hex()}"
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zf_path) as zf:
        for member in zf.namelist():
            tgt = target / member
            try:
                tgt.resolve().relative_to(target.resolve())
            except ValueError:
                continue
            if member.endswith("/"):
                tgt.mkdir(parents=True, exist_ok=True)
                continue
            tgt.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, open(tgt, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return target


# ── Agent run stats ───────────────────────────────────────────────────────────

# Maps the agent display name emitted in pipeline logs to the registry id used
# by /agents (see agent_routes.AGENT_ROSTER). Keep in sync with agents.py.
AGENT_ID_BY_LOG_NAME = {
    "AI Project Analyzer": "analyzer",
    "Application Discovery": "discovery",
    "Docker Agent": "docker",
    "Terraform Agent": "terraform",
    "Kubernetes Agent": "kubernetes",
    "CI/CD Agent": "cicd",
    "Architecture Agent": "architecture",
    "Monitoring Agent": "monitoring",
    "Security Agent": "security",
    "Cost Agent": "cost",
}


def _record_agent_run(db, owner_id, agent_name: str, level: str) -> None:
    """Increment run/success counters for an agent in the agent_configs table."""
    from models import AgentConfig

    agent_id = AGENT_ID_BY_LOG_NAME.get(agent_name)
    if not agent_id:
        return

    cfg = (
        db.query(AgentConfig)
        .filter(
            AgentConfig.user_id == owner_id,
            AgentConfig.agent_id == agent_id,
        )
        .first()
    )
    if cfg is None:
        cfg = AgentConfig(user_id=owner_id, agent_id=agent_id, enabled=True)
        db.add(cfg)

    cfg.runs = (cfg.runs or 0) + 1
    if level == "success":
        cfg.successes = (cfg.successes or 0) + 1
    cfg.last_run_at = datetime.utcnow()
    try:
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


# ── Main task: analyze project ────────────────────────────────────────────────

def task_analyze_project(project_id: str) -> None:
    from models import Project, ProjectStatus

    db = _get_sync_session()
    r = get_redis_conn()

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return

    try:
        project.logs = []
        project.detailed_analysis = None
        project.status = ProjectStatus.analyzing
        db.commit()

        def log(kind: str, agent: str, message: str, **kw: Any) -> None:
            _emit_log(r, db, project, kind, agent, message, **kw)

        log(LOG_KIND_SYSTEM, "InfraGenie", "Analysis pipeline started")
        log(LOG_KIND_INFO, "InfraGenie",
            "Repo clone directory: " + str(settings.resolved_clone_dir))

        # ── 1. Resolve source ──────────────────────────────────────────────
        source = project.file_path or project.github_url or project.name
        log(LOG_KIND_INFO, "Source Loader", "Reading project source: " + Path(str(source)).name)

        local_root: Optional[Path] = None
        try:
            s = str(source)
            if s.startswith(("http://", "https://", "git@", "ssh://")):
                log(LOG_KIND_INFO, "Source Loader", "Cloning repository (shallow, depth=1)...")
                local_root = clone_repo(s)
                log(LOG_KIND_SUCCESS, "Source Loader", "Repository cloned -> " + str(local_root))
                persist_audit(db, project, "project.clone", "project", str(project.id),
                              metadata={"repo": s, "local_path": str(local_root),
                                        "clone_dir": str(settings.resolved_clone_dir)})
            elif s.endswith(".zip"):
                log(LOG_KIND_INFO, "Source Loader", "Extracting uploaded archive...")
                local_root = _extract_zip(Path(s))
                log(LOG_KIND_SUCCESS, "Source Loader", "Archive extracted -> " + str(local_root))
            else:
                raise RuntimeError(
                    "Unsupported project source: '" + s + "'. Use a .zip upload or git URL."
                )
        except Exception as exc:
            log(LOG_KIND_ERROR, "Source Loader", str(exc))
            project.status = ProjectStatus.failed
            db.commit()
            _finish_stream(r, project, error=str(exc))
            return

        # ── 2. Deterministic static analysis (NO LLM required) ────────────
        log(LOG_KIND_INFO, "Static Analyzer", "Running deterministic project analysis...")
        try:
            analysis = analyze_repo_static(str(local_root))
            project.detailed_analysis = analysis
            db.commit()
            summary = analysis.get("summary", {})
            primary = summary.get("primary_language", "?")
            framed = summary.get("primary_framework", "no framework detected")
            loc = summary.get("total_loc", 0) or 0
            log(LOG_KIND_SUCCESS, "Static Analyzer",
                "Project: " + str(primary) + " / " + str(framed) +
                " - " + str(summary.get("total_files", "?")) + " files, " +
                f"{loc:,} LOC, " + str(summary.get("source_files", "?")) + " source",
                extra={"structured": {
                    "summary": summary,
                    "languages": analysis.get("languages", [])[:6],
                    "frameworks": analysis.get("frameworks", [])[:6],
                    "build_tools": analysis.get("build_tools", [])[:6],
                    "tests": analysis.get("tests", [])[:6],
                    "linters_formatters": analysis.get("linters_formatters", [])[:6],
                    "databases_orms": analysis.get("databases_orms", [])[:6],
                    "containerization": analysis.get("containerization", {}),
                    "ci_cd": analysis.get("ci_cd", {}),
                    "entry_points": analysis.get("entry_points", [])[:5],
                }})
            if analysis.get("frameworks"):
                names = ", ".join(f["name"] for f in analysis["frameworks"])
                log(LOG_KIND_SUCCESS, "Static Analyzer", "Frameworks: " + names)
            if analysis.get("databases_orms"):
                names = ", ".join(f["name"] for f in analysis["databases_orms"])
                log(LOG_KIND_SUCCESS, "Static Analyzer", "Databases / ORMs: " + names)
            if analysis.get("containerization", {}).get("has_dockerfile"):
                log(LOG_KIND_SUCCESS, "Static Analyzer", "Dockerfile detected")
            if analysis.get("ci_cd", {}).get("present"):
                log(LOG_KIND_SUCCESS, "Static Analyzer",
                    "CI/CD: " + ", ".join(analysis["ci_cd"]["systems"]))
            persist_audit(db, project, "project.analyze.static_done", "project",
                          str(project.id),
                          metadata={"summary": summary,
                                    "clone_dir": str(settings.resolved_clone_dir)})
        except Exception as exc:
            log(LOG_KIND_ERROR, "Static Analyzer", "Static analysis failed: " + str(exc))

        if project.source_type == "github":
            log(LOG_KIND_INFO, "InfraGenie",
                "Repo retained at " + str(local_root) +
                " (move via REPO_CLONE_DIR env var).")

        # ── 3. LLM preflight ──────────────────────────────────────────────
        log(LOG_KIND_INFO, "InfraGenie", "LLM preflight check...")
        try:
            asyncio.run(check_llm_health())
            log(LOG_KIND_SUCCESS, "InfraGenie",
                "LLM is reachable - starting specialist agent pipeline")
        except LLMUnavailableError as e:
            log(LOG_KIND_ERROR, "InfraGenie", "LLM is not working: " + str(e))
            log(LOG_KIND_ERROR, "InfraGenie",
                "Analysis cannot proceed without LLM. Fix LLM connectivity and retry.")
            project.status = ProjectStatus.failed
            db.commit()
            _finish_stream(r, project, error="LLM unavailable: " + str(e))
            persist_audit(db, project, "project.analyze.failed", "project",
                          str(project.id), metadata={"reason": "llm_unavailable"})
            return

        # ── 4. Specialist agents (with live LLM token streaming) ─────────────
        from agents import run_orchestrator_with_progress

        log(LOG_KIND_INFO, "InfraGenie",
            "Launching 8 specialist agents in parallel (concurrency cap = " +
            str(settings.llm_max_concurrency) + ")...")

        def on_agent_event(agent: str, message: str, level: str = "info") -> None:
            try:
                p = db.query(Project).filter(Project.id == project_id).first()
                if p:
                    _emit_log(r, db, p, level, agent, message[:1500])
                    # Track real run stats for the agent fleet page
                    _record_agent_run(db, p.owner_id, agent, level)
            except Exception:
                pass

        def on_llm_token(agent: str, token: str) -> None:
            if not settings.llm_stream_to_logs:
                return
            try:
                p = db.query(Project).filter(Project.id == project_id).first()
                if p:
                    _emit_log(r, db, p, LOG_KIND_LLM, agent, token,
                              extra={"streaming": True})
            except Exception:
                pass

        try:
            result = asyncio.run(run_orchestrator_with_progress(
                project_id=str(project.id),
                project_name=project.name,
                source_summary=project.detailed_analysis or {},
                on_log=on_agent_event,
                on_llm_token=on_llm_token,
            ))
        except LLMUnavailableError as e:
            log(LOG_KIND_ERROR, "InfraGenie", "Agent pipeline failed: " + str(e))
            log(LOG_KIND_ERROR, "InfraGenie",
                "Cannot build deployment plan without LLM. Fix LLM connectivity and retry.")
            project.status = ProjectStatus.failed
            db.commit()
            _finish_stream(r, project, error=str(e))
            return

        db.expire(project)
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            return

        artifacts = result.get("final_artifacts", {})
        artifacts["detailed_analysis"] = project.detailed_analysis or {}
        project.analysis_result = artifacts.get("analysis", {})
        project.deployment_plan = artifacts
        project.status = ProjectStatus.ready
        db.commit()

        log(LOG_KIND_SUCCESS, "InfraGenie",
            "All 8 specialist agents completed - deployment plan is ready!")
        persist_audit(db, project, "project.analyze.success", "project",
                      str(project.id),
                      metadata={"framework_count": len(
                          (project.detailed_analysis or {}).get("frameworks", []))})

        try:
            r.publish(f"project_logs:{project.id}",
                      _json.dumps({"__done__": True}))  # type: ignore[arg-type]
        except Exception:
            pass

    except Exception as e:
        try:
            p2 = db.query(Project).filter(Project.id == project_id).first()
            if p2:
                _emit_log(r, db, p2, LOG_KIND_ERROR, "InfraGenie",
                          "Analysis failed: " + str(e))
                p2.status = ProjectStatus.failed
                db.commit()
        except Exception:
            pass
        try:
            r.publish(f"project_logs:{project_id}",
                      _json.dumps({"__done__": True, "error": str(e)}))
        except Exception:
            pass
    finally:
        try:
            db.close()
        except Exception:
            pass


# ── Deployment task ───────────────────────────────────────────────────────────


def task_run_deployment(deployment_id: str) -> None:
    """Re-plan an explicitly approved workspace, then apply only that plan."""
    from models import (
        AuditLog, CloudAccount, CloudAccountStatus, Deployment, DeploymentStatus,
        Project, ProjectStatus,
    )
    from deployment_planner import (
        TerraformError, assume_role_environment, deployment_workspace,
        run_terraform_plan, apply_plan,
    )

    db = _get_sync_session()
    try:
        deployment = db.query(Deployment).filter(
            Deployment.id == deployment_id
        ).with_for_update().first()
        if not deployment or deployment.status != DeploymentStatus.approved:
            return
        project = db.query(Project).filter(Project.id == deployment.project_id).first()
        account = db.query(CloudAccount).filter(
            CloudAccount.id == deployment.cloud_account_id
        ).first()
        if not project or not account:
            raise TerraformError("Project or connected AWS account no longer exists.")
        if account.status != CloudAccountStatus.connected:
            raise TerraformError("AWS account is no longer connected. Reconnect it and create a new plan.")

        workspace = deployment_workspace(deployment.id)
        if not deployment.terraform_workspace or Path(deployment.terraform_workspace).resolve() != workspace:
            raise TerraformError("The deployment workspace does not match this deployment.")

        deployment.status = DeploymentStatus.applying
        deployment.started_at = datetime.utcnow()
        deployment.updated_at = datetime.utcnow()
        db.commit()

        env = assume_role_environment(account)
        fresh = run_terraform_plan(workspace, env)
        if fresh.fingerprint != deployment.plan_fingerprint:
            # AWS state changed since the user reviewed the original plan.
            # Replace the review data and require a second explicit approval.
            deployment.status = DeploymentStatus.awaiting_approval
            deployment.plan_summary = fresh.summary
            deployment.terraform_plan = fresh.display
            deployment.plan_fingerprint = fresh.fingerprint
            deployment.approved_by = None
            deployment.approved_at = None
            deployment.started_at = None
            deployment.error_message = (
                "AWS changed after review. The refreshed Terraform plan is ready; "
                "review it and approve again."
            )
            deployment.updated_at = datetime.utcnow()
            db.commit()
            return

        # The only apply invocation uses the plan that was just fingerprinted.
        outputs = apply_plan(workspace, env, "deployment.tfplan")
        finished = datetime.utcnow()
        deployment.status = DeploymentStatus.deployed
        deployment.deployment_outputs = outputs.get("outputs", {})
        deployment.terraform_plan = fresh.display
        deployment.completed_at = finished
        deployment.updated_at = finished
        if deployment.started_at:
            deployment.duration_seconds = int((finished - deployment.started_at).total_seconds())
        deployment.error_message = None
        project.status = ProjectStatus.deployed
        db.add(AuditLog(
            org_id=deployment.org_id,
            actor_id=deployment.approved_by,
            action="deployment.apply.success",
            target_type="deployment",
            target_id=str(deployment.id),
        ))
        db.commit()
    except Exception as exc:
        try:
            db.rollback()
            deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
            if deployment:
                finished = datetime.utcnow()
                deployment.status = DeploymentStatus.failed
                deployment.error_message = (str(exc) or type(exc).__name__)[:12000]
                deployment.completed_at = finished
                deployment.updated_at = finished
                if deployment.started_at:
                    deployment.duration_seconds = int((finished - deployment.started_at).total_seconds())
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def task_plan_deployment(deployment_id: str) -> None:
    """Generate a Terraform workspace and run a read-only plan for user review.

    State machine:
        PLANNING → (workspace + terraform fmt/init/validate/plan) → PLAN_READY
                 → AWAITING_APPROVAL
        PLANNING → (any error) → FAILED

    IMPORTANT: terraform apply is NOT called here.
    The plan stops at AWAITING_APPROVAL and waits for an explicit user decision
    via POST /api/deployments/{id}/approve.
    """
    import logging as _logging
    from models import (
        CloudAccount, CloudAccountStatus, Deployment, DeploymentStatus, Project,
    )
    from deployment_planner import (
        TerraformError, assume_role_environment, generate_workspace,
        run_terraform_plan,
    )

    _log = _logging.getLogger(__name__)
    db = _get_sync_session()
    try:
        deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
        if not deployment or deployment.status != DeploymentStatus.planning:
            return

        project = db.query(Project).filter(Project.id == deployment.project_id).first()
        account = db.query(CloudAccount).filter(
            CloudAccount.id == deployment.cloud_account_id
        ).first()

        _log.info(
            "[DEPLOYMENT] deployment_planning_started | deployment_id=%s | "
            "user_id=%s | project_id=%s",
            deployment_id,
            deployment.user_id,
            deployment.project_id,
        )

        # ── Validation ────────────────────────────────────────────────────────
        if not project or not account:
            raise TerraformError(
                "Project or connected AWS account no longer exists.",
                error_kind="workspace_error",
            )
        if account.status != CloudAccountStatus.connected:
            raise TerraformError(
                "AWS account is not connected. Reconnect it and create a new plan.",
                error_kind="assume_role_failed",
            )
        if not account.discovery_result or not account.discovery_ran_at:
            raise TerraformError(
                "Run AWS Discovery for this account before creating a deployment plan.",
                error_kind="workspace_error",
            )
        artifacts = deployment.artifacts or project.deployment_plan or {}
        if not isinstance(artifacts, dict):
            raise TerraformError(
                "Project artifacts are not in a supported format.",
                error_kind="invalid_artifact",
            )
        if not artifacts.get("terraform"):
            raise TerraformError(
                "Project has no Terraform artifacts. Re-run project analysis.",
                error_kind="invalid_artifact",
            )

        # ── Generate workspace ────────────────────────────────────────────────
        # Use the region from the deployment record if set (allows override),
        # otherwise fall back to the cloud account's region.
        effective_region = deployment.region or account.region
        workspace = generate_workspace(
            deployment_id=deployment.id,
            project_name=project.name,
            artifacts=artifacts,
            account_id=account.account_id,
            region=effective_region,
            discovery_ran_at=(account.discovery_ran_at.isoformat() + "Z"),
            discovery_result=account.discovery_result or {},
        )
        deployment.terraform_workspace = str(workspace)
        deployment.artifact_dir = str(workspace)
        deployment.region = effective_region
        deployment.updated_at = datetime.utcnow()
        db.commit()

        # ── Obtain temporary AWS credentials (never logged, never returned) ───
        _log.info(
            "[DEPLOYMENT] terraform_init_started | deployment_id=%s", deployment_id
        )
        env = assume_role_environment(account)

        # ── Run the full planning pipeline (fmt → init → validate → plan) ────
        result = run_terraform_plan(workspace, env)

        # ── Persist plan results ──────────────────────────────────────────────
        deployment.plan_summary = result.summary
        deployment.terraform_plan = result.display
        deployment.plan_fingerprint = result.fingerprint
        deployment.plan_created_at = result.plan_created_at
        deployment.status = DeploymentStatus.plan_ready
        deployment.updated_at = datetime.utcnow()
        db.commit()

        _log.info(
            "[DEPLOYMENT] deployment_plan_ready | deployment_id=%s | "
            "create=%d | modify=%d | destroy=%d | replace=%d | fingerprint=%s",
            deployment_id,
            result.summary.get("create", 0),
            result.summary.get("modify", 0),
            result.summary.get("destroy", 0),
            result.summary.get("replace", 0),
            result.fingerprint[:16],
        )

        # ── Transition to AWAITING_APPROVAL ───────────────────────────────────
        deployment.status = DeploymentStatus.awaiting_approval
        deployment.error_message = None
        deployment.updated_at = datetime.utcnow()
        db.commit()

        _log.info(
            "[DEPLOYMENT] deployment_approval_requested | deployment_id=%s | "
            "user_id=%s | project_id=%s",
            deployment_id,
            deployment.user_id,
            deployment.project_id,
        )

    except TerraformError as exc:
        _log.error(
            "[DEPLOYMENT] deployment_failed | deployment_id=%s | "
            "error_kind=%s | message=%.500s",
            deployment_id,
            getattr(exc, "error_kind", "unknown"),
            str(exc),
        )
        try:
            db.rollback()
            deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
            if deployment:
                deployment.status = DeploymentStatus.failed
                # Build a user-friendly message keyed on error_kind
                kind = getattr(exc, "error_kind", "unknown")
                _kind_messages = {
                    "missing_binary": (
                        "Terraform CLI is not installed on the worker. "
                        "Install Terraform and restart the worker."
                    ),
                    "invalid_artifact": (
                        "The generated Terraform configuration is invalid. "
                        "Re-run project analysis to regenerate the artifacts."
                    ),
                    "init_failed": (
                        "Terraform initialization failed. Review the Terraform "
                        "configuration and ensure the AWS provider version is valid."
                    ),
                    "validate_failed": (
                        "Terraform validation failed. The generated configuration "
                        "has syntax or semantic errors. Re-run project analysis."
                    ),
                    "plan_failed": (
                        "Terraform plan failed. Check the AWS permissions for the "
                        "connected IAM role and review the plan error details."
                    ),
                    "show_failed": (
                        "Terraform produced a plan but it could not be parsed. "
                        "Check the worker logs for details."
                    ),
                    "assume_role_failed": (
                        "AWS credential setup failed. Verify the IAM role ARN and "
                        "trust policy for the connected account, then try again."
                    ),
                    "timeout": (
                        "Terraform command timed out. The AWS account may be "
                        "experiencing delays. Try again or increase the timeout."
                    ),
                }
                user_message = _kind_messages.get(kind, str(exc)[:12000])
                deployment.error_message = user_message
                deployment.updated_at = datetime.utcnow()
                db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass

    except Exception as exc:
        _log.exception(
            "[DEPLOYMENT] deployment_failed_unexpected | deployment_id=%s", deployment_id
        )
        try:
            db.rollback()
            deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
            if deployment:
                deployment.status = DeploymentStatus.failed
                deployment.error_message = (str(exc) or type(exc).__name__)[:12000]
                deployment.updated_at = datetime.utcnow()
                db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
    finally:
        db.close()
