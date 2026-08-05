"""
RQ Worker — run this process separately to consume background jobs.
  python worker.py
"""
import sys
import redis
from rq import Queue
from rq.worker import BaseWorker, SimpleWorker, Worker

from config import settings
from tasks import get_redis_conn

if __name__ == "__main__":
    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)

    # os.fork() is not available on Windows; use SimpleWorker which runs
    # jobs in the same process instead of forking a child process.
    WorkerClass: type[BaseWorker] = SimpleWorker if sys.platform == "win32" else Worker

    worker = WorkerClass([queue], connection=conn)
    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()
