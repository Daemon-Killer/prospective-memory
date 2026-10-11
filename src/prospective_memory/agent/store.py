"""Local, transactional storage for the Remy companion.

The ledger deliberately stores vetted events rather than notification credentials.
Quarantine is a conservative filter, not a general-purpose PII detector.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
import threading
from typing import Any, Iterator
from uuid import uuid4

from .shared_memory import (MAX_DEVICES, MAX_FACTS, MemoryConflict, MemoryLimit,
                            learning_summary)


_SECRET_MARKERS = re.compile(
    r"\b(?:otp|one[\s-]*time\s+(?:password|passcode|code)|"
    r"(?:verification|authentication|login|security)\s+(?:code|token)|"
    r"password|passcode|pin(?:\s+code)?|api[\s_-]*key|"
    r"(?:access|refresh)[\s_-]*token|secret[\s_-]*key|"
    r"recovery\s+(?:code|key)|private\s+key)\b|"
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}",
    re.IGNORECASE,
)
_EVENT_FIELDS = (
    "source", "source_event_id", "package", "title", "text", "occurred_at",
    "category", "sensitivity", "group_summary",
)
MAX_FACT_CONTEXT_BYTES = 512 * 1024


def _timestamp(value: str | datetime) -> str:
    """Use one UTC format so timestamp comparisons have chronological ordering."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Expected an ISO timestamp with a timezone.") from exc
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError("Expected an ISO timestamp with a timezone.")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _now() -> str:
    return _timestamp(datetime.now(timezone.utc))


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":"))


def _limit(value: int) -> int:
    if not isinstance(value, int) or value < 0:
        raise ValueError("Limit must be a nonnegative integer.")
    return value


