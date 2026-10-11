"""
InfraGenie — Database Migration v5

Adds the columns introduced in the v5 deployment engine to the existing
`deployments` table using raw DDL via psycopg2 so this script can run
independently without Alembic.

Run once:
    cd backend
    python migrate_v5.py

The script is idempotent — it skips columns that already exist.
It also widens the DeploymentStatus enum to include the new states.
"""
import sys
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

from config import settings


# All columns we want to add to the deployments table.
# (column_name, DDL type)
NEW_COLUMNS = [
    ("strategy_json",        "JSONB"),
    ("strategy_digest",      "VARCHAR(64)"),
    ("apply_started_at",     "TIMESTAMP"),
    ("infra_status",         "VARCHAR(50)"),
    ("app_deploy_status",    "VARCHAR(50)"),
    ("verification_status",  "VARCHAR(50)"),
    ("verification_results", "JSONB"),
]

# New enum values to add to the deploymentstatus PostgreSQL enum.
# Order matters — PostgreSQL adds them after the last existing value.
NEW_ENUM_VALUES = [
    "analyzing",
    "strategy_ready",
    "infrastructure_ready",
    "deploying_application",
    "verifying",
    "strategy_failed",
    "artifact_failed",
    "plan_failed",
    "apply_failed",
    "application_deploy_failed",
    "verification_failed",
]

# Convert asyncpg URL (postgresql+asyncpg://...) to psycopg2 format.
_db_url = settings.database_url
if "+asyncpg" in _db_url:
    _db_url = _db_url.replace("postgresql+asyncpg://", "postgresql://")
elif _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)


def _connect():
    conn = psycopg2.connect(_db_url)
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    return conn


def _existing_columns(cur, table: str) -> set:
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = %s",
        (table,),
    )
    return {row[0] for row in cur.fetchall()}


def _existing_enum_values(cur, enum_type: str) -> set:
    cur.execute(
        "SELECT enumlabel FROM pg_enum "
        "JOIN pg_type ON pg_enum.enumtypid = pg_type.oid "
        "WHERE pg_type.typname = %s",
        (enum_type,),
    )
    return {row[0] for row in cur.fetchall()}


def migrate():
    print("[migrate_v5] Connecting to database…")
    conn = _connect()
    cur = conn.cursor()

    # ── 1. Widen the DeploymentStatus enum ───────────────────────────────────
    existing_enum = _existing_enum_values(cur, "deploymentstatus")
    added_enum = []
    for value in NEW_ENUM_VALUES:
        if value not in existing_enum:
            cur.execute(
                f"ALTER TYPE deploymentstatus ADD VALUE IF NOT EXISTS %s",
                (value,),
            )
            added_enum.append(value)
    if added_enum:
        print(f"[migrate_v5] Added enum values: {added_enum}")
    else:
        print("[migrate_v5] DeploymentStatus enum: all values already present.")

    # ── 2. Add new columns to deployments ────────────────────────────────────
    existing_cols = _existing_columns(cur, "deployments")
    added_cols = []
    for col_name, col_type in NEW_COLUMNS:
        if col_name not in existing_cols:
            cur.execute(
                f'ALTER TABLE deployments ADD COLUMN "{col_name}" {col_type}'
            )
            added_cols.append(col_name)
    if added_cols:
        print(f"[migrate_v5] Added columns: {added_cols}")
    else:
        print("[migrate_v5] Deployment columns: all already present.")

    cur.close()
    conn.close()
    print("[migrate_v5] Migration complete.")


if __name__ == "__main__":
    try:
        migrate()
    except Exception as exc:
        print(f"[migrate_v5] ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
