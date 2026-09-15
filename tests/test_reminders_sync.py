from __future__ import annotations

from pathlib import Path
from fastapi.testclient import TestClient

from prospective_memory.api import app
from prospective_memory.config import settings
from prospective_memory.db import (
    batch_sync_reminders,
    delete_reminder,
    list_reminders,
    upsert_reminder,
)
from prospective_memory.models import ReminderIn


def test_reminder_db_roundtrip(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "rem.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    rem1 = ReminderIn(
        id="rem-1",
        title="Buy groceries",
        notes="Milk, eggs",
        dueDate="2026-09-15T18:00:00.000Z",
        status="pending",
        snoozeCount=0,
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:00:00.000Z",
    )
    saved = upsert_reminder(rem1, db_path=db)
    assert saved.id == "rem-1"
    assert saved.title == "Buy groceries"
    assert saved.notes == "Milk, eggs"

    # List
    all_rem = list_reminders(db_path=db)
    assert len(all_rem) == 1
    assert all_rem[0].id == "rem-1"

    # Snooze (Update with newer updatedAt)
    rem1_snoozed = ReminderIn(
        id="rem-1",
        title="Buy groceries",
        dueDate="2026-09-15T19:00:00.000Z",
        status="snoozed",
        snoozeCount=1,
        lastSnoozedAt="2026-09-12T10:15:00.000Z",
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:15:00.000Z",
    )
    updated = upsert_reminder(rem1_snoozed, db_path=db)
    assert updated.status == "snoozed"
    assert updated.snoozeCount == 1

    # Conflict resolution: Older updatedAt should NOT overwrite newer updatedAt
    stale_rem1 = ReminderIn(
        id="rem-1",
        title="Stale Overwrite",
        dueDate="2026-09-15T18:00:00.000Z",
        status="pending",
        snoozeCount=0,
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:05:00.000Z", # older than 10:15:00
    )
    conflict_res = upsert_reminder(stale_rem1, db_path=db)
    assert conflict_res.title == "Buy groceries"
    assert conflict_res.status == "snoozed"

    # Delete
    assert delete_reminder("rem-1", db_path=db) is True
    assert len(list_reminders(db_path=db, include_deleted=False)) == 0
    assert len(list_reminders(db_path=db, include_deleted=True)) == 1


def test_batch_sync_reminders(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "sync.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    r1 = ReminderIn(
        id="r-1",
        title="Task 1",
        dueDate="2026-09-12T12:00:00.000Z",
        status="pending",
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:00:00.000Z",
    )
    r2 = ReminderIn(
        id="r-2",
        title="Task 2",
        dueDate="2026-09-12T13:00:00.000Z",
        status="completed",
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:00:00.000Z",
    )

    batch_out = batch_sync_reminders([r1, r2], db_path=db)
    assert len(batch_out.synced) == 2
    assert batch_out.serverSyncTime is not None


def test_api_reminders_endpoints(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "api_test.db"
    token = "test-secret-token"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "token", token)

    client = TestClient(app)

    # Unauthorized check
    res_unauth = client.get("/v1/reminders")
    assert res_unauth.status_code == 401

    headers = {"X-PMEM-TOKEN": token}

    # Initial empty list
    res = client.get("/v1/reminders", headers=headers)
    assert res.status_code == 200
    assert res.json() == []

    # Create / Sync
    sync_payload = {
        "reminders": [
            {
                "id": "c-1",
                "title": "Cloud Reminder",
                "dueDate": "2026-09-12T14:00:00.000Z",
                "status": "pending",
                "createdAt": "2026-09-12T10:00:00.000Z",
                "updatedAt": "2026-09-12T10:00:00.000Z",
            }
        ],
        "clientSyncTime": None,
    }
    sync_res = client.post("/v1/reminders/sync", json=sync_payload, headers=headers)
    assert sync_res.status_code == 200
    data = sync_res.json()
    assert len(data["synced"]) == 1
    assert data["synced"][0]["title"] == "Cloud Reminder"

    # Incremental GET includes tombstones after delete
    del_res = client.delete("/v1/reminders/c-1", headers=headers)
    assert del_res.status_code == 200

    listed = client.get("/v1/reminders", headers=headers)
    assert listed.status_code == 200
    assert listed.json() == []

    since_res = client.get(
        "/v1/reminders",
        params={"since": "2020-01-01T00:00:00.000Z"},
        headers=headers,
    )
    assert since_res.status_code == 200
    since_payload = since_res.json()
    assert len(since_payload) == 1
    assert since_payload[0]["id"] == "c-1"
    assert since_payload[0]["isDeleted"] is True


