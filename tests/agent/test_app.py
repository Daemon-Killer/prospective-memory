from copy import deepcopy
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from prospective_memory.agent.app import create_app
from prospective_memory.agent.config import Settings
from prospective_memory.agent.remy_client import RemyError
from prospective_memory.agent.store import Store


TOKEN = "test-agent-token-with-32-characters-or-more"
AUTH = {"X-AGENT-TOKEN": TOKEN}
NOW = datetime(2026, 10, 11, 10, tzinfo=timezone.utc)


class FakeRemy:
    def __init__(self):
        self.reminders = []
        self.writes = 0
        self.offline = False
        self.ambiguous = False

    async def close(self):
        pass

    async def list_reminders(self):
        if self.offline:
            raise RemyError("timeout", retryable=True)
        return deepcopy(self.reminders)

    async def create_reminder(self, payload):
        self.writes += 1
        self.reminders.append(deepcopy(payload))
        if self.ambiguous:
            raise RemyError("timeout", ambiguous=True)
        return deepcopy(payload)

    async def complete_reminder(self, rid):
        self.writes += 1
        result = next(r for r in self.reminders if r["id"] == rid)
        result["status"] = "completed"
        return deepcopy(result)

    async def snooze_reminder(self, rid, due_date):
        self.writes += 1
        result = next(r for r in self.reminders if r["id"] == rid)
        result.update(status="snoozed", dueDate=due_date)
        return deepcopy(result)


@pytest.fixture
def setup(tmp_path):
    fake = FakeRemy()
    current = [NOW]
    store = Store(str(tmp_path / "agent.sqlite3"))
    app = create_app(Settings(TOKEN), store=store, remy_client=fake, clock=lambda: current[0])
    with TestClient(app) as client:
        yield client, fake, current, store


def event(**updates):
    return {"source": "android_notifications", "source_event_id": "stable-key-1",
            "package": "org.example.calendar", "title": "Meeting", "text": "Confirm tomorrow's appointment",
            "occurred_at": "2026-10-11T09:00:00Z", **updates}


def action_headers(key):
    return {**AUTH, "Idempotency-Key": key}


@pytest.mark.parametrize("method,path", [
    ("get", "/v1/brief"), ("get", "/v1/reminders"), ("get", "/v1/memories"),
    ("get", "/v1/suggestions"), ("get", "/v1/actions/example-key"),
    ("post", "/v1/events"), ("post", "/v1/sync"),
    ("post", "/v1/reminders"), ("post", "/v1/reminders/x/complete"),
    ("post", "/v1/reminders/x/snooze"), ("post", "/v1/actions/example-key/reconcile"),
])
def test_all_data_routes_require_auth(setup, method, path):
    client, *_ = setup
    assert getattr(client, method)(path).status_code == 401


def test_health_minimal_and_docs_disabled(setup):
    client, *_ = setup
    assert client.get("/health").json() == {"ok": True, "version": "0.1.0"}
    assert client.get("/openapi.json").status_code == 404


def test_ingest_search_review_no_reminder_write(setup):
    client, fake, _, _ = setup
    batch = {"events": [event(), event(source_event_id="otp", text="OTP 123456"),
                        event(source_event_id="group", group_summary=True)]}
    results = client.post("/v1/events", json=batch, headers=AUTH).json()["results"]
    assert [r["status"] for r in results] == ["stored", "quarantined", "ignored"]
    assert "123456" not in str(results)
    replay = client.post("/v1/events", json={"events": [event()]}, headers=AUTH)
    assert replay.json()["results"][0]["status"] == "duplicate"
    found = client.get("/v1/memories?q=appointment", headers=AUTH).json()
    assert len(found["events"]) == 1
    draft = client.get("/v1/suggestions", headers=AUTH).json()["suggestions"][0]
    assert draft["due_date"] is None and draft["requires_review"] is True
    assert fake.writes == 0


def test_event_requires_aware_timestamp(setup):
    client, *_ = setup
    response = client.post("/v1/events", json={"events": [event(occurred_at="2026-10-11T09:00:00")]}, headers=AUTH)
    assert response.status_code == 422


