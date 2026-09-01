"""
Redis Queue background tasks.
These functions are enqueued by FastAPI and run by worker.py.

Log streaming architecture:
  - task_analyze_project() calls _emit_log() to append entries to:
      1. project.logs (DB column) for persistence
      2. Redis pub/sub channel  "project_logs:{project_id}"  for live SSE
  - The SSE endpoint in main.py subscribes to that channel and pushes events.

GitHub analysis fix:
  - Previously a GitHub-sourced project was summarized as just its URL string,
    so the AI had no real code to inspect and hallucinated a stack (e.g.
    "Python / Streamlit" for a TypeScript app). We now shallow-clone the repo
    (gitpython, already in requirements.txt), skip noise dirs, and present
    stack-identifying manifests FIRST so detection is reliable.
"""
import asyncio
import os
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from datetime import datetime, timezone

import redis
from rq import Queue
from git import Repo
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

# Directories we never send to the LLM (huge/noise).
SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".nuxt", ".output",
    "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", ".cache",
    "coverage", "target", "vendor", "Pods", "bin", "obj", "site-packages",
}
TEXT_EXTS = (
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".txt", ".md", ".sh", ".bash", ".zsh", ".go", ".rs",
    ".java", ".kt", ".rb", ".php", ".html", ".htm", ".css", ".scss", ".sql",
    ".properties", ".gradle", ".xml", ".tf", ".env", ".vue", ".svelte",
)
# Stack-identifying files — surfaced FIRST so the analyzer detects the real
# language/framework instead of guessing from an empty summary.
MANIFESTS = (
    "package.json", "tsconfig.json", "tsconfig.app.json", "vite.config.ts",
    "vite.config.js", "vite.config.mjs", "next.config.js", "next.config.mjs",
    "next.config.ts", "requirements.txt", "pyproject.toml", "setup.py",
    "setup.cfg", "Pipfile", "poetry.lock", "pom.xml", "build.gradle",
    "go.mod", "Cargo.toml", "composer.json", "Gemfile", "mix.exs", "Dockerfile",
    "docker-compose.yml", "docker-compose.yaml", ".github/workflows/",
    "pubspec.yaml", "project.clj",
)
MAX_FILES = 120
MAX_CHARS_TOTAL = 8000


def _read_head(path: Path, limit: int = 600) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:limit]
    except Exception:
        return ""