def test_batch_sync_last_write_wins_and_since_filter(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "lww.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    older = ReminderIn(
        id="same",
        title="Older title",
        dueDate="2026-09-12T12:00:00.000Z",
        status="pending",
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T10:00:00.000Z",
    )
    newer = ReminderIn(
        id="same",
        title="Newer title",
        dueDate="2026-09-12T13:00:00.000Z",
        status="snoozed",
        snoozeCount=1,
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T11:00:00.000Z",
    )
    batch_sync_reminders([newer], db_path=db)
    batch_out = batch_sync_reminders([older], client_sync_time="2026-09-12T10:00:00.000Z", db_path=db)
    assert len(batch_out.synced) == 1
    assert batch_out.synced[0].title == "Newer title"
    assert batch_out.synced[0].status == "snoozed"

    tombstone = ReminderIn(
        id="same",
        title="Newer title",
        dueDate="2026-09-12T13:00:00.000Z",
        status="snoozed",
        createdAt="2026-09-12T10:00:00.000Z",
        updatedAt="2026-09-12T12:00:00.000Z",
        isDeleted=True,
    )
    deleted = batch_sync_reminders([tombstone], client_sync_time="2026-09-12T11:00:00.000Z", db_path=db)
    assert deleted.synced[0].isDeleted is True
    assert list_reminders(db_path=db, include_deleted=False) == []


def test_unarmed_inbox_roundtrip(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "inbox.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    dumped = ReminderIn(
        id="inbox-1",
        title="call mom",
        dueDate="2026-09-13T10:00:00.000Z",
        status="pending",
        createdAt="2026-09-13T10:00:00.000Z",
        updatedAt="2026-09-13T10:00:00.000Z",
        armed=False,
    )
    saved = upsert_reminder(dumped, db_path=db)
    assert saved.armed is False

    listed = list_reminders(db_path=db)
    assert listed[0].armed is False

    defaulted = ReminderIn(
        id="timed-1",
        title="Buy groceries",
        dueDate="2026-09-13T18:00:00.000Z",
        status="pending",
        createdAt="2026-09-13T10:00:00.000Z",
        updatedAt="2026-09-13T10:00:00.000Z",
    )
    timed = upsert_reminder(defaulted, db_path=db)
    assert timed.armed is True


def test_converged_ledger_capture_and_sync(tmp_path: Path, monkeypatch) -> None:
    from prospective_memory.db import (
        capture,
        complete_reminder_db,
        list_tasks,
        set_status,
        snooze_reminder_db,
        stats,
    )
    from prospective_memory.models import TaskStatus

    db = tmp_path / "converged.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # 1. Capture via legacy thought logging -> creates Task AND Reminder in one ledger
    task = capture("dahi lena", db_path=db)
    assert task.text == "dahi lena"

    reminders = list_reminders(db_path=db)
    assert len(reminders) == 1
    assert reminders[0].id == task.id
    assert reminders[0].title == "dahi lena"
    assert reminders[0].armed is False  # Untimed thought dump -> unarmed inbox

    # 2. Mark done via task set_status -> mirrors to reminder
    set_status(task.id, TaskStatus.DONE, db_path=db)
    reminders = list_reminders(db_path=db)
    assert reminders[0].status == "completed"

    # 3. Create reminder via upsert_reminder -> mirrors to tasks
    rem2 = ReminderIn(
        id="rem-remy-1",
        title="Doctor appointment",
        dueDate="2026-09-14T09:00:00.000Z",
        status="pending",
        createdAt="2026-09-13T10:00:00.000Z",
        updatedAt="2026-09-13T10:00:00.000Z",
        armed=True,
    )
    upsert_reminder(rem2, db_path=db)
    tasks = list_tasks(status="open", db_path=db)
    matching_task = next((t for t in tasks if t.id == "rem-remy-1"), None)
    assert matching_task is not None
    assert matching_task.text == "Doctor appointment"

    # 4. Snooze reminder -> updates reminder & keeps task open
    snoozed = snooze_reminder_db("rem-remy-1", "2026-09-14T10:00:00.000Z", db_path=db)
    assert snoozed is not None
    assert snoozed.status == "snoozed"
    assert snoozed.snoozeCount == 1

    # 5. Complete reminder -> marks task DONE
    completed = complete_reminder_db("rem-remy-1", db_path=db)
    assert completed is not None
    assert completed.status == "completed"
    tasks_open = list_tasks(status="open", db_path=db)
    assert not any(t.id == "rem-remy-1" for t in tasks_open)

    # 6. Check stats has reminders breakdown
    st = stats(db_path=db)
    assert "reminders" in st
    assert st["reminders"]["total"] == 2


