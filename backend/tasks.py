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
        shutil.rmtree(target, ignore_errors=True)
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


# ── Fallback plan (used when the LLM is unreachable) ─────────────────────────

def _fallback_plan_from_static(det: dict[str, Any]) -> dict[str, Any]:
    """Build a partial deployment plan from static analysis alone when the LLM
    is unreachable so the project still moves to `ready` instead of `failed`."""
    primary = det.get("summary", {}).get("primary_language", "Unknown")
    framework = det.get("summary", {}).get("primary_framework") or "(none detected)"
    has_db = det.get("has_database_hint", False)
    has_docker = det.get("has_dockerfile", False)
    note = (
        "This plan was assembled by the deterministic static analyzer; the "
        "LLM-powered specialist agents were not available. Re-run with the "
        "LLM reachable for richer Docker / Terraform / Kubernetes plans."
    )
    return {
        "analysis": {
            "language": primary,
            "framework": framework,
            "complexity": "medium",
            "recommended_strategy": (
                "kubernetes" if has_docker else "docker-compose"
            ),
            "notes": note,
            "fallback": True,
        },
        "discovered_apps": [{
            "name": det.get("summary", {}).get("primary_language", "app"),
            "type": "backend", "port": 8000,
            "tech": framework,
        }],
        "docker": ("# Dockerfile not generated - LLM unavailable\n"
                   "# Project DOES have a Dockerfile in repo"
                   if has_docker else
                   "# Dockerfile not generated - LLM unavailable"),
        "terraform": "# Terraform not generated - LLM unavailable",
        "kubernetes": "# Kubernetes manifests not generated - LLM unavailable",
        "cicd": "# CI/CD pipeline not generated - LLM unavailable",
        "architecture": f"Static analysis fallback: {primary} / {framework}, "
                        f"DB hint: {has_db}.",
        "monitoring": "# Prometheus / Grafana config not generated - LLM unavailable",
        "security": "# Security scan not generated - LLM unavailable",
        "cost_estimate": "# Cost estimate not generated - LLM unavailable",
        "detailed_analysis": det,
        "strategy": "kubernetes" if has_docker else "docker-compose",
    }


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
    from models import Project, ProjectStatus, Deployment, DeploymentStatus

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
            log(LOG_KIND_INFO, "InfraGenie",
                "Static analysis already complete and persisted; "
                "deployment plan will use a deterministic fallback. Retry later.")
            project.status = ProjectStatus.ready
            project.deployment_plan = _fallback_plan_from_static(project.detailed_analysis or {})
            db.commit()
            _finish_stream(r, project, error="LLM unavailable: " + str(e))
            persist_audit(db, project, "project.analyze.partial", "project",
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
            project.status = ProjectStatus.ready
            project.deployment_plan = _fallback_plan_from_static(project.detailed_analysis or {})
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

        deployment = Deployment(
            project_id=project.id,
            org_id=project.org_id,
            status=DeploymentStatus.awaiting_approval,
            artifacts=artifacts,
            agent_logs={"logs": result.get("agent_logs", [])},
        )
        db.add(deployment)
        db.commit()
        try:
            r.publish(f"project_logs:{project.id}",
                      _json.dumps({"__done__": True, "deployment_id": str(deployment.id)}))  # type: ignore[arg-type]
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

_ARTIFACT_FILENAMES = {
    "docker": "docker-compose.yml",
    "terraform": "main.tf",
    "kubernetes": "deployment.yaml",
    "cicd": "workflow.yml",
    "monitoring": "prometheus.yml",
    "security": "security.md",
    "detailed_analysis": "detailed-analysis.json",
}


def task_run_deployment(deployment_id: str) -> None:
    """Simulate provisioning + app deploy. Writes AI-generated artifacts to
    ./deployment_output/<project>/<deployment>/ regardless of mode so the demo
    has tangible output even when DEPLOYMENT_MODE=simulate."""
    import time

    from models import Deployment, DeploymentStatus, Project, ProjectStatus, Report, ReportOut  # noqa: F401

    db = _get_sync_session()

    deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
    if not deployment:
        return

    try:
        deployment.status = DeploymentStatus.running
        deployment.started_at = datetime.utcnow()
        db.commit()

        steps = ["Infrastructure Provisioning", "Docker Build",
                 "Application Deployment", "Health Checks"]
        agent_logs = dict(deployment.agent_logs or {})
        agent_logs["deployment_steps"] = []
        agent_logs["mode"] = settings.deployment_mode

        for step in steps:
            time.sleep(2)
            agent_logs["deployment_steps"].append({
                "step": step, "status": "completed",
                "at": datetime.utcnow().isoformat() + "Z",
            })

        artifact_dir = settings.resolved_artifact_dir / str(deployment.project_id) / str(deployment.id)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_files = []
        if deployment.artifacts:
            for key, fname in _ARTIFACT_FILENAMES.items():
                content = deployment.artifacts.get(key)
                if isinstance(content, str) and content.strip():
                    fpath = artifact_dir / fname
                    try:
                        fpath.parent.mkdir(parents=True, exist_ok=True)
                        fpath.write_text(content[:20000], encoding="utf-8")
                        artifact_files.append(str(fpath))
                    except Exception:
                        pass
                elif isinstance(content, (dict, list)):
                    fpath = artifact_dir / fname
                    try:
                        fpath.write_text(_json.dumps(content, indent=2, default=str),
                                         encoding="utf-8")
                        artifact_files.append(str(fpath))
                    except Exception:
                        pass
        agent_logs["artifact_files"] = artifact_files
        agent_logs["provisioning"] = "simulated" if settings.deployment_mode == "simulate" \
            else "artifacts-only"

        deployment.agent_logs = agent_logs
        deployment.artifact_dir = str(artifact_dir)
        deployment.status = DeploymentStatus.success
        deployment.completed_at = datetime.utcnow()
        if deployment.started_at is not None and deployment.completed_at is not None:
            try:
                _s = deployment.started_at; _e = deployment.completed_at
                deployment.duration_seconds = int((_e - _s).total_seconds())  # type: ignore[operator]
            except Exception:
                deployment.duration_seconds = None

        project = db.query(Project).filter(Project.id == deployment.project_id).first()
        if project:
            project.status = ProjectStatus.deployed

        # Auto-create a Report row so the Reports page actually has entries
        try:
            from models import Report
            rpt = Report(
                project_id=deployment.project_id,
                deployment_id=deployment.id,
                report_type="telemetry",
                content={
                    "artifact_files": artifact_files,
                    "steps": agent_logs["deployment_steps"],
                    "mode": settings.deployment_mode,
                    "duration_seconds": deployment.duration_seconds,
                },
                insights="Deployment completed in " + str(deployment.duration_seconds) +
                         "s. " + str(len(artifact_files)) + " artifact files written.",
            )
            db.add(rpt)
        except Exception:
            pass

        db.commit()

    except Exception as e:
        deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
        if deployment:
            deployment.status = DeploymentStatus.failed
            deployment.completed_at = datetime.utcnow()
            db.commit()
        raise e
    finally:
        try:
            db.close()
        except Exception:
            pass