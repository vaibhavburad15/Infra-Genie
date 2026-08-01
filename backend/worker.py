"""
RQ Worker — run this process separately to consume background jobs.
  python worker.py
"""
import redis
from rq import Worker, Queue

from config import settings
from tasks import get_redis_conn

if __name__ == "__main__":
    conn = get_redis_conn()
    queue = Queue("infragenie", connection=conn)
    worker = Worker([queue], connection=conn)
    print("InfraGenie worker started, listening on queue: infragenie")
    worker.work()
