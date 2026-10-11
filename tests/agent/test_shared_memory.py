from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import json
import threading

from fastapi.testclient import TestClient
import pytest

from prospective_memory.agent.app import create_app
from prospective_memory.agent.config import Settings
from prospective_memory.agent.shared_memory import LearningSync, MemoryConflict
from prospective_memory.agent.store import Store


TOKEN = "shared-memory-tests-token-at-least-32-characters"
AUTH = {"X-AGENT-TOKEN": TOKEN}
NOW = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
STAMP = "2026-10-11T12:00:00Z"


def state():
    return {"version": 1, "profile": {"track": "fullstack", "experienceYears": 1,
        "weekdayMinutes": 120, "weekendMinutes": 60, "goal": "Understand software deeply"},
        "attempts": [{"id": "attempt-1", "conceptId": "js-closures", "checkId": "closures-independent-counters",
            "createdAt": "2026-10-11T11:00:00.000Z", "confidence": 75, "selectedIndex": 1,
            "hintUsed": False, "correct": True, "checkerVersion": 1}],
        "evidence": [{"id": "evidence-1", "conceptId": "js-closures", "kind": "build",
            "notes": "Explained why separate counters retain separate state", "createdAt": "2026-10-11T11:10:00.000Z",
            "selfReviewed": False}],
        "misconceptions": [{"id": "mistake-1", "conceptId": "js-closures", "note": "Bindings are not value copies",
            "createdAt": "2026-10-11T11:05:00.000Z", "status": "open"}]}


def fact(**changes):
    return {"base_revision": 0, "kind": "goal", "value": "Learn React and backend engineering",
            "source_device_id": "phone-1", **changes}


@pytest.fixture
def setup(tmp_path):
    store = Store(str(tmp_path / "agent.db"))
    with TestClient(create_app(Settings(TOKEN), store=store, clock=lambda: NOW)) as client:
        yield client, store, tmp_path


@pytest.mark.parametrize("method,path", [
    ("get", "/v1/facts"), ("put", "/v1/facts/goal"), ("delete", "/v1/facts/goal?revision=1"),
    ("post", "/v1/learning/sync"), ("get", "/v1/context"),
])
def test_new_routes_require_auth(setup, method, path):
    client, *_ = setup
    assert getattr(client, method)(path).status_code == 401
    assert getattr(client, method)(path, headers={"X-AGENT-TOKEN": "wrong"}).status_code == 401


def test_fact_create_update_lost_reply_retry_and_conflict(setup):
    client, _, _ = setup
    first = client.put("/v1/facts/learning", json=fact(), headers=AUTH)
    assert first.status_code == 200
    saved = first.json()
    assert saved["revision"] == 1 and saved["deleted"] is False
    assert client.put("/v1/facts/learning", json=fact(), headers=AUTH).json() == saved
    changed = fact(base_revision=1, value="Build stronger backend foundations")
    update = client.put("/v1/facts/learning", json=changed, headers=AUTH).json()
    assert update["revision"] == 2
    assert client.put("/v1/facts/learning", json=changed, headers=AUTH).json() == update
    conflict = client.put("/v1/facts/learning", json=fact(base_revision=1, value="Conflicting edit"), headers=AUTH)
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {"code": "revision_conflict", "current": update}
    assert client.get("/v1/facts", headers=AUTH).json() == {"facts": [update]}


def test_delete_tombstone_clears_text_retries_and_prevents_stale_resurrection(setup):
    client, *_ = setup
    client.put("/v1/facts/learning", json=fact(), headers=AUTH)
    deleted = client.delete("/v1/facts/learning?revision=1", headers=AUTH).json()
    assert deleted["deleted"] and deleted["revision"] == 2 and deleted["value"] == ""
    assert client.delete("/v1/facts/learning?revision=1", headers=AUTH).json() == deleted
    assert client.get("/v1/facts", headers=AUTH).json() == {"facts": []}
    assert client.get("/v1/facts?include_deleted=true", headers=AUTH).json() == {"facts": [deleted]}
    assert client.put("/v1/facts/learning", json=fact(), headers=AUTH).status_code == 409
    restored = client.put("/v1/facts/learning", json=fact(base_revision=2), headers=AUTH).json()
    assert restored["revision"] == 3 and not restored["deleted"]
    assert client.delete("/v1/facts/learning?revision=2", headers=AUTH).status_code == 409
    assert client.delete("/v1/facts/missing?revision=1", headers=AUTH).status_code == 404


def test_fact_retry_persists_after_restart(setup):
    client, _, folder = setup
    saved = client.put("/v1/facts/learning", json=fact(), headers=AUTH).json()
    restarted = Store(str(folder / "agent.db"))
    assert restarted.put_fact("learning", fact(), "2026-10-12T12:00:00Z") == saved