class Store:
    """Each operation owns a connection; SQLite transactions arbitrate other writers."""

    def __init__(self, path: str):
        self._lock = threading.RLock()
        self._keeper: sqlite3.Connection | None = None
        if path == ":memory:":
            self._database = f"file:remy-companion-{uuid4().hex}?mode=memory&cache=shared"
            self._uri = True
            self._keeper = sqlite3.connect(self._database, uri=True, check_same_thread=False)
        else:
            database_path = Path(path)
            database_path.parent.mkdir(parents=True, exist_ok=True)
            self._database = str(database_path)
            self._uri = False
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    source_event_id TEXT NOT NULL,
                    package TEXT,
                    title TEXT NOT NULL,
                    text TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    category TEXT NOT NULL,
                    sensitivity TEXT NOT NULL,
                    group_summary INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    UNIQUE (source, source_event_id)
                );
                CREATE INDEX IF NOT EXISTS events_occurred_at ON events(occurred_at);
                CREATE TABLE IF NOT EXISTS reminders (
                    position INTEGER PRIMARY KEY,
                    payload_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS actions (
                    key TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'done')),
                    request_json TEXT,
                    result_json TEXT
                );
                CREATE TABLE IF NOT EXISTS personal_facts (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    value TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    source_device_id TEXT NOT NULL,
                    deleted INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS learning_snapshots (
                    device_id TEXT PRIMARY KEY,
                    sequence INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    state_json TEXT NOT NULL
                );
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(actions)")}
            if "request_json" not in columns:
                connection.execute("ALTER TABLE actions ADD COLUMN request_json TEXT")

    @contextmanager
    def _connection(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        with self._lock:
            connection = sqlite3.connect(
                self._database, uri=self._uri, timeout=30, isolation_level=None
            )
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA busy_timeout=30000")
            try:
                if write:
                    connection.execute("BEGIN IMMEDIATE")
                yield connection
                if write:
                    connection.commit()
            except BaseException:
                if write:
                    connection.rollback()
                raise
            finally:
                connection.close()

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        result["group_summary"] = bool(result["group_summary"])
        return result

    def ingest_event(self, event: dict) -> dict:
        title = str(event.get("title") or "")
        text = str(event.get("text") or "")
        if event.get("sensitivity", "normal") == "secret" or _SECRET_MARKERS.search(f"{title}\n{text}"):
            return {"status": "quarantined", "reason": "Sensitive authentication or credential content."}
        if event.get("group_summary", False):
            return {"status": "ignored", "reason": "Notification group summary."}
        source = str(event.get("source") or "").strip()
        source_event_id = str(event.get("source_event_id") or "").strip()
        if not source or not source_event_id:
            raise ValueError("An event needs a source and source_event_id.")
        category = event.get("category", "informational")
        sensitivity = event.get("sensitivity", "normal")
        if category not in {"informational", "action", "promotion"}:
            raise ValueError("Unknown event category.")
        if sensitivity != "normal":
            raise ValueError("Unknown event sensitivity.")
        normalized = {
            "source": source,
            "source_event_id": source_event_id,
            "package": event.get("package"),
            "title": title,
            "text": text,
            "occurred_at": _timestamp(event["occurred_at"]),
            "category": category,
            "sensitivity": sensitivity,
            "group_summary": False,
        }
        with self._connection(write=True) as connection:
            existing = connection.execute(
                "SELECT * FROM events WHERE source=? AND source_event_id=?", (source, source_event_id)
            ).fetchone()
            if existing is not None:
                previous = self._event(existing)
                if normalized["occurred_at"] < previous["occurred_at"]:
                    return {"status": "ignored", "reason": "stale_update", "event": previous}
                if all(previous[field] == normalized[field] for field in _EVENT_FIELDS):
                    return {"status": "duplicate", "event": previous}
                normalized.update(id=previous["id"], updated_at=_now())
                connection.execute(
                    """UPDATE events SET package=:package, title=:title, text=:text,
                    occurred_at=:occurred_at, category=:category, sensitivity=:sensitivity,
                    group_summary=:group_summary, updated_at=:updated_at WHERE id=:id""",
                    normalized,
                )
                return {"status": "updated", "event": normalized}
            normalized.update(id=str(uuid4()), updated_at=_now())
            connection.execute(
                """INSERT INTO events (id, source, source_event_id, package, title, text,
                occurred_at, category, sensitivity, group_summary, updated_at)
                VALUES (:id, :source, :source_event_id, :package, :title, :text,
                :occurred_at, :category, :sensitivity, :group_summary, :updated_at)""",
                normalized,
            )
            return {"status": "stored", "event": normalized}

    def search_events(self, query: str, limit: int = 50) -> list[dict]:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM events WHERE title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\'
                ORDER BY occurred_at DESC, updated_at DESC, id DESC LIMIT ?""",
                (pattern, pattern, _limit(limit)),
            ).fetchall()
            return [self._event(row) for row in rows]

    def recent_events(self, since_iso: str | None = None, limit: int = 50) -> list[dict]:
        with self._connection() as connection:
            if since_iso is None:
                rows = connection.execute(
                    "SELECT * FROM events ORDER BY occurred_at DESC, updated_at DESC, id DESC LIMIT ?",
                    (_limit(limit),),
                ).fetchall()
            else:
                rows = connection.execute(
                    """SELECT * FROM events WHERE occurred_at >= ?
                    ORDER BY occurred_at DESC, updated_at DESC, id DESC LIMIT ?""",
                    (_timestamp(since_iso), _limit(limit)),
                ).fetchall()
            return [self._event(row) for row in rows]

    def prune_events(self, before_iso: str) -> int:
        cutoff = _timestamp(before_iso)
        with self._connection(write=True) as connection:
            return connection.execute("DELETE FROM events WHERE occurred_at < ?", (cutoff,)).rowcount

    def replace_reminders(self, reminders: list[dict], synced_at: str) -> None:
        synced_at = _timestamp(synced_at)
        payloads = [_json(reminder) for reminder in reminders]
        with self._connection(write=True) as connection:
            connection.execute("DELETE FROM reminders")
            connection.executemany(
                "INSERT INTO reminders(position, payload_json) VALUES (?, ?)", enumerate(payloads)
            )
            connection.execute(
                """INSERT INTO metadata(key, value) VALUES ('reminders_synced_at', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (synced_at,),
            )

    def get_reminders(self) -> tuple[list[dict], str | None]:
        with self._connection() as connection:
            # Keep rows and their synchronization timestamp in the same read snapshot.
            connection.execute("BEGIN")
            rows = connection.execute("SELECT payload_json FROM reminders ORDER BY position").fetchall()
            synced = connection.execute(
                "SELECT value FROM metadata WHERE key='reminders_synced_at'"
            ).fetchone()
            return [json.loads(row["payload_json"]) for row in rows], synced["value"] if synced else None

    @staticmethod
    def _action(row: sqlite3.Row) -> dict:
        return {
            "status": row["status"],
            "fingerprint": row["fingerprint"],
            "request": json.loads(row["request_json"]) if row["request_json"] is not None else None,
            "result": json.loads(row["result_json"]) if row["result_json"] is not None else None,
        }

    def begin_action(self, key: str, fingerprint: str, request: dict | None = None) -> dict:
        if not key or not fingerprint:
            raise ValueError("An action needs a key and fingerprint.")
        request_json = _json(request) if request is not None else None
        with self._connection(write=True) as connection:
            existing = connection.execute("SELECT * FROM actions WHERE key=?", (key,)).fetchone()
            if existing is not None:
                if existing["fingerprint"] != fingerprint:
                    raise ValueError("Idempotency key was already used for a different action.")
                action = self._action(existing)
                return {**action, "status": "existing", "action_status": action["status"]}
            connection.execute(
                "INSERT INTO actions(key, fingerprint, status, request_json) VALUES (?, ?, 'pending', ?)",
                (key, fingerprint, request_json),
            )
            return {
                "status": "new", "action_status": "pending", "fingerprint": fingerprint,
                "request": request, "result": None,
            }

    def finish_action(self, key: str, result: dict) -> None:
        result_json = _json(result)
        with self._connection(write=True) as connection:
            existing = connection.execute("SELECT * FROM actions WHERE key=?", (key,)).fetchone()
            if existing is None:
                raise KeyError("Action has not been started.")
            if existing["status"] == "done" and existing["result_json"] != result_json:
                raise ValueError("A completed action result cannot be changed.")
            connection.execute(
                "UPDATE actions SET status='done', result_json=? WHERE key=?", (result_json, key)
            )

    def finish_action_once(self, key: str, result: dict) -> dict:
        """Commit the first acknowledgement and return it to every racing caller."""
        with self._connection(write=True) as connection:
            existing = connection.execute("SELECT * FROM actions WHERE key=?", (key,)).fetchone()
            if existing is None:
                raise KeyError("Action has not been started.")
            if existing["status"] == "done":
                return json.loads(existing["result_json"])
            result_json = _json(result)
            connection.execute(
                "UPDATE actions SET status='done', result_json=? WHERE key=?", (result_json, key)
            )
            return json.loads(result_json)

    def get_action(self, key: str) -> dict | None:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM actions WHERE key=?", (key,)).fetchone()
            return self._action(row) if row is not None else None

    @staticmethod
    def _fact(row) -> dict:
        fact = dict(row)
        fact["deleted"] = bool(fact["deleted"])
        return fact

    def list_facts(self, *, include_deleted: bool = False) -> list[dict]:
        with self._connection() as connection:
            return [self._fact(row) for row in connection.execute(
                "SELECT * FROM personal_facts" + ("" if include_deleted else " WHERE deleted=0") + " ORDER BY id"
            ).fetchall()]

    def put_fact(self, fact_id: str, request: dict, updated_at: str) -> dict:
        stamp = _timestamp(updated_at)
        with self._connection(write=True) as connection:
            row = connection.execute("SELECT * FROM personal_facts WHERE id=?", (fact_id,)).fetchone()
            current = self._fact(row) if row is not None else None
            base = request["base_revision"]
            if current is None:
                if base != 0:
                    raise MemoryConflict("revision_conflict", None)
                if connection.execute("SELECT count(*) FROM personal_facts").fetchone()[0] >= MAX_FACTS:
                    raise MemoryLimit()
                revision = 1
            else:
                same = not current["deleted"] and all(
                    current[key] == request[key] for key in ("value", "kind", "source_device_id")
                )
                if same and base in {current["revision"], current["revision"] - 1}:
                    # An acknowledgement may have been lost. Exact retries are
                    # no-ops, including across a process restart.
                    return current
                if base != current["revision"]:
                    raise MemoryConflict("revision_conflict", current)
                revision = current["revision"] + 1
            result = {"id": fact_id, "kind": request["kind"], "value": request["value"],
                      "revision": revision, "updated_at": stamp,
                      "source_device_id": request["source_device_id"], "deleted": False}
            other_facts = [self._fact(item) for item in connection.execute(
                "SELECT * FROM personal_facts WHERE deleted=0 AND id<>?", (fact_id,)
            ).fetchall()]
            # Bound the actual UTF-8 response representation, including record
            # metadata. A character count misses multibyte personal notes.
            if len(_json({"facts": [*other_facts, result]}).encode("utf-8")) > MAX_FACT_CONTEXT_BYTES:
                raise MemoryLimit()
            connection.execute(
                """INSERT INTO personal_facts(id,kind,value,revision,updated_at,source_device_id,deleted)
                VALUES (:id,:kind,:value,:revision,:updated_at,:source_device_id,:deleted)
                ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,value=excluded.value,
                revision=excluded.revision,updated_at=excluded.updated_at,
                source_device_id=excluded.source_device_id,deleted=excluded.deleted""", result
            )
            return result

    def delete_fact(self, fact_id: str, revision: int, updated_at: str) -> dict | None:
        stamp = _timestamp(updated_at)
        with self._connection(write=True) as connection:
            row = connection.execute("SELECT * FROM personal_facts WHERE id=?", (fact_id,)).fetchone()
            if row is None:
                return None
            current = self._fact(row)
            if current["deleted"] and revision in {current["revision"], current["revision"] - 1}:
                return current
            if revision != current["revision"]:
                raise MemoryConflict("revision_conflict", current)
            result = {**current, "value": "", "revision": revision + 1, "deleted": True, "updated_at": stamp}
            connection.execute(
                "UPDATE personal_facts SET value='',revision=?,deleted=1,updated_at=? WHERE id=?",
                (result["revision"], stamp, fact_id),
            )
            return result

    def sync_learning(self, device_id: str, sequence: int, state: dict, updated_at: str) -> dict:
        stamp = _timestamp(updated_at)
        state_json = _json(state)
        with self._connection(write=True) as connection:
            row = connection.execute("SELECT * FROM learning_snapshots WHERE device_id=?", (device_id,)).fetchone()
            status = "stored"
            if row is not None:
                if sequence < row["sequence"]:
                    status = "ignored"
                elif sequence == row["sequence"]:
                    if state_json != row["state_json"]:
                        raise MemoryConflict("sequence_conflict", row["sequence"])
                    status = "duplicate"
                else:
                    status = "updated"
                if status in {"ignored", "duplicate"}:
                    return {"status": status, "device": learning_summary(
                        device_id, row["sequence"], row["updated_at"], json.loads(row["state_json"]))}
            elif connection.execute("SELECT count(*) FROM learning_snapshots").fetchone()[0] >= MAX_DEVICES:
                raise MemoryLimit()
            connection.execute(
                """INSERT INTO learning_snapshots(device_id,sequence,updated_at,state_json) VALUES(?,?,?,?)
                ON CONFLICT(device_id) DO UPDATE SET sequence=excluded.sequence,
                updated_at=excluded.updated_at,state_json=excluded.state_json""",
                (device_id, sequence, stamp, state_json),
            )
            return {"status": status, "device": learning_summary(device_id, sequence, stamp, state)}

    def get_personal_context(self) -> tuple[list[dict], list[dict]]:
        with self._connection() as connection:
            connection.execute("BEGIN")
            facts = [self._fact(row) for row in connection.execute(
                "SELECT * FROM personal_facts WHERE deleted=0 ORDER BY id").fetchall()]
            snapshots = [{"device_id": row["device_id"], "sequence": row["sequence"],
                          "updated_at": row["updated_at"], "state": json.loads(row["state_json"])}
                         for row in connection.execute("SELECT * FROM learning_snapshots ORDER BY device_id").fetchall()]
            return facts, snapshots
