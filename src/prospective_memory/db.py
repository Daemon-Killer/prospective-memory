from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from prospective_memory.config import settings
from prospective_memory.infer import infer
from prospective_memory.models import Task, TaskStatus, TriggerType

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    raw TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'inbox',
    trigger_type TEXT NOT NULL DEFAULT 'none',
    trigger_detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
"""

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    raw TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'inbox',
    trigger_type TEXT NOT NULL DEFAULT 'none',
    trigger_detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'api',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
"""


def _use_pg() -> bool:
    return bool(settings.resolved_database_url())


def _pg_connect():
    import psycopg
    from psycopg.rows import dict_row

    url = settings.resolved_database_url()
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    return conn


def connect(db_path: Path | None = None):
    if _use_pg() and db_path is None:
        conn = _pg_connect()
        with conn.cursor() as cur:
            cur.execute(PG_SCHEMA)
        conn.commit()
        return conn
    settings.ensure()
    path = (db_path or settings.db_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript(SQLITE_SCHEMA)
    conn.commit()
    return conn


@contextmanager
def open_db(db_path: Path | None = None) -> Iterator[Any]:
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


def _sql(sql: str, db_path: Path | None = None) -> str:
    if _use_pg() and db_path is None:
        return sql.replace("?", "%s")
    return sql


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get(r: Any, key: str) -> Any:
    if isinstance(r, dict):
        return r[key]
    return r[key]


def _row(r: Any) -> Task:
    return Task(
        id=_get(r, "id"),
        text=_get(r, "text"),
        raw=_get(r, "raw"),
        category=_get(r, "category"),
        trigger_type=TriggerType(_get(r, "trigger_type")),
        trigger_detail=_get(r, "trigger_detail") or "",
        status=TaskStatus(_get(r, "status")),
        confidence=float(_get(r, "confidence")),
        source=_get(r, "source"),
        created_at=datetime.fromisoformat(_get(r, "created_at")),
        updated_at=datetime.fromisoformat(_get(r, "updated_at")),
        completed_at=(
            datetime.fromisoformat(_get(r, "completed_at")) if _get(r, "completed_at") else None
        ),
    )


def _execute(conn: Any, sql: str, params: tuple | list = (), db_path: Path | None = None):
    q = _sql(sql, db_path)
    if _use_pg() and db_path is None:
        cur = conn.cursor()
        cur.execute(q, params)
        return cur
    return conn.execute(q, params)


def capture(text: str, source: str = "api", db_path: Path | None = None) -> Task:
    raw = text.strip()
    if not raw:
        raise ValueError("empty capture")
    guessed = infer(raw)
    now = _now()
    task = Task(
        id=uuid4().hex[:16],
        text=raw,
        raw=raw,
        category=str(guessed["category"]),
        trigger_type=guessed["trigger_type"],
        trigger_detail=str(guessed["trigger_detail"]),
        status=TaskStatus.OPEN,
        confidence=float(guessed["confidence"]),
        source=source,
        created_at=now,
        updated_at=now,
    )
    with open_db(db_path) as conn:
        _execute(
            conn,
            """
            INSERT INTO tasks (
                id, text, raw, category, trigger_type, trigger_detail,
                status, confidence, source, created_at, updated_at, completed_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                task.id,
                task.text,
                task.raw,
                task.category,
                task.trigger_type.value,
                task.trigger_detail,
                task.status.value,
                task.confidence,
                task.source,
                task.created_at.isoformat(),
                task.updated_at.isoformat(),
                None,
            ),
            db_path,
        )
        conn.commit()
    return task


def list_tasks(
    *,
    status: str | None = "open",
    category: str | None = None,
    query: str | None = None,
    limit: int = 50,
    db_path: Path | None = None,
) -> list[Task]:
    limit = max(1, min(limit, 200))
    filters: list[str] = []
    params: list[object] = []
    if status:
        filters.append("status = ?")
        params.append(status)
    if category:
        filters.append("category = ?")
        params.append(category)
    if query and query.strip():
        filters.append("(text LIKE ? OR category LIKE ? OR trigger_detail LIKE ?)")
        like = f"%{query.strip()}%"
        params.extend([like, like, like])
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    with open_db(db_path) as conn:
        cur = _execute(
            conn,
            f"SELECT * FROM tasks {where} ORDER BY created_at DESC LIMIT ?",
            [*params, limit],
            db_path,
        )
        rows = cur.fetchall()
    return [_row(r) for r in rows]


def set_status(task_id: str, status: TaskStatus, db_path: Path | None = None) -> Task | None:
    now = _now()
    completed = now.isoformat() if status in {TaskStatus.DONE, TaskStatus.DROPPED} else None
    with open_db(db_path) as conn:
        _execute(
            conn,
            """
            UPDATE tasks SET status=?, updated_at=?, completed_at=?
            WHERE id=?
            """,
            (status.value, now.isoformat(), completed, task_id),
            db_path,
        )
        conn.commit()
        cur = _execute(conn, "SELECT * FROM tasks WHERE id=?", (task_id,), db_path)
        row = cur.fetchone()
    return _row(row) if row else None


def stats(db_path: Path | None = None) -> dict:
    with open_db(db_path) as conn:
        total = _get(_execute(conn, "SELECT COUNT(*) AS c FROM tasks", db_path=db_path).fetchone(), "c")
        by_status = {
            _get(r, "status"): _get(r, "c")
            for r in _execute(
                conn,
                "SELECT status, COUNT(*) AS c FROM tasks GROUP BY status",
                db_path=db_path,
            ).fetchall()
        }
        by_cat = {
            _get(r, "category"): _get(r, "c")
            for r in _execute(
                conn,
                "SELECT category, COUNT(*) AS c FROM tasks WHERE status='open' GROUP BY category",
                db_path=db_path,
            ).fetchall()
        }
    return {"total": int(total), "by_status": by_status, "open_by_category": by_cat}