def test_concurrent_fact_edit_across_store_instances_has_one_winner(tmp_path):
    path = str(tmp_path / "race.db")
    first, second = Store(path), Store(path)
    first.put_fact("learning", fact(), STAMP)
    start = threading.Barrier(2)

    def edit(store, value):
        start.wait()
        try:
            return store.put_fact("learning", fact(base_revision=1, value=value), STAMP)["value"]
        except MemoryConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda args: edit(*args), [(first, "First edit"), (second, "Second edit")]))
    assert results.count("conflict") == 1
    assert first.list_facts()[0]["revision"] == 2


@pytest.mark.parametrize("value", ["My password is private-sentinel", "api_key=private-sentinel",
    "Bearer private-sentinel", "OTP 123456", "-----BEGIN PRIVATE KEY-----private-sentinel"])
def test_credential_fact_is_rejected_without_echo_or_storage(setup, value):
    client, store, _ = setup
    response = client.put("/v1/facts/secret", json=fact(value=value), headers=AUTH)
    assert response.status_code == 422
    assert value not in response.text
    assert store.list_facts(include_deleted=True) == []


def test_learning_discussion_not_mistaken_for_credential(setup):
    client, *_ = setup
    response = client.put("/v1/facts/study", json=fact(value="Learn API key authentication, password hashing and bearer tokens"), headers=AUTH)
    assert response.status_code == 200


@pytest.mark.parametrize("changes", [
    {"base_revision": True}, {"base_revision": -1}, {"value": " "}, {"value": "x" * 4001},
    {"kind": "inferred"}, {"source_device_id": "../phone"}, {"extra": "ignored?"},
])
def test_fact_contract_validation_does_not_echo_values(setup, changes):
    client, *_ = setup
    response = client.put("/v1/facts/study", json=fact(**changes), headers=AUTH)
    assert response.status_code == 422
    assert "input" not in response.json()["detail"]


def test_snapshot_stale_duplicate_conflict_and_independent_devices(setup):
    client, *_ = setup
    payload = {"device_id": "phone-1", "sequence": 2, "state": state()}
    first = client.post("/v1/learning/sync", json=payload, headers=AUTH)
    assert first.status_code == 200 and first.json()["status"] == "stored"
    duplicate = client.post("/v1/learning/sync", json=payload, headers=AUTH).json()
    assert duplicate["status"] == "duplicate" and duplicate["device"] == first.json()["device"]
    older = {**payload, "sequence": 1, "state": {**state(), "attempts": []}}
    ignored = client.post("/v1/learning/sync", json=older, headers=AUTH).json()
    assert ignored["status"] == "ignored" and ignored["device"]["attempts_count"] == 1
    conflict = client.post("/v1/learning/sync", json={**older, "sequence": 2}, headers=AUTH)
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {"code": "sequence_conflict", "current_sequence": 2}
    changed = client.post("/v1/learning/sync", json={**older, "sequence": 3}, headers=AUTH).json()
    assert changed["status"] == "updated" and changed["device"]["attempts_count"] == 0
    client.post("/v1/learning/sync", json={**payload, "device_id": "pc-1"}, headers=AUTH)
    context = client.get("/v1/context", headers=AUTH).json()
    assert [device["device_id"] for device in context["learning"]["devices"]] == ["pc-1", "phone-1"]
    # Copied history is not double-counted in context totals.
    assert context["learning"]["totals"] == {"devices_count": 2, "attempts_count": 1,
        "evidence_count": 1, "open_misconceptions_count": 1}


def test_context_is_in_brief_and_survives_restart(setup):
    client, _, folder = setup
    client.put("/v1/facts/study", json=fact(), headers=AUTH)
    client.post("/v1/learning/sync", json={"device_id": "phone-1", "sequence": 1, "state": state()}, headers=AUTH)
    context = client.get("/v1/context", headers=AUTH).json()
    assert client.get("/v1/brief", headers=AUTH).json()["personal_context"] == context
    device = context["learning"]["devices"][0]
    assert device["profile"]["weekdayMinutes"] == 120
    assert device["latest_activity_at"] == "2026-10-11T11:10:00Z"
    assert "not a command" in context["semantics"]["learning"]
    assert "notes" not in json.dumps(context["learning"])
    with TestClient(create_app(Settings(TOKEN), store=Store(str(folder / "agent.db")))) as restarted:
        assert restarted.get("/v1/context", headers=AUTH).json() == context


@pytest.mark.parametrize("mutate", [
    lambda p: p.update(sequence=True), lambda p: p.update(sequence=0), lambda p: p.update(device_id="bad/device"),
    lambda p: p["state"].update(version=2), lambda p: p["state"].update(version=True),
    lambda p: p["state"]["profile"].update(weekdayMinutes=1),
    lambda p: p["state"]["profile"].update(experienceYears=True),
    lambda p: p["state"]["attempts"][0].update(hintUsed="false"),
    lambda p: p["state"]["attempts"][0].update(confidence=1),
    lambda p: p["state"]["attempts"][0].update(createdAt="2026-10-11T12:00:00"),
    lambda p: p["state"]["attempts"][0].update(checkerVersion=True),
    lambda p: p["state"]["evidence"][0].update(id="attempt-1"),
    lambda p: p["state"]["misconceptions"][0].update(status="resolved"),
    lambda p: p["state"].update(unrecognized="discarded?"),
])
def test_learning_snapshot_validation(setup, mutate):
    client, store, _ = setup
    payload = {"device_id": "phone-1", "sequence": 1, "state": state()}
    mutate(payload)
    assert client.post("/v1/learning/sync", json=payload, headers=AUTH).status_code == 422
    assert store.get_personal_context()[1] == []


