from contextlib import contextmanager

import pytest

from prospective_memory.agent.postgres_store import (
    PostgresStore, WRITE_LOCK_ID, _Connection, _Row, _parameters, _translate_sql,
)


class FakeCursor:
    def __init__(self, owner, rows=None, rowcount=0):
        self.owner = owner
        self.rows = list(rows or [])
        self.rowcount = rowcount
        self.closed = False

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows

    def executemany(self, sql, parameters):
        values = list(parameters)
        self.owner.calls.append((sql, values))
        self.rowcount = len(values)

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self):
        self.calls = []
        self.cursors = []
        self.closed = False
        self.autocommit = False
        self.failure = None
        self.commit_failure = None
        self.rows = {}

    def execute(self, sql, parameters=None):
        self.calls.append((sql, parameters))
        if self.failure and self.failure in sql:
            raise RuntimeError("simulated database error")
        result = self.rows.get(sql, [])
        cursor = FakeCursor(self, result, len(result))
        self.cursors.append(cursor)
        return cursor

    def cursor(self):
        cursor = FakeCursor(self)
        self.cursors.append(cursor)
        return cursor

    @contextmanager
    def transaction(self):
        self.calls.append(("TRANSACTION BEGIN", None))
        try:
            yield
        except BaseException:
            self.calls.append(("TRANSACTION ROLLBACK", None))
            raise
        else:
            self.calls.append(("TRANSACTION COMMIT", None))
            if self.commit_failure:
                raise self.commit_failure

    def close(self):
        self.closed = True


@pytest.fixture
def setup():
    connections = []

    def connect(_dsn):
        connection = FakeConnection()
        connections.append(connection)
        return connection

    store = PostgresStore("postgresql://fake", connect_factory=connect)
    yield store, connections
    store.close()


def test_translate_only_trusted_sql_syntax_outside_quoted_text():
    sql = "SELECT '?', ':ignored', 'LIKE', 'it''s ? LIKE', \"LIKE\", a LIKE ?, b=:value, c::text FROM facts"
    assert _translate_sql(sql) == "SELECT '?', ':ignored', 'LIKE', 'it''s ? LIKE', \"LIKE\", a ILIKE %s, b=%(value)s, c::text FROM facts"
    assert _translate_sql("SELECT dislike, alike, x like :pattern") == "SELECT dislike, alike, x ILIKE %(pattern)s"


def test_bound_values_remain_values_and_booleans_match_integer_columns():
    sentinel = "' OR 1=1 -- ? :value LIKE"
    assert _parameters({"text": sentinel, "deleted": False, "summary": True, "optional": None}) == {
        "text": sentinel, "deleted": 0, "summary": 1, "optional": None,
    }
    assert _parameters([True, False, 3, sentinel]) == (1, 0, 3, sentinel)
    assert _parameters(None) is None


def test_rows_support_sqlite_index_and_mapping_operations():
    row = _Row({"count": 7, "text": "hello"})
    assert row[0] == row["count"] == 7
    assert row[1] == row[-1] == "hello"
    assert dict(row) == {"count": 7, "text": "hello"}
    assert list(row.keys()) == ["count", "text"]


def test_wrapper_cursor_results_bulk_parameters_and_inner_begin():
    raw = FakeConnection()
    raw.rows["SELECT value FROM metadata WHERE key=%s"] = [{"value": "saved"}]
    connection = _Connection(raw)
    cursor = connection.execute("SELECT value FROM metadata WHERE key=?", ("profile",))
    assert cursor.fetchone()[0] == "saved"
    assert cursor.fetchone() is None
    connection.execute("BEGIN")
    connection.execute("BEGIN IMMEDIATE;")
    assert not any(sql.startswith("BEGIN") for sql, _ in raw.calls)
    many = connection.executemany("INSERT INTO reminders(position,payload_json) VALUES (?,?)", enumerate(["a", "b"]))
    assert many.rowcount == 2
    assert raw.calls[-1] == ("INSERT INTO reminders(position,payload_json) VALUES (%s,%s)", [(0, "a"), (1, "b")])
    connection.close_cursors()
    assert all(cursor.closed for cursor in raw.cursors)


