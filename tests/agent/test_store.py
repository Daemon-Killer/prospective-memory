from concurrent.futures import ThreadPoolExecutor
import sqlite3
import threading

import pytest

from prospective_memory.agent.store import Store


def event(**changes):
    return {
        "source": "android_notification",
        "source_event_id": "notification-key-1",
        "package": "com.example.mail",
        "title": "Meeting tomorrow",
        "text": "Please bring the invoice.",
        "occurred_at": "2026-10-11T07:00:00Z",
        **changes,
    }


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "events.db"))


def test_deduplication_updates_and_source_scoping(store):
    first = store.ingest_event(event())
    assert first["status"] == "stored"
    assert first["event"]["category"] == "informational"
    assert first["event"]["sensitivity"] == "normal"
    assert first["event"]["group_summary"] is False

    # Equivalent offset timestamps must not manufacture an update.
    duplicate = store.ingest_event(event(occurred_at="2026-10-11T12:30:00+05:30"))
    assert duplicate == {"status": "duplicate", "event": first["event"]}

    updated = store.ingest_event(event(text="Bring the invoice and laptop.", category="action"))
    assert updated["status"] == "updated"
    assert updated["event"]["id"] == first["event"]["id"]
    assert updated["event"]["text"] == "Bring the invoice and laptop."
    assert store.ingest_event(event(text=updated["event"]["text"], category="action"))["status"] == "duplicate"

    other_source = store.ingest_event(event(source="manual_import"))
    assert other_source["status"] == "stored"
    assert other_source["event"]["id"] != first["event"]["id"]
    assert len(store.recent_events()) == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"sensitivity": "secret", "text": "private-content-sentinel"},
        {"title": "OTP", "text": "auth-content-sentinel 482901"},
        {"text": "Your one-time password is auth-content-sentinel"},
        {"text": "Verification code: auth-content-sentinel"},
        {"text": "Your UPI PIN is auth-content-sentinel"},
        {"text": "api_key=auth-content-sentinel"},
        {"text": "Bearer auth-content-sentinel"},
    ],
)
def test_sensitive_events_never_reach_the_database_or_response(tmp_path, changes):
    database = tmp_path / "events.db"
    store = Store(str(database))
    payload = event(**changes)
    response = store.ingest_event(payload)
    assert response["status"] == "quarantined"
    assert "event" not in response
    assert payload["text"] not in str(response)
    assert store.recent_events() == []
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM events").fetchone()[0] == 0
    # Check the database and any live journal files, not only query results.
    for file in tmp_path.iterdir():
        if file.is_file():
            content = file.read_bytes()
            assert b"auth-content-sentinel" not in content
            assert b"private-content-sentinel" not in content


def test_group_summary_is_ignored(store):
    result = store.ingest_event(event(group_summary=True))
    assert result["status"] == "ignored"
    assert "event" not in result
    assert store.recent_events() == []


@pytest.mark.parametrize("query", ["%", "_", "\\", "' OR 1=1 --"])
def test_search_is_literal_and_bound(store, query):
    store.ingest_event(event(source_event_id="matches", title=f"Contains {query} literally", text=""))
    store.ingest_event(event(source_event_id="does-not-match", title="Ordinary notification", text=""))
    results = store.search_events(query)
    assert [item["source_event_id"] for item in results] == ["matches"]


def test_search_reads_text_and_limits_results(store):
    store.ingest_event(event(source_event_id="a", title="First", text="Invoice available"))
    store.ingest_event(event(source_event_id="b", title="Second", text="Invoice attached"))
    assert len(store.search_events("invoice")) == 2
    assert len(store.search_events("invoice", limit=1)) == 1
    assert store.search_events("invoice", limit=0) == []


def test_recent_order_cutoff_and_pruning(store):
    store.ingest_event(event(source_event_id="older", occurred_at="2026-10-10T23:59:59Z"))
    store.ingest_event(event(source_event_id="boundary", occurred_at="2026-10-11T00:00:00Z"))
    store.ingest_event(event(source_event_id="newer", occurred_at="2026-10-11T06:00:00+05:30"))
    assert [row["source_event_id"] for row in store.recent_events()] == ["newer", "boundary", "older"]
    assert [row["source_event_id"] for row in store.recent_events("2026-10-11T00:00:00Z")] == ["newer", "boundary"]
    assert len(store.recent_events(limit=1)) == 1
    assert store.prune_events("2026-10-11T00:00:00Z") == 1
    assert [row["source_event_id"] for row in store.recent_events()] == ["newer", "boundary"]
    assert store.prune_events("2026-10-11T00:00:00Z") == 0


def test_snapshot_roundtrip_replacement_and_empty_snapshot(tmp_path):
    path = tmp_path / "events.db"
    store = Store(str(path))
    assert store.get_reminders() == ([], None)
    reminders = [{"id": "b", "title": "Call mum", "extra": {"tags": ["home"]}}, {"id": "a", "title": "Pay rent"}]
    store.replace_reminders(reminders, "2026-10-11T07:00:00Z")
    reopened = Store(str(path))
    assert reopened.get_reminders() == (reminders, "2026-10-11T07:00:00.000000Z")
    reopened.replace_reminders([{"id": "new"}], "2026-10-11T08:00:00Z")
    assert store.get_reminders()[0] == [{"id": "new"}]
    reopened.replace_reminders([], "2026-10-11T09:00:00Z")
    assert store.get_reminders() == ([], "2026-10-11T09:00:00.000000Z")