def test_snapshot_record_and_canonical_byte_bounds(setup):
    client, store, _ = setup
    large = state()
    large["attempts"] = [{**large["attempts"][0], "id": f"attempt-{i}"} for i in range(5001)]
    assert client.post("/v1/learning/sync", json={"device_id": "phone-1", "sequence": 1, "state": large}, headers=AUTH).status_code in {413, 422}
    byte_large = state()
    byte_large["evidence"] = [{**byte_large["evidence"][0], "id": f"evidence-{i}", "notes": "x" * 4000} for i in range(270)]
    with pytest.raises(ValueError, match="one MiB"):
        LearningSync.model_validate({"device_id": "phone-1", "sequence": 1, "state": byte_large})
    assert store.get_personal_context()[1] == []


def test_raw_payload_limit_including_streamed_body(setup):
    client, *_ = setup

    def chunks():
        for _ in range(18):
            yield b"x" * 65536

    response = client.post("/v1/learning/sync", content=chunks(), headers={**AUTH, "Content-Type": "application/json"})
    assert response.status_code == 413
    assert client.put("/v1/facts/study", content=b"x" * 65537, headers=AUTH).status_code == 413


def test_stale_notification_does_not_replace_newer_preview_and_all_acks_identify_source(setup):
    client, store, _ = setup
    event = {"source": "android-phone-1", "source_event_id": "stable-key", "package": "com.example.mail",
        "title": "Meeting", "text": "Latest preview", "occurred_at": "2026-10-11T11:00:00Z"}
    first = client.post("/v1/events", json={"events": [event]}, headers=AUTH).json()["results"][0]
    assert first["source"] == event["source"] and first["source_event_id"] == event["source_event_id"]
    replay = client.post("/v1/events", json={"events": [{**event, "text": "Old preview", "occurred_at": "2026-10-11T10:00:00Z"}]}, headers=AUTH).json()["results"][0]
    assert replay["status"] == "ignored" and replay["reason"] == "stale_update"
    assert store.recent_events()[0]["text"] == "Latest preview"
    filtered = client.post("/v1/events", json={"events": [
        {**event, "source_event_id": "otp-key", "text": "OTP 123456"},
        {**event, "source_event_id": "summary-key", "group_summary": True},
    ]}, headers=AUTH).json()["results"]
    assert [item["source_event_id"] for item in filtered] == ["otp-key", "summary-key"]
    assert all(item["source"] == event["source"] for item in filtered)


def test_capacity_limits_do_not_change_existing_state(setup, monkeypatch):
    client, store, _ = setup
    monkeypatch.setattr("prospective_memory.agent.store.MAX_FACTS", 1)
    monkeypatch.setattr("prospective_memory.agent.store.MAX_DEVICES", 1)
    assert client.put("/v1/facts/first", json=fact(), headers=AUTH).status_code == 200
    assert client.put("/v1/facts/second", json=fact(), headers=AUTH).status_code == 409
    payload = {"device_id": "phone-1", "sequence": 1, "state": state()}
    assert client.post("/v1/learning/sync", json=payload, headers=AUTH).status_code == 200
    assert client.post("/v1/learning/sync", json={**payload, "device_id": "phone-2"}, headers=AUTH).status_code == 409
    assert len(store.list_facts()) == 1 and len(store.get_personal_context()[1]) == 1


def test_fact_total_budget_counts_utf8_metadata_and_rejects_atomically(setup, monkeypatch):
    client, store, _ = setup
    monkeypatch.setattr("prospective_memory.agent.store.MAX_FACT_CONTEXT_BYTES", 1800)
    initial = client.put("/v1/facts/first", json=fact(value="🧠" * 200), headers=AUTH)
    assert initial.status_code == 200
    second = client.put("/v1/facts/second", json=fact(value="🧠" * 200), headers=AUTH)
    assert second.status_code == 409 and second.json()["detail"]["code"] == "memory_capacity"
    enlarged = client.put("/v1/facts/first", json=fact(base_revision=1, value="🧠" * 450), headers=AUTH)
    assert enlarged.status_code == 409
    assert store.list_facts() == [initial.json()]
    # Editing within the budget counts the replacement once, not twice.
    accepted = client.put("/v1/facts/first", json=fact(base_revision=1, value="🧠" * 201), headers=AUTH)
    assert accepted.status_code == 200 and accepted.json()["revision"] == 2