def test_initialization_uses_one_atomic_schema_transaction(setup):
    _, connections = setup
    assert len(connections) == 1
    connection = connections[0]
    statements = [sql for sql, _ in connection.calls]
    assert connection.autocommit
    assert statements[0] == "TRANSACTION BEGIN"
    assert statements[1:3] == ["SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET LOCAL search_path TO remy_agent"]
    assert connection.calls[3] == ("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK_ID,))
    assert statements[4] == "CREATE SCHEMA IF NOT EXISTS remy_agent"
    assert sum(statement.startswith("CREATE TABLE IF NOT EXISTS") for statement in statements) == 6
    assert any("revision BIGINT" in statement for statement in statements)
    assert any("sequence BIGINT" in statement for statement in statements)
    assert statements[-1] == "TRANSACTION COMMIT"
    assert all(cursor.closed for cursor in connection.cursors)


def test_reads_share_repeatable_snapshot_without_writer_lock(setup):
    store, connections = setup
    connection = connections[0]
    connection.calls.clear()
    connection.rows["SELECT value FROM metadata WHERE key='reminders_synced_at'"] = [{"value": "2026-10-11T12:00:00Z"}]
    connection.rows["SELECT payload_json FROM reminders ORDER BY position"] = [{"payload_json": '{"id":"r1"}'}]
    assert store.get_reminders() == ([{"id": "r1"}], "2026-10-11T12:00:00Z")
    statements = [sql for sql, _ in connection.calls]
    assert statements[1] == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
    assert not any("advisory" in statement for statement in statements)
    assert statements.count("TRANSACTION BEGIN") == 1
    assert "BEGIN" not in statements
    assert statements[-1] == "TRANSACTION COMMIT"
    assert len(connections) == 1


def test_writes_use_advisory_lock_and_existing_store_methods(setup):
    store, connections = setup
    connection = connections[0]
    connection.calls.clear()
    connection.rows["SELECT count(*) FROM personal_facts"] = [{"count": 0}]
    request = {"base_revision": 0, "kind": "goal", "value": "Learn backend", "source_device_id": "phone-1"}
    result = store.put_fact("goal-1", request, "2026-10-11T12:00:00Z")
    assert result["revision"] == 1 and result["deleted"] is False
    assert connection.calls[1][0] == "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
    assert connection.calls[3] == ("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK_ID,))
    insert = next((sql, values) for sql, values in connection.calls if sql.startswith("INSERT INTO personal_facts"))
    assert "%(id)s" in insert[0] and insert[1]["deleted"] == 0
    assert connection.calls[-1][0] == "TRANSACTION COMMIT"


def test_literal_search_uses_ilike_with_escaped_bound_query(setup):
    store, connections = setup
    connection = connections[0]
    connection.calls.clear()
    assert store.search_events("100%_done") == []
    sql, parameters = next((sql, parameters) for sql, parameters in connection.calls if sql.startswith("SELECT * FROM events"))
    assert "title ILIKE %s" in sql and "text ILIKE %s" in sql
    assert parameters == ("%100\\%\\_done%", "%100\\%\\_done%", 50)


def test_write_failure_rolls_back_and_is_never_automatically_retried(setup):
    store, connections = setup
    connection = connections[0]
    connection.calls.clear()
    connection.failure = "INSERT INTO reminders"
    with pytest.raises(RuntimeError, match="simulated database error"):
        with store._connection(write=True) as transaction:
            transaction.execute("DELETE FROM reminders")
            transaction.execute("INSERT INTO reminders(position,payload_json) VALUES (?,?)", (0, "{}"))
    assert connection.calls[-1][0] == "TRANSACTION ROLLBACK"
    assert sum(sql.startswith("INSERT INTO reminders") for sql, _ in connection.calls) == 1
    assert len(connections) == 1
    assert all(cursor.closed for cursor in connection.cursors)


def test_ambiguous_commit_is_not_retried(setup):
    store, connections = setup
    connection = connections[0]
    connection.calls.clear()
    connection.commit_failure = RuntimeError("lost commit acknowledgement")
    with pytest.raises(RuntimeError, match="lost commit acknowledgement"):
        store.prune_events("2026-09-01T00:00:00Z")
    assert len(connections) == 1
    assert sum(sql.startswith("DELETE FROM events") for sql, _ in connection.calls) == 1


def test_closed_connection_reconnects_only_on_next_operation(setup):
    store, connections = setup
    first = connections[0]
    first.closed = True
    with store._connection() as transaction:
        transaction.execute("SELECT 1")
    assert len(connections) == 2
    assert connections[1].calls[0][0] == "TRANSACTION BEGIN"
    # Reconnection uses the existing schema without rerunning all migrations.
    assert not any("CREATE SCHEMA" in sql for sql, _ in connections[1].calls)


def test_ping_checks_live_storage_and_close_releases_connection(setup):
    store, connections = setup
    connections[0].rows["SELECT 1 AS alive"] = [{"alive": 1}]
    assert store.ping() is True
    store.close()
    assert connections[0].closed


def test_failed_initialization_closes_connection_without_retry():
    connections = []

    def connect(_dsn):
        connection = FakeConnection()
        connection.failure = "CREATE TABLE"
        connections.append(connection)
        return connection

    with pytest.raises(RuntimeError, match="simulated database error"):
        PostgresStore("postgresql://fake", connect_factory=connect)
    assert len(connections) == 1 and connections[0].closed
    assert connections[0].calls[-1][0] == "TRANSACTION ROLLBACK"


def test_empty_dsn_fails_without_connecting():
    with pytest.raises(ValueError, match="configuration is required"):
        PostgresStore("")