def _summarize_git_repo(url: str) -> str:
    """Shallow-clone a git repo into a temp dir and build the same text summary
    as the ZIP branch. Raises ValueError (clear message) if the clone fails so
    the worker can fail the project honestly instead of analyzing an empty
    summary (which used to produce hallucinated stack detection)."""
    tmp = tempfile.mkdtemp(prefix="infragenie_")
    try:
        try:
            Repo.clone_from(url, tmp, depth=1, single_branch=True, kill_after_timeout=120)
        except Exception as exc:
            raise ValueError(
                f"Could not clone repository '{url}': {type(exc).__name__}: {exc}. "
                f"Make sure the repo is public (or reachable) and git is installed."
            ) from exc

        entries: list[tuple[str, Path]] = []
        for root, dirs, files in os.walk(tmp):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                full = Path(root) / fname
                rel = full.relative_to(tmp).as_posix()
                entries.append((rel, full))

        def sort_key(item):
            rel, _ = item
            if rel in MANIFESTS:
                return (0, rel)
            if any(rel.endswith(m) for m in MANIFESTS if "/" in m):
                return (1, rel)
            return (2, rel)

        entries.sort(key=sort_key)

        lines: list[str] = []
        for rel, full in entries[:MAX_FILES]:
            lines.append(f"FILE: {rel}")
            if rel.endswith(TEXT_EXTS):
                content = _read_head(full)
                if content:
                    lines.append(content)
                    lines.append("---")

        if not lines:
            raise ValueError(
                f"Repository '{url}' cloned but contained no readable files."
            )
        return "\n".join(lines)[:MAX_CHARS_TOTAL]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def summarize_project_files(file_path: str) -> str:
    """Extract a text summary of the project for the AI.

    Supported sources:
      - a local .zip (uploaded project)
      - a git repository URL (GitHub etc.) — shallow-cloned automatically

    Raises ValueError with a clear, user-facing message when the source cannot
    be read, so the caller can fail the project instead of analyzing on empty.
    """
    if file_path.endswith(".zip"):
        summary_lines = []
        try:
            with zipfile.ZipFile(file_path) as zf:
                for name in zf.namelist()[:100]:
                    summary_lines.append(f"FILE: {name}")
                    if name.endswith(TEXT_EXTS):
                        try:
                            content = zf.read(name).decode("utf-8", errors="ignore")[:500]
                            summary_lines.append(content)
                            summary_lines.append("---")
                        except Exception:
                            pass
            if not summary_lines:
                raise ValueError(
                    "The uploaded archive contained no readable files."
                )
        except zipfile.BadZipFile as exc:
            raise ValueError(
                f"'{file_path}' is not a valid project ZIP archive: {exc}"
            ) from exc
        return "\n".join(summary_lines)[:MAX_CHARS_TOTAL]

    if file_path.startswith(("http://", "https://", "git@", "ssh://")):
        return _summarize_git_repo(file_path)

    raise ValueError(
        f"Unsupported project source: '{file_path}'. "
        f"Use a .zip upload or a Git repository URL."
    )


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

        # Get source summary — clone GitHub repos for real analysis
        source = project.file_path or project.github_url or project.name
        _emit_log(r, db, project, "info", "InfraGenie", f"📂 Reading project source: {Path(source).name if project.file_path else source}")
        try:
            summary = summarize_project_files(source)
        except ValueError as exc:
            _emit_log(r, db, project, "error", "InfraGenie", f"❌ {exc}")
            project.status = ProjectStatus.failed
            db.commit()
            try:
                r.publish(f"project_logs:{project_id}", json.dumps({"__done__": True, "error": str(exc)}))
            except Exception:
                pass
            return
        _emit_log(r, db, project, "info", "InfraGenie", f"✅ Source indexed — {len(summary)} chars of context")
        if project.source_type == "github":
            _emit_log(r, db, project, "success", "InfraGenie", "✅ Repository cloned — real stack detection enabled")

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

# artifact-type → file name written to ./deployment_output on "deploy"
_ARTIFACT_FILENAMES = {
    "docker": "docker-compose.yml",
    "terraform": "main.tf",
    "kubernetes": "deployment.yaml",
    "cicd": "workflow.yml",
    "monitoring": "prometheus.yml",
    "security": "security.md",
}


def task_run_deployment(deployment_id: str):
    """Simulate infrastructure provisioning + app deployment after approval.

    DEPLOYMENT_MODE semantics:
      - "simulate" (default): no cloud calls — steps are simulated, but the
        AI-generated artifacts are still written to ./deployment_output so the
        demo has tangible output.
      - "artifacts": same as simulate, artifacts always written.
    Real AWS/Azure/GCP provisioning requires wiring in provider credentials
    (Terraform CLI / provider SDKs) — a separate milestone.
    """
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
        logs["mode"] = settings.deployment_mode

        for step in steps:
            time.sleep(2)
            logs["deployment_steps"].append({
                "step": step, "status": "completed", "at": datetime.utcnow().isoformat()
            })

        # Write the AI-generated artifacts to disk (always — demo-visible output).
        artifact_dir = Path("deployment_output") / str(deployment.project_id) / str(deployment.id)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_files: list[str] = []
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
        logs["artifact_files"] = artifact_files
        logs["provisioning"] = (
            "simulated" + ("" if settings.deployment_mode == "simulate"
                           else " (artifacts written to ./deployment_output)")
        )

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