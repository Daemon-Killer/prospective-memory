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