def test_api_reminder_snooze_and_complete(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "api_snooze.db"
    token = "secret-token"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "token", token)

    client = TestClient(app)
    headers = {"X-PMEM-TOKEN": token}

    # Create a reminder
    payload = {
        "id": "rem-api-1",
        "title": "Pay utility bill",
        "dueDate": "2026-09-14T12:00:00.000Z",
        "status": "pending",
        "createdAt": "2026-09-13T10:00:00.000Z",
        "updatedAt": "2026-09-13T10:00:00.000Z",
        "armed": True,
    }
    create_res = client.post("/v1/reminders", json=payload, headers=headers)
    assert create_res.status_code == 200

    # Snooze
    snooze_res = client.post(
        "/v1/reminders/rem-api-1/snooze",
        json={"dueDate": "2026-09-14T13:00:00.000Z"},
        headers=headers,
    )
    assert snooze_res.status_code == 200
    snooze_data = snooze_res.json()
    assert snooze_data["status"] == "snoozed"
    assert snooze_data["dueDate"] == "2026-09-14T13:00:00.000Z"
    assert snooze_data["snoozeCount"] == 1

    # Complete
    comp_res = client.post("/v1/reminders/rem-api-1/complete", headers=headers)
    assert comp_res.status_code == 200
    assert comp_res.json()["status"] == "completed"


def test_fastmcp_reminder_tools(tmp_path: Path, monkeypatch) -> None:
    from prospective_memory.mcp_server import (
        complete_reminder,
        create_reminder,
        list_reminders as mcp_list_reminders,
        snooze_reminder,
    )

    db = tmp_path / "mcp_test.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "api_url", None)  # Ensure local mode

    # 1. Create reminder via FastMCP
    created = create_reminder(title="Submit expense report", armed=False)
    assert created["title"] == "Submit expense report"
    assert created["armed"] is False
    rem_id = created["id"]

    # 2. List reminders via FastMCP
    listing = mcp_list_reminders()
    assert listing["total"] >= 1
    found = next((r for r in listing["reminders"] if r["id"] == rem_id), None)
    assert found is not None

    # 3. Snooze reminder via FastMCP
    snoozed = snooze_reminder(rem_id, minutes=30)
    assert snoozed["status"] == "snoozed"
    assert snoozed["snoozeCount"] == 1
    assert snoozed["armed"] is True

    # 4. Complete reminder via FastMCP
    completed = complete_reminder(rem_id)
    assert completed["status"] == "completed"


def test_time_cue_capture_and_trigger_detail_sync(tmp_path: Path, monkeypatch) -> None:
    from datetime import datetime, timezone
    from prospective_memory.db import capture, list_tasks, snooze_reminder_db
    from prospective_memory.models import TriggerType

    db = tmp_path / "cue_sync.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    # 1. Capture with temporal cue & category: "call doctor tomorrow morning"
    now_utc = datetime.now(timezone.utc)
    task = capture("call doctor tomorrow morning", db_path=db)
    assert task.category == "people"
    assert task.trigger_type == TriggerType.TIME
    assert "tomorrow morning" in task.trigger_detail

    rems = list_reminders(db_path=db)
    assert len(rems) == 1
    rem = rems[0]
    assert rem.armed is True
    # Due date should be tomorrow morning (in the future)
    due_dt = datetime.fromisoformat(rem.dueDate)
    assert due_dt > now_utc

    # 2. Snooze reminder updates mirrored task's trigger_type and trigger_detail
    target_snooze = "2026-10-01T15:00:00.000Z"
    snoozed = snooze_reminder_db(rem.id, target_snooze, db_path=db)
    assert snoozed is not None
    assert snoozed.status == "snoozed"

    tasks = list_tasks(status="open", db_path=db)
    matched_task = next(t for t in tasks if t.id == rem.id)
    assert matched_task.trigger_type == TriggerType.TIME
    assert matched_task.trigger_detail == target_snooze