def test_retention_future_and_package_allowlist(tmp_path):
    settings = Settings(TOKEN, database=str(tmp_path / "a.db"), allowed_packages=("allowed",))
    with TestClient(create_app(settings, clock=lambda: NOW)) as client:
        batch = {"events": [event(package="other"), event(package="allowed", source_event_id="old", occurred_at="2026-08-01T00:00:00Z"),
                            event(package="allowed", source_event_id="future", occurred_at="2026-10-12T00:00:00Z")]}
        results = client.post("/v1/events", json=batch, headers=AUTH).json()["results"]
        assert [r["reason"] for r in results] == ["package_not_allowed", "outside_retention", "future_event_clock"]


def test_create_is_durable_idempotent_and_detects_changed_body(setup, tmp_path):
    client, fake, current, store = setup
    body = {"title": "Renew library card", "due_date": "2026-10-12T09:00:00+05:30"}
    headers = action_headers("create-card-1")
    first = client.post("/v1/reminders", json=body, headers=headers)
    assert first.status_code == 200
    assert first.json()["reminder"]["dueDate"] == "2026-10-12T03:30:00Z"
    current[0] += timedelta(minutes=5)
    again = client.post("/v1/reminders", json=body, headers=headers)
    assert first.json() == again.json() and fake.writes == 1
    other = client.post("/v1/reminders", json={**body, "title": "Different"}, headers=headers)
    assert other.status_code == 409
    # Action state and timestamp survive constructing a fresh store/app.
    with TestClient(create_app(Settings(TOKEN), store=store, remy_client=fake, clock=lambda: current[0])) as restarted:
        response = restarted.post("/v1/reminders", json=body, headers=headers)
        assert response.json() == first.json() and fake.writes == 1


def test_inbox_does_not_invent_alarm_or_become_overdue(setup):
    client, fake, current, _ = setup
    body = {"title": "Look up that article", "armed": False}
    response = client.post("/v1/reminders", json=body, headers=action_headers("inbox-item-1"))
    assert response.json()["reminder"]["armed"] is False
    current[0] += timedelta(days=1)
    brief = client.get("/v1/brief", headers=AUTH).json()
    assert len(brief["inbox"]) == 1 and brief["overdue"] == []


def test_scheduled_reminder_requires_explicit_time(setup):
    client, fake, *_ = setup
    assert client.post("/v1/reminders", json={"title": "Something"}, headers=action_headers("missing-date")).status_code == 422
    assert fake.writes == 0


def test_ambiguous_write_is_not_retried_and_can_reconcile(setup):
    client, fake, _, store = setup
    fake.ambiguous = True
    body = {"title": "Collect parcel", "armed": False}
    headers = action_headers("uncertain-create")
    first = client.post("/v1/reminders", json=body, headers=headers)
    assert first.status_code == 502 and first.json()["detail"]["pending"] is True
    assert store.get_action("uncertain-create")["status"] == "pending"
    assert client.post("/v1/reminders", json=body, headers=headers).status_code == 409
    assert fake.writes == 1
    resolved = client.post("/v1/actions/uncertain-create/reconcile", headers=AUTH)
    assert resolved.status_code == 200 and resolved.json()["reconciled"] is True
    assert client.post("/v1/reminders", json=body, headers=headers).status_code == 200
    assert fake.writes == 1


def test_unresolved_reconciliation_never_claims_success(setup):
    client, fake, _, _ = setup
    fake.ambiguous = True
    client.post("/v1/reminders", json={"title": "Draft", "armed": False}, headers=action_headers("unresolved-key"))
    fake.reminders.clear()
    assert client.post("/v1/actions/unresolved-key/reconcile", headers=AUTH).status_code == 409


