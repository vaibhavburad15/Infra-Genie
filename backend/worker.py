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
import sys

from rq import Queue
from rq.worker import SimpleWorker, Worker
from rq.timeouts import BaseDeathPenalty

from config import settings
from tasks import get_redis_conn

if sys.platform == "win32":
    class _NoopDeathPenalty(BaseDeathPenalty):
        """No-op death penalty for Windows — jobs won't be killed on timeout."""

        def setup_death_penalty(self):
            pass

        def cancel_death_penalty(self):
            pass

    Worker.death_penalty_class = _NoopDeathPenalty
    SimpleWorker.death_penalty_class = _NoopDeathPenalty


if __name__ == "__main__":
    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)

    if sys.platform == "win32":
        worker = SimpleWorker([queue], connection=conn)
    else:
        worker = Worker([queue], connection=conn)

    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()
    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)

    if sys.platform == "win32":
        worker = SimpleWorker([queue], connection=conn)
    else:
        worker = Worker([queue], connection=conn)

    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()