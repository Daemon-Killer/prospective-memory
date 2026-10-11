"""PostgreSQL persistence for the existing Store contract.

Only fixed, application-owned SQL is translated. The companion uses its own
schema and never modifies Remy's reminder tables. No connection details are
logged, and failed transactions are not retried automatically.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
import re
import threading

from .store import Store


SCHEMA = "remy_agent"
# Every companion writer uses this transaction lock, including separate server
# processes. It protects compare-and-swap checks and first-row insertion races.
WRITE_LOCK_ID = 5932454803287373

_SCHEMA_STATEMENTS = (
    "CREATE SCHEMA IF NOT EXISTS remy_agent",
    """CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_event_id TEXT NOT NULL,
        package TEXT, title TEXT NOT NULL, text TEXT NOT NULL,
        occurred_at TEXT NOT NULL, category TEXT NOT NULL, sensitivity TEXT NOT NULL,
        group_summary INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
        UNIQUE(source, source_event_id))""",
    "CREATE INDEX IF NOT EXISTS events_occurred_at ON events(occurred_at)",
    """CREATE TABLE IF NOT EXISTS reminders (
        position INTEGER PRIMARY KEY, payload_json TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY, value TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS actions (
        key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','done')),
        request_json TEXT, result_json TEXT)""",
    """CREATE TABLE IF NOT EXISTS personal_facts (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
        revision BIGINT NOT NULL, updated_at TEXT NOT NULL,
        source_device_id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)""",
    """CREATE TABLE IF NOT EXISTS learning_snapshots (
        device_id TEXT PRIMARY KEY, sequence BIGINT NOT NULL,
        updated_at TEXT NOT NULL, state_json TEXT NOT NULL)""",
    # Permit a companion database created by the earlier action schema to open.
    "ALTER TABLE actions ADD COLUMN IF NOT EXISTS request_json TEXT",
)


def _translate_sql(sql: str) -> str:
    """Translate placeholders and SQLite's case-insensitive LIKE outside quotes.

    This is a compatibility layer for trusted Store statements, not a SQL parser
    for user input. Values always remain bound driver parameters.
    """
    pieces = []
    position = 0
    while position < len(sql):
        char = sql[position]
        if char in {"'", '"'}:
            start, quote = position, char
            position += 1
            while position < len(sql):
                if sql[position] == quote:
                    position += 1
                    if position < len(sql) and sql[position] == quote:
                        position += 1
                        continue
                    break
                position += 1
            pieces.append(sql[start:position])
        elif char == "?":
            pieces.append("%s")
            position += 1
        elif char == ":" and (position == 0 or sql[position - 1] != ":"):
            match = re.match(r":([A-Za-z_][A-Za-z0-9_]*)", sql[position:])
            if match:
                pieces.append("%(" + match.group(1) + ")s")
                position += len(match.group(0))
            else:
                pieces.append(char)
                position += 1
        elif char.isalpha() or char == "_":
            match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", sql[position:])
            if match is None:  # Store statements use ASCII identifiers.
                pieces.append(char)
                position += 1
                continue
            word = match.group(0)
            pieces.append("ILIKE" if word.upper() == "LIKE" else word)
            position += len(word)
        else:
            pieces.append(char)
            position += 1
    return "".join(pieces)


def _parameters(parameters):
    def value(item):
        return int(item) if isinstance(item, bool) else item

    if parameters is None:
        return None
    if isinstance(parameters, Mapping):
        return {key: value(item) for key, item in parameters.items()}
    return tuple(value(item) for item in parameters)


class _Row(Mapping):
    """Like sqlite3.Row, support named lookup, integer lookup and dict(row)."""

    def __init__(self, row: Mapping):
        self._data = dict(row)
        self._values = tuple(row.values())

    def __getitem__(self, key):
        return self._values[key] if isinstance(key, int) else self._data[key]

    def __iter__(self):
        return iter(self._data)

    def __len__(self):
        return len(self._data)


class _Cursor:
    def __init__(self, cursor=None):
        self._cursor = cursor

    @property
    def rowcount(self):
        return self._cursor.rowcount if self._cursor is not None else -1

    def fetchone(self):
        row = self._cursor.fetchone() if self._cursor is not None else None
        return _Row(row) if row is not None else None

    def fetchall(self):
        return [_Row(row) for row in self._cursor.fetchall()] if self._cursor is not None else []


class _Connection:
    def __init__(self, connection):
        self._connection = connection
        self._cursors = []

    def execute(self, sql, parameters=None):
        if re.fullmatch(r"BEGIN(?:\s+(?:TRANSACTION|IMMEDIATE))?\s*;?", sql.strip(), re.IGNORECASE):
            # Store starts a read snapshot explicitly in two methods. The outer
            # PostgreSQL transaction already provides that snapshot.
            return _Cursor()
        cursor = self._connection.execute(_translate_sql(sql), _parameters(parameters))
        self._cursors.append(cursor)
        return _Cursor(cursor)

    def executemany(self, sql, parameters):
        cursor = self._connection.cursor()
        self._cursors.append(cursor)
        cursor.executemany(_translate_sql(sql), (_parameters(item) for item in parameters))
        return _Cursor(cursor)

    def close_cursors(self):
        for cursor in self._cursors:
            cursor.close()
        self._cursors.clear()


class PostgresStore(Store):
    """A Store backed by PostgreSQL, with one serialized reusable connection."""

    def __init__(self, dsn: str, *, connect_factory=None):
        if not isinstance(dsn, str) or not dsn.strip():
            raise ValueError("PostgreSQL connection configuration is required.")
        self._dsn = dsn
        self._lock = threading.RLock()
        self._postgres = None
        self._keeper = None
        self._connect_factory = connect_factory
        try:
            with self._connection(write=True) as connection:
                for statement in _SCHEMA_STATEMENTS:
                    connection.execute(statement)
        except BaseException:
            self.close()
            raise

    def _get_connection(self):
        if self._postgres is None or self._postgres.closed:
            if self._connect_factory is not None:
                connection = self._connect_factory(self._dsn)
                connection.autocommit = True
            else:
                # SQLite-only installations do not need psycopg installed.
                import psycopg
                from psycopg.rows import dict_row

                connection = psycopg.connect(self._dsn, autocommit=True,
                    row_factory=dict_row, connect_timeout=10, application_name="remy-personal-agent")
            self._postgres = connection
        return self._postgres

    @contextmanager
    def _connection(self, *, write: bool = False):
        with self._lock:
            connection = self._get_connection()
            # No retry surrounds this block. A lost commit acknowledgement is
            # resolved through the Store's durable IDs/revisions on a later call.
            with connection.transaction():
                wrapper = _Connection(connection)
                try:
                    wrapper.execute("SET TRANSACTION ISOLATION LEVEL " + ("READ COMMITTED" if write else "REPEATABLE READ"))
                    wrapper.execute("SET LOCAL search_path TO remy_agent")
                    if write:
                        wrapper.execute("SELECT pg_advisory_xact_lock(?)", (WRITE_LOCK_ID,))
                    yield wrapper
                finally:
                    wrapper.close_cursors()

    def ping(self) -> bool:
        """Check the live connection without returning database configuration."""
        with self._connection() as connection:
            return connection.execute("SELECT 1 AS alive").fetchone()["alive"] == 1

    def close(self) -> None:
        with self._lock:
            if self._postgres is not None:
                self._postgres.close()
                self._postgres = None
