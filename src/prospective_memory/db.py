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
CREATE TABLE IF NOT EXISTS jarvis_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    package TEXT NOT NULL DEFAULT '',
    app_label TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    otp TEXT,
    posted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_kind_posted ON jarvis_events(kind, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jarvis_expires ON jarvis_events(expires_at);
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
CREATE TABLE IF NOT EXISTS jarvis_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    package TEXT NOT NULL DEFAULT '',
    app_label TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    otp TEXT,
    posted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_kind_posted ON jarvis_events(kind, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jarvis_expires ON jarvis_events(expires_at);
"""


def _use_pg() -> bool:
    return bool(settings.resolved_database_url())


def _pg_connect():
    import psycopg
    from psycopg.rows import dict_row

    url = settings.resolved_database_url()
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    return conn


_PG_BOOTSTRAP = [s.strip() for s in PG_SCHEMA.split(";") if s.strip()]


def connect(db_path: Path | None = None):
    if _use_pg() and db_path is None:
        conn = _pg_connect()
        with conn.cursor() as cur:
            for stmt in _PG_BOOTSTRAP:
                cur.execute(stmt)
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
    return {
        "total": int(total),
        "by_status": by_status,
        "open_by_category": by_cat,
        "jarvis": jarvis_stats(db_path),
    }


def _purge_jarvis(conn: Any, db_path: Path | None = None) -> None:
    _execute(
        conn,
        "DELETE FROM jarvis_events WHERE expires_at < ?",
        (_now().isoformat(),),
        db_path,
    )


def ingest_jarvis_events(raw_events: list[dict], db_path: Path | None = None) -> dict:
    from prospective_memory.jarvis import normalize_event

    accepted = 0
    otp_live = False
    with open_db(db_path) as conn:
        _purge_jarvis(conn, db_path)
        for raw in raw_events:
            row = normalize_event(raw if isinstance(raw, dict) else dict(raw))
            if not row:
                continue
            _execute(
                conn,
                """
                INSERT INTO jarvis_events (
                    id, kind, package, app_label, title, text, otp,
                    posted_at, expires_at, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    kind=excluded.kind,
                    package=excluded.package,
                    app_label=excluded.app_label,
                    title=excluded.title,
                    text=excluded.text,
                    otp=excluded.otp,
                    posted_at=excluded.posted_at,
                    expires_at=excluded.expires_at
                """,
                (
                    row["id"],
                    row["kind"],
                    row["package"],
                    row["app_label"],
                    row["title"],
                    row["text"],
                    row["otp"],
                    row["posted_at"].isoformat(),
                    row["expires_at"].isoformat(),
                    row["created_at"].isoformat(),
                ),
                db_path,
            )
            accepted += 1
            if row["kind"] == "otp":
                otp_live = True
        conn.commit()
    return {"accepted": accepted, "otp_live": otp_live}


def latest_otp(db_path: Path | None = None) -> dict:
    now = _now()
    with open_db(db_path) as conn:
        _purge_jarvis(conn, db_path)
        conn.commit()
        cur = _execute(
            conn,
            """
            SELECT * FROM jarvis_events
            WHERE kind='otp' AND expires_at > ?
            ORDER BY posted_at DESC LIMIT 1
            """,
            (now.isoformat(),),
            db_path,
        )
        row = cur.fetchone()
    if not row:
        return {"found": False}
    posted = datetime.fromisoformat(_get(row, "posted_at"))
    expires = datetime.fromisoformat(_get(row, "expires_at"))
    code = _get(row, "otp") or ""
    age = max(0, int((now - posted).total_seconds()))
    left = max(0, int((expires - now).total_seconds()))
    return {
        "found": True,
        "code": code or None,
        "redacted": not bool(code),
        "from": _get(row, "title") or _get(row, "app_label") or "unknown",
        "app": _get(row, "app_label") or "",
        "age_seconds": age,
        "expires_in_seconds": left,
        "text": _get(row, "text") or "",
    }


def last_whatsapp(
    sender: str | None = None,
    limit: int = 10,
    db_path: Path | None = None,
) -> dict:
    limit = max(1, min(limit, 50))
    now = _now()
    filters = ["kind='whatsapp'", "expires_at > ?"]
    params: list[object] = [now.isoformat()]
    if sender and sender.strip():
        filters.append("title LIKE ?")
        params.append(f"%{sender.strip()}%")
    where = " AND ".join(filters)
    with open_db(db_path) as conn:
        _purge_jarvis(conn, db_path)
        conn.commit()
        cur = _execute(
            conn,
            f"""
            SELECT title, text, app_label, posted_at FROM jarvis_events
            WHERE {where}
            ORDER BY posted_at DESC LIMIT ?
            """,
            [*params, limit],
            db_path,
        )
        rows = cur.fetchall()
    messages = []
    for r in rows:
        posted = datetime.fromisoformat(_get(r, "posted_at"))
        messages.append(
            {
                "sender": _get(r, "title") or "unknown",
                "text": _get(r, "text") or "",
                "app": _get(r, "app_label") or "WhatsApp",
                "posted_at": posted.isoformat(),
                "age_seconds": max(0, int((now - posted).total_seconds())),
            }
        )
    return {"total": len(messages), "messages": messages}


def missed_summary(minutes: int = 60, db_path: Path | None = None) -> dict:
    minutes = max(1, min(minutes, 36 * 60))
    now = _now()
    since = datetime.fromtimestamp(now.timestamp() - minutes * 60, tz=timezone.utc)
    with open_db(db_path) as conn:
        _purge_jarvis(conn, db_path)
        conn.commit()
        cur = _execute(
            conn,
            """
            SELECT kind, title, text, app_label, posted_at FROM jarvis_events
            WHERE expires_at > ? AND posted_at >= ?
            ORDER BY posted_at DESC LIMIT 200
            """,
            (now.isoformat(), since.isoformat()),
            db_path,
        )
        rows = cur.fetchall()
    counts: dict[str, int] = {"otp": 0, "whatsapp": 0, "mail": 0, "sms": 0}
    groups: dict[tuple[str, str], dict] = {}
    for r in rows:
        kind = _get(r, "kind")
        if kind in counts:
            counts[kind] += 1
        title = _get(r, "title") or _get(r, "app_label") or "unknown"
        key = (kind, title)
        posted = datetime.fromisoformat(_get(r, "posted_at"))
        last_text = _get(r, "text") or ""
        if kind == "otp":
            last_text = "OTP"
        g = groups.get(key)
        if not g:
            groups[key] = {
                "kind": kind,
                "title": title,
                "count": 1,
                "last_text": last_text,
                "last_at": posted.isoformat(),
            }
        else:
            g["count"] += 1
    highlights = sorted(groups.values(), key=lambda x: x["last_at"], reverse=True)[:20]
    return {
        "window_minutes": minutes,
        "total": len(rows),
        "counts": counts,
        "highlights": highlights,
    }


def jarvis_stats(db_path: Path | None = None) -> dict:
    now = _now()
    with open_db(db_path) as conn:
        _purge_jarvis(conn, db_path)
        conn.commit()
        live = {
            _get(r, "kind"): _get(r, "c")
            for r in _execute(
                conn,
                """
                SELECT kind, COUNT(*) AS c FROM jarvis_events
                WHERE expires_at > ? GROUP BY kind
                """,
                (now.isoformat(),),
                db_path,
            ).fetchall()
        }
    return {"live_by_kind": {k: int(v) for k, v in live.items()}}
