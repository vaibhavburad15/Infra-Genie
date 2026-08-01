"""
Redis Queue background tasks.
These functions are enqueued by FastAPI and run by worker.py.
"""
import asyncio
import os
import zipfile
import tempfile
import json
from pathlib import Path
from datetime import datetime

import redis
from rq import Queue
from sqlalchemy.orm import Session
from sqlalchemy import create_engine

from config import settings
from agents import run_orchestrator


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


# ── Task: Analyze project ─────────────────────────────────────────────────────

def summarize_project_files(file_path: str) -> str:
    """Extract a text summary of the project for the AI."""
    summary_lines = []
    try:
        if file_path.endswith(".zip"):
            with zipfile.ZipFile(file_path) as zf:
                for name in zf.namelist()[:100]:   # cap at 100 files
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
    return "\n".join(summary_lines)[:8000]  # Limit context size


def task_analyze_project(project_id: str):
    """Runs analysis + agent orchestration for a project."""
    from models import Project, ProjectStatus, Deployment, DeploymentStatus

    db = _get_sync_session()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return

        # Mark as analyzing
        project.status = ProjectStatus.analyzing
        db.commit()

        # Get source summary
        source = project.file_path or project.github_url or project.name
        summary = summarize_project_files(source)

        # Run LangGraph orchestrator (sync wrapper)
        result = asyncio.run(run_orchestrator(
            project_id=str(project.id),
            project_name=project.name,
            source_summary=summary,
        ))

        # Store results
        artifacts = result.get("final_artifacts", {})
        project.analysis_result = artifacts.get("analysis", {})
        project.deployment_plan = artifacts
        project.status = ProjectStatus.ready
        db.commit()

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
            project.status = ProjectStatus.failed
            db.commit()
        raise e
    finally:
        db.close()


def task_run_deployment(deployment_id: str):
    """Simulate infrastructure provisioning + app deployment after approval."""
    from models import Deployment, DeploymentStatus, Project, ProjectStatus

    db = _get_sync_session()
    try:
        deployment = db.query(Deployment).filter(Deployment.id == deployment_id).first()
        if not deployment:
            return

        deployment.status = DeploymentStatus.running
        deployment.started_at = datetime.utcnow()
        db.commit()

        # Here you would wire in real Terraform/K8s execution.
        # For now we simulate the deployment steps.
        import time
        steps = ["Infrastructure Provisioning", "Docker Build", "Application Deployment", "Health Checks"]
        logs = deployment.agent_logs or {}
        logs["deployment_steps"] = []

        for step in steps:
            time.sleep(2)  # simulated work
            logs["deployment_steps"].append({"step": step, "status": "completed", "at": datetime.utcnow().isoformat()})

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
