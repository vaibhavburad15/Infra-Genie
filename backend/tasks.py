"""
Redis Queue background tasks.
These functions are enqueued by FastAPI and run by worker.py.

Log streaming architecture:
  - task_analyze_project() calls _emit_log() to append entries to:
      1. project.logs (DB column) for persistence
      2. Redis pub/sub channel  "project_logs:{project_id}"  for live SSE
  - The SSE endpoint in main.py subscribes to that channel and pushes events.
"""
import asyncio
import os
import zipfile
import json
from pathlib import Path
from datetime import datetime, timezone

import redis
from rq import Queue
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from config import settings
from agents import run_orchestrator_with_progress
from llm import check_llm_health, LLMUnavailableError


# Sync engine for RQ workers (RQ doesn't support async natively)
sync_engine = create_engine(settings.database_url)


def _get_sync_session():
    from sqlalchemy.orm import sessionmaker
    SyncSession = sessionmaker(bind=sync_engine)
    return SyncSession()


def get_redis_conn():
    return redis.from_url(settings.redis_url)


def get_queue():
    return Queue("infragenie", connection=get_redis_conn())


# ── Log helpers ───────────────────────────────────────────────────────────────

def _emit_log(r: redis.Redis, db: Session, project, level: str, agent: str, message: str):
    """Append a log line to the DB column and publish to Redis pub/sub."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,      # info | success | error | system
        "agent": agent,
        "message": message,
    }
    # Persist in DB
    current = list(project.logs or [])
    current.append(entry)
    project.logs = current
    db.commit()

    # Publish for live SSE (best-effort)
    channel = f"project_logs:{project.id}"
    try:
        r.publish(channel, json.dumps(entry))
    except Exception:
        pass


# ── File summariser ───────────────────────────────────────────────────────────

def summarize_project_files(file_path: str) -> str:
    """Extract a text summary of the project for the AI."""
    summary_lines = []
    try:
        if file_path.endswith(".zip"):
            with zipfile.ZipFile(file_path) as zf:
                for name in zf.namelist()[:100]:
                    summary_lines.append(f"FILE: {name}")
                    if any(name.endswith(ext) for ext in [".py", ".js", ".ts", ".json", ".yaml", ".yml", ".txt", ".md"]):
                        try:
                            content = zf.read(name).decode("utf-8", errors="ignore")[:500]
                            summary_lines.append(content)
                            summary_lines.append("---")
                        except Exception:
                            pass
        else:
            summary_lines.append(f"GitHub URL: {file_path}")
    except Exception as e:
        summary_lines.append(f"Could not read project: {e}")
    return "\n".join(summary_lines)[:8000]


# ── Task: Analyze project ─────────────────────────────────────────────────────

def task_analyze_project(project_id: str):
    """Runs analysis + agent orchestration for a project."""
    from models import Project, ProjectStatus, Deployment, DeploymentStatus

    db = _get_sync_session()
    r = get_redis_conn()

    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return

        # Reset logs and mark as analyzing
        project.logs = []
        project.status = ProjectStatus.analyzing
        db.commit()

        _emit_log(r, db, project, "system", "InfraGenie", "🚀 Analysis pipeline started")

        # Get source summary
        source = project.file_path or project.github_url or project.name
        _emit_log(r, db, project, "info", "InfraGenie", f"📂 Reading project source: {Path(source).name if project.file_path else source}")
        summary = summarize_project_files(source)
        _emit_log(r, db, project, "info", "InfraGenie", f"✅ Source indexed — {len(summary)} chars of context")

        # Fast pre-flight LLM connectivity check. This runs before the full
        # agent pipeline so a down/misconfigured LLM is reported in seconds
        # rather than after minutes of sequential/parallel call timeouts.
        _emit_log(r, db, project, "info", "InfraGenie", "🔌 Checking LLM connectivity…")
        try:
            asyncio.run(check_llm_health())
        except LLMUnavailableError as e:
            _emit_log(r, db, project, "error", "InfraGenie", f"❌ LLM is not working: {e}")
            project.status = ProjectStatus.failed
            db.commit()
            try:
                r.publish(f"project_logs:{project_id}", json.dumps({"__done__": True, "error": str(e)}))
            except Exception:
                pass
            return
        _emit_log(r, db, project, "success", "InfraGenie", "✅ LLM is reachable — starting agent pipeline")

        # Callback so agents can emit logs in real time
        def on_agent_log(agent: str, message: str, level: str = "info"):
            # Re-fetch project to avoid stale state issues across async boundary
            p = db.query(Project).filter(Project.id == project_id).first()
            if p:
                _emit_log(r, db, p, level, agent, message)

        # Run LangGraph orchestrator with progress callback
        result = asyncio.run(run_orchestrator_with_progress(
            project_id=str(project.id),
            project_name=project.name,
            source_summary=summary,
            on_log=on_agent_log,
        ))

        # Re-fetch to get latest logs column
        db.expire(project)
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise RuntimeError("Project was deleted while analysis was running")

        # Store results
        artifacts = result.get("final_artifacts", {})
        project.analysis_result = artifacts.get("analysis", {})
        project.deployment_plan = artifacts
        project.status = ProjectStatus.ready
        db.commit()

        _emit_log(r, db, project, "success", "InfraGenie", "🎉 All agents completed — deployment plan ready!")

        # Signal SSE clients that stream is done
        try:
            r.publish(f"project_logs:{project_id}", json.dumps({"__done__": True}))
        except Exception:
            pass

        # Create a pending deployment record
        deployment = Deployment(
            project_id=project.id,
            status=DeploymentStatus.awaiting_approval,
            artifacts=artifacts,
            agent_logs={"logs": result.get("agent_logs", [])},
        )
        db.add(deployment)
        db.commit()

    except Exception as e:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project:
            try:
                _emit_log(r, db, project, "error", "InfraGenie", f"❌ Analysis failed: {e}")
            except Exception:
                pass
            project.status = ProjectStatus.failed
            db.commit()
        try:
            r.publish(f"project_logs:{project_id}", json.dumps({"__done__": True, "error": str(e)}))
        except Exception:
            pass
        raise e
    finally:
        db.close()


# ── Task: Run deployment ─────────────────────────────────────────────────────

def task_run_deployment(deployment_id: str):
    """Simulate infrastructure provisioning + app deployment after approval."""
    from models import Deployment, DeploymentStatus, Project, ProjectStatus
    import time

    db = _get_sync_session()
    try:
        deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
        if not deployment:
            return

        deployment.status = DeploymentStatus.running
        deployment.started_at = datetime.utcnow()
        db.commit()

        steps = ["Infrastructure Provisioning", "Docker Build", "Application Deployment", "Health Checks"]
        logs = deployment.agent_logs or {}
        logs["deployment_steps"] = []

        for step in steps:
            time.sleep(2)
            logs["deployment_steps"].append({
                "step": step, "status": "completed", "at": datetime.utcnow().isoformat()
            })

        deployment.agent_logs = logs
        deployment.status = DeploymentStatus.success
        deployment.completed_at = datetime.utcnow()

        project = db.query(Project).filter(Project.id == deployment.project_id).first()
        if project:
            project.status = ProjectStatus.deployed

        db.commit()

    except Exception as e:
        deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
        if deployment:
            deployment.status = DeploymentStatus.failed
            deployment.completed_at = datetime.utcnow()
            db.commit()
        raise e
    finally:
        db.close()