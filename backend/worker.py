"""
RQ Worker — run this process separately to consume background jobs.
  python worker.py

On Windows, RQ's UnixSignalDeathPenalty crashes because SIGALRM doesn't
exist. We replace it with a no-op class so jobs run without being killed
on timeout (job_timeout is set generously per-task in tasks.py instead).

IMPORTANT: this patch must be applied to `Worker`/`SimpleWorker` directly,
*after* they've been imported — not to `rq.timeouts.UnixSignalDeathPenalty`
before import. Merely doing `import rq.timeouts` first imports the `rq`
package itself (Python always imports a package's __init__.py before any
of its submodules), and rq/__init__.py already does
`from .worker import SimpleWorker, Worker` internally. That import binds
`Worker.death_penalty_class = UnixSignalDeathPenalty` using the *original*
class object before our patch ever runs — so patching the module attribute
first has no effect; SimpleWorker keeps using the real (SIGALRM-based)
class regardless. Setting the attribute on the classes themselves, after
they're imported, sidesteps that ordering problem entirely.
"""
import os
import socket
import subprocess
import sys
import time

from rq import Queue
from rq.worker import SimpleWorker, Worker
from rq.timeouts import BaseDeathPenalty

from config import settings
from tasks import get_redis_conn

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
REDIS_CONTAINER    = "vibrant_bohr"
REDIS_HOST         = "localhost"
REDIS_PORT         = 6379
DOCKER_DESKTOP_EXE = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def is_docker_running() -> bool:
    """Return True if the Docker daemon is reachable (docker info exits 0)."""
    result = subprocess.run(
        ["docker", "info"],
        capture_output=True, text=True
    )
    return result.returncode == 0


def is_container_running() -> bool:
    """
    Ask Docker directly whether the container is in 'running' state.
    More reliable than a port check — something else could be on :6379.
    """
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", REDIS_CONTAINER],
        capture_output=True, text=True
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


# ──────────────────────────────────────────────
# Three-step guard
# ──────────────────────────────────────────────
def ensure_redis():
    """
    Step 1 — ensure Docker Desktop is running      (daemon check)
    Step 2 — ensure the Redis container is running (docker inspect)
    Step 3 — ensure Redis is accepting connections (socket check, always runs)
    """

    # ── Step 1: Docker Desktop ─────────────────────────────────────────────
    if is_docker_running():
        print("[worker] Docker daemon is running.")
    else:
        print("[worker] Docker Desktop is not running — launching it...")

        if not os.path.exists(DOCKER_DESKTOP_EXE):
            raise RuntimeError(
                f"[worker] Docker Desktop not found at:\n  {DOCKER_DESKTOP_EXE}\n"
                f"Please start Docker Desktop manually and retry."
            )

        # Popen — don't block; Docker Desktop is a GUI app
        subprocess.Popen([DOCKER_DESKTOP_EXE])

        # Poll up to 60 s for the daemon to become ready
        print("[worker] Waiting for Docker daemon to be ready (this may take ~30s)...")
        for attempt in range(1, 61):
            time.sleep(1)
            if is_docker_running():
                print(f"[worker] Docker daemon is ready (took {attempt}s).")
                break
            print(f"[worker] Still waiting for Docker... ({attempt}/60)")
        else:
            raise RuntimeError(
                "[worker] Docker Desktop launched but the daemon never became "
                "ready after 60s. Try starting it manually."
            )

    # ── Step 2: Container state ────────────────────────────────────────────
    if is_container_running():
        print(f"[worker] Container '{REDIS_CONTAINER}' is already running.")
    else:
        print(f"[worker] Container '{REDIS_CONTAINER}' is stopped — starting it...")
        result = subprocess.run(
            ["docker", "start", REDIS_CONTAINER],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"[worker] Failed to start container '{REDIS_CONTAINER}':\n"
                f"{result.stderr}"
            )
        print(f"[worker] Container '{REDIS_CONTAINER}' started.")

    # ── Step 3: Redis readiness (always checked) ───────────────────────────
    for attempt in range(1, 11):
        with socket.socket() as s:
            try:
                s.connect((REDIS_HOST, REDIS_PORT))
                print("[worker] Redis is ready.")
                return
            except ConnectionRefusedError:
                print(f"[worker] Waiting for Redis to accept connections... ({attempt}/10)")
                time.sleep(1)

    raise RuntimeError(
        f"[worker] Redis never became ready on {REDIS_HOST}:{REDIS_PORT} after 10s.\n"
        f"Check container logs with:  docker logs {REDIS_CONTAINER}"
    )


# ──────────────────────────────────────────────
# Windows SIGALRM fix
# ──────────────────────────────────────────────
if sys.platform == "win32":
    class _NoopDeathPenalty(BaseDeathPenalty):
        """No-op death penalty for Windows — jobs won't be killed on timeout."""

        def setup_death_penalty(self):
            pass

        def cancel_death_penalty(self):
            pass

    Worker.death_penalty_class = _NoopDeathPenalty
    SimpleWorker.death_penalty_class = _NoopDeathPenalty


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    ensure_redis()

    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)

    if sys.platform == "win32":
        worker = SimpleWorker([queue], connection=conn)
    else:
        worker = Worker([queue], connection=conn)

    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()