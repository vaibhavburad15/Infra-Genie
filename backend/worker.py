"""
RQ Worker — run this process separately to consume background jobs.
  python worker.py

On Windows, RQ's UnixSignalDeathPenalty crashes because SIGALRM doesn't
exist. We replace it with a no-op class before any job runs.
"""
import sys

# ── Patch RQ's death penalty before importing anything else from rq ───────────
if sys.platform == "win32":
    import rq.timeouts as _rq_timeouts

    class _NoopDeathPenalty(_rq_timeouts.BaseDeathPenalty):
        """No-op death penalty for Windows — jobs won't be killed on timeout."""

        def setup_death_penalty(self):
            pass

        def cancel_death_penalty(self):
            pass

        def handle_death_penalty(self, signum, frame):
            pass

    # Replace the Unix-only class so SimpleWorker picks up our version
    _rq_timeouts.UnixSignalDeathPenalty = _NoopDeathPenalty  # type: ignore[attr-defined]

# ── Normal imports ────────────────────────────────────────────────────────────
from rq import Queue
from rq.worker import SimpleWorker, Worker

from config import settings
from tasks import get_redis_conn


if __name__ == "__main__":
    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)

    if sys.platform == "win32":
        worker = SimpleWorker([queue], connection=conn)
    else:
        worker = Worker([queue], connection=conn)

    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()