def test_failed_snapshot_write_rolls_back_rows_and_timestamp(tmp_path):
    path = tmp_path / "events.db"
    store = Store(str(path))
    store.replace_reminders([{"id": "original"}], "2026-10-11T07:00:00Z")
    before = store.get_reminders()
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TRIGGER fail_second_row BEFORE INSERT ON reminders
            WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'test interruption'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        store.replace_reminders([{"id": "first"}, {"id": "second"}], "2026-10-11T08:00:00Z")
    assert store.get_reminders() == before


def test_action_lifecycle_and_reconciliation_request_survive_reopen(tmp_path):
    path = tmp_path / "events.db"
    store = Store(str(path))
    assert store.get_action("missing") is None
    request = {"kind": "create", "reminder_id": "deterministic-id", "payload": {"title": "Call mum"}}
    assert store.begin_action("key", "fingerprint", request) == {
        "status": "new", "action_status": "pending", "fingerprint": "fingerprint", "request": request, "result": None,
    }
    reopened = Store(str(path))
    assert reopened.get_action("key") == {
        "status": "pending", "fingerprint": "fingerprint", "request": request, "result": None,
    }
    assert reopened.begin_action("key", "fingerprint")["action_status"] == "pending"
    result = {"ok": True, "reminder_id": "deterministic-id"}
    reopened.finish_action("key", result)
    replay = store.begin_action("key", "fingerprint", request)
    assert replay["status"] == "existing"
    assert replay["action_status"] == "done"
    assert replay["request"] == request
    assert replay["result"] == result
    store.finish_action("key", result)  # An identical acknowledgement is safe to replay.


def test_idempotency_mismatch_and_error_result(store):
    store.begin_action("key", "one")
    with pytest.raises(ValueError, match="different action"):
        store.begin_action("key", "two")
    assert store.get_action("key")["status"] == "pending"
    error = {"ok": False, "error": "Rejected by upstream"}
    store.finish_action("key", error)
    assert store.get_action("key")["result"] == error
    with pytest.raises(ValueError, match="cannot be changed"):
        store.finish_action("key", {"ok": True})
    with pytest.raises(KeyError):
        store.finish_action("unknown", {})


def test_action_claim_is_atomic_across_store_instances(tmp_path):
    path = str(tmp_path / "events.db")
    stores = [Store(path), Store(path)]
    barrier = threading.Barrier(8)

    def claim(index):
        barrier.wait(timeout=10)
        return stores[index % 2].begin_action("shared-key", "same-fingerprint")

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(claim, range(8)))
    assert sum(result["status"] == "new" for result in results) == 1
    assert sum(result["status"] == "existing" for result in results) == 7
    assert all(result["action_status"] == "pending" for result in results)


def test_finish_action_once_returns_first_result_across_racing_instances(tmp_path):
    path = str(tmp_path / "events.db")
    stores = [Store(path), Store(path)]
    stores[0].begin_action("shared-key", "same-fingerprint")
    barrier = threading.Barrier(2)
    proposed = [{"ok": True, "origin": "execution"}, {"ok": True, "origin": "reconciliation"}]

    def finish(index):
        barrier.wait(timeout=10)
        return stores[index].finish_action_once("shared-key", proposed[index])

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(finish, range(2)))
    committed = stores[0].get_action("shared-key")
    assert committed["status"] == "done"
    assert committed["result"] in proposed
    assert results == [committed["result"], committed["result"]]
    assert stores[1].finish_action_once("shared-key", {"ok": False}) == committed["result"]
    assert stores[0].get_action("shared-key") == committed
    with pytest.raises(KeyError):
        stores[0].finish_action_once("missing", {"ok": True})


def test_request_column_migration_preserves_existing_actions(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TABLE actions (
            key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT)""")
        connection.execute("INSERT INTO actions VALUES ('legacy', 'fingerprint', 'pending', NULL)")
    store = Store(str(path))
    assert store.get_action("legacy") == {
        "status": "pending", "fingerprint": "fingerprint", "request": None, "result": None,
    }
    assert store.begin_action("new", "new-fingerprint", {"kind": "complete"})["request"] == {"kind": "complete"}


def test_in_memory_database_retains_data_between_operations():
    store = Store(":memory:")
    store.ingest_event(event())
    assert len(store.recent_events()) == 1


@pytest.mark.parametrize("timestamp", ["2026-10-11T07:00:00", "not-a-timestamp"])
def test_naive_or_invalid_timestamps_do_not_write(store, timestamp):
    with pytest.raises(ValueError, match="timezone"):
        store.ingest_event(event(occurred_at=timestamp))
    assert store.recent_events() == []