def test_completion_updates_cache_and_offline_brief_is_stale(setup):
    client, fake, _, _ = setup
    created = client.post("/v1/reminders", json={"title": "Overdue", "due_date": "2026-10-10T10:00:00Z"}, headers=action_headers("create-overdue")).json()["reminder"]
    assert len(client.get("/v1/brief", headers=AUTH).json()["overdue"]) == 1
    response = client.post(f"/v1/reminders/{created['id']}/complete", headers=action_headers("complete-overdue"))
    assert response.json()["reminder"]["status"] == "completed"
    fake.offline = True
    brief = client.get("/v1/brief", headers=AUTH).json()
    assert brief["overdue"] == []
    assert brief["reminder_source"]["state"] == "cached"
    assert brief["reminder_source"]["stale"] is True
    assert client.post("/v1/sync", headers=AUTH).status_code == 502


def test_snooze_replay_after_due_time_returns_original_result(setup):
    client, fake, current, _ = setup
    created = client.post("/v1/reminders", json={"title": "Thing", "armed": False}, headers=action_headers("create-thing")).json()["reminder"]
    path = f"/v1/reminders/{created['id']}/snooze"
    body = {"due_date": "2026-10-11T11:00:00Z"}
    first = client.post(path, json=body, headers=action_headers("snooze-thing"))
    assert first.status_code == 200
    current[0] += timedelta(days=1)
    replay = client.post(path, json=body, headers=action_headers("snooze-thing"))
    assert replay.json() == first.json() and fake.writes == 2


def test_unconfigured_service_never_claims_connected(tmp_path):
    with TestClient(create_app(Settings(TOKEN, database=str(tmp_path / "a.db")), clock=lambda: NOW)) as client:
        assert client.get("/v1/brief", headers=AUTH).json()["reminder_source"]["state"] == "unconfigured"
        assert client.post("/v1/reminders", json={"title": "Thing", "armed": False}, headers=action_headers("not-connected")).status_code == 503


def test_config_requires_secret_and_paired_remy_credentials():
    with pytest.raises(ValueError, match="AGENT_TOKEN"):
        Settings("")
    with pytest.raises(ValueError, match="both"):
        Settings(TOKEN, remy_url="http://localhost:8790")


def test_non_ascii_auth_fails_closed(setup):
    client, *_ = setup
    assert client.get("/v1/brief", headers={b"X-AGENT-TOKEN": b"\xe9"}).status_code == 401
    with pytest.raises(ValueError, match="ASCII"):
        Settings("é" * 32)


def test_action_keys_can_always_be_used_in_reconciliation_routes(setup):
    client, fake, *_ = setup
    response = client.post("/v1/reminders", json={"title": "Thing", "armed": False},
                           headers=action_headers("invalid/key-1"))
    assert response.status_code == 422 and fake.writes == 0


@pytest.mark.parametrize("path,payload", [
    ("/v1/events", {"events": [event(occurred_at="0001-01-01T00:00:00+05:30")]}),
    ("/v1/reminders", {"title": "Impossible", "due_date": "0001-01-01T00:00:00+05:30"}),
    ("/v1/reminders/a/snooze", {"due_date": "0001-01-01T00:00:00+05:30"}),
])
def test_date_overflow_is_validation_error(setup, path, payload):
    client, fake, *_ = setup
    assert client.post(path, json=payload, headers=action_headers("invalid-timestamp")).status_code == 422
    assert fake.writes == 0


def test_original_write_and_reconcile_share_committed_result(tmp_path):
    import asyncio
    import httpx

    async def scenario():
        committed, release = asyncio.Event(), asyncio.Event()

        class SlowRemy(FakeRemy):
            async def create_reminder(self, payload):
                result = await super().create_reminder(payload)
                committed.set()
                await release.wait()
                return result

        fake = SlowRemy()
        app = create_app(Settings(TOKEN, database=str(tmp_path / "race.db")),
                         remy_client=fake, clock=lambda: NOW)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local") as client:
            original = asyncio.create_task(client.post("/v1/reminders", json={"title": "Race", "armed": False},
                                                       headers=action_headers("racing-action")))
            await committed.wait()
            reconciled = await client.post("/v1/actions/racing-action/reconcile", headers=AUTH)
            release.set()
            result = await original
            assert result.status_code == reconciled.status_code == 200
            assert result.json()["reminder"] == reconciled.json()["reminder"]
            assert fake.writes == 1

    asyncio.run(scenario())