def test_fastmcp_time_inference(tmp_path: Path, monkeypatch) -> None:
    from datetime import datetime, timezone
    from prospective_memory.mcp_server import create_reminder

    db = tmp_path / "mcp_cue.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "api_url", None)

    # Calling create_reminder without explicit due_date but with armed=True and time cue
    created = create_reminder(title="Submit PR tomorrow morning", armed=True)
    assert created["armed"] is True
    due_dt = datetime.fromisoformat(created["dueDate"])
    assert due_dt > datetime.now(timezone.utc)


def test_ink_data_sync_roundtrip(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "ink_test.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    client = TestClient(app)

    # 1. Upsert reminder with inkData
    sample_ink = '{"strokes":[[{"x":10,"y":20,"t":100},{"x":15,"y":25,"t":120}]]}'
    rem_ink = ReminderIn(
        id="ink-rem-1",
        title="Circuit Diagram Sketch",
        notes="Bridge rectifier layout",
        dueDate="2026-09-15T22:00:00.000Z",
        status="pending",
        createdAt="2026-09-15T20:00:00.000Z",
        updatedAt="2026-09-15T20:00:00.000Z",
        inkData=sample_ink,
    )
    saved = upsert_reminder(rem_ink, db_path=db)
    assert saved.id == "ink-rem-1"
    assert saved.inkData == sample_ink

    # 2. Verify list_reminders retains inkData
    listed = list_reminders(db_path=db)
    found = next(r for r in listed if r.id == "ink-rem-1")
    assert found.inkData == sample_ink

    # 3. Verify batch sync endpoint preserves inkData
    sync_resp = client.post(
        "/v1/reminders/sync",
        headers={"X-PMEM-TOKEN": settings.resolved_token()},
        json={
            "reminders": [
                {
                    "id": "ink-rem-2",
                    "title": "Stylus Signature",
                    "dueDate": "2026-09-15T23:00:00.000Z",
                    "createdAt": "2026-09-15T20:30:00.000Z",
                    "updatedAt": "2026-09-15T20:30:00.000Z",
                    "inkData": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
                }
            ]
        },
    )
    assert sync_resp.status_code == 200
    synced_items = sync_resp.json()["synced"]
    synced_ink = next(r for r in synced_items if r["id"] == "ink-rem-2")
    assert synced_ink["inkData"] == "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="


def test_permanent_database_config_resolution(tmp_path: Path, monkeypatch) -> None:
    # 1. Test postgres:// normalization to postgresql://
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@ep-cool-pooler.supabase.co:5432/postgres")
    assert settings.resolved_database_url() == "postgresql://user:pass@ep-cool-pooler.supabase.co:5432/postgres"

    # 2. Test SUPABASE_DB_URL detection
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://supabase_admin:secret@db.project.supabase.co:5432/postgres")
    assert settings.resolved_database_url() == "postgresql://supabase_admin:secret@db.project.supabase.co:5432/postgres"

    # 3. Test persistent volume directory selection when hosted
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)
    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setenv("RENDER", "true")
    persistent_dir = tmp_path / "persistent_pmem"
    monkeypatch.setenv("PERSISTENT_DATA_DIR", str(persistent_dir))

    settings.ensure()
    assert settings.data_dir == persistent_dir
    assert settings.db_path == persistent_dir / "tasks.db"
    assert persistent_dir.exists()

    # 4. Test persistent volume directory selection when unhosted
    monkeypatch.delenv("RENDER", raising=False)
    unhosted_dir = tmp_path / "unhosted_pmem"
    monkeypatch.setenv("PERSISTENT_DATA_DIR", str(unhosted_dir))
    settings.ensure()
    assert settings.data_dir == unhosted_dir
    assert settings.db_path == unhosted_dir / "tasks.db"
    assert unhosted_dir.exists()



