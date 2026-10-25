from copy import deepcopy
from datetime import UTC, datetime

import pytest

from prospective_memory.agent.brief import build_brief


def reminder(identifier, due_date, **overrides):
    return {
        "id": identifier,
        "title": f"Reminder {identifier}",
        "dueDate": due_date,
        "status": "pending",
        **overrides,
    }


def ids(brief, bucket):
    return [item["id"] for item in brief[bucket]]


def test_india_day_boundary_uses_local_date_and_disjoint_sorted_buckets():
    now = datetime(2026, 10, 10, 19, 0, tzinfo=UTC)  # Oct 11, 00:30 in India
    reminders = [
        reminder("tomorrow", "2026-10-11T18:30:00Z"),
        reminder("today-later", "2026-10-11T15:00:00Z"),
        reminder("overdue", "2026-10-10T18:29:59Z"),
        reminder("now", "2026-10-10T19:00:00+00:00"),
        reminder("today-earlier", "2026-10-10T20:00:00Z"),
        reminder("last-upcoming-day", "2026-10-18T18:29:59Z"),
        reminder("outside-horizon", "2026-10-18T18:30:00Z"),
    ]

    brief = build_brief(reminders, [], now)

    assert brief["local_date"] == "2026-10-11"
    assert brief["local_time"] == "2026-10-11T00:30:00+05:30"
    assert brief["timezone"] == "Asia/Kolkata"
    assert ids(brief, "overdue") == ["overdue"]
    assert ids(brief, "due_today") == ["now", "today-earlier", "today-later"]
    assert ids(brief, "upcoming") == ["tomorrow", "last-upcoming-day"]
    bucket_ids = [item["id"] for key in ("overdue", "due_today", "upcoming", "inbox") for item in brief[key]]
    assert len(bucket_ids) == len(set(bucket_ids))


def test_unarmed_reminders_remain_inbox_despite_past_or_placeholder_dates():
    now = datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
    reminders = [
        reminder("captured", "2000-01-01T00:00:00Z", armed=False),
        reminder("placeholder", "not-a-date", armed=False, status="snoozed"),
        reminder("missing", None, armed=False),
        reminder("armed-invalid", "2026-10-11T15:00:00"),
    ]

    brief = build_brief(reminders, [], now)

    assert ids(brief, "inbox") == ["captured", "placeholder", "missing"]
    assert brief["overdue"] == brief["due_today"] == brief["upcoming"] == []
    assert brief["counts"]["invalid_reminders"] == 3


def test_completed_deleted_excluded_and_snoozed_still_active():
    now = datetime(2026, 10, 11, 10, 0, tzinfo=UTC)
    past = "2026-10-10T10:00:00Z"
    reminders = [
        reminder("completed-status", past, status="completed"),
        reminder("deleted-status", past, status="deleted"),
        reminder("completed-flag", past, completed=True),
        reminder("deleted-flag", past, deleted=True, armed=False),
        reminder("snoozed", past, status="snoozed"),
        reminder("armed-default", "2026-10-11T12:00:00Z"),
        reminder("snoozed-inbox", past, status="snoozed", armed=False),
    ]

    brief = build_brief(reminders, [], now)

    assert ids(brief, "overdue") == ["snoozed"]
    assert ids(brief, "due_today") == ["armed-default"]
    assert ids(brief, "inbox") == ["snoozed-inbox"]
    assert brief["counts"]["active_reminders"] == 3


@pytest.mark.parametrize("status", ["pending", "snoozed"])
@pytest.mark.parametrize("armed", [True, False])
def test_remy_tombstones_are_excluded_from_buckets_and_counts(status, armed):
    now = datetime(2026, 10, 11, 10, 0, tzinfo=UTC)
    reminders = [
        reminder("deleted", "2026-10-11T12:00:00Z", status=status,
                 armed=armed, isDeleted=True),
        reminder("kept", "2026-10-11T12:00:00Z", isDeleted=False),
    ]

    brief = build_brief(reminders, [], now)

    assert ids(brief, "due_today") == ["kept"]
    assert brief["overdue"] == brief["upcoming"] == brief["inbox"] == []
    assert brief["counts"]["active_reminders"] == 1
    assert brief["counts"]["due_today"] == 1
    assert brief["counts"]["invalid_reminders"] == 0


@pytest.mark.parametrize("state,stale", [
    ("live", False), ("cached", True), ("unconfigured", True), ("unavailable", True),
])
def test_source_status_is_transparent_and_empty_input_creates_no_reminders(state, stale):
    snapshot = "2026-10-10T23:00:00Z" if state == "cached" else None
    brief = build_brief([], [], datetime(2026, 10, 11, tzinfo=UTC), reminders_synced_at=snapshot, connection_state=state)

    assert brief["reminder_source"] == {"state": state, "synced_at": snapshot, "stale": stale}
    assert all(brief[key] == [] for key in ("overdue", "due_today", "upcoming", "inbox"))
    assert brief["counts"]["active_reminders"] == 0


def test_notification_selection_omits_promotions_bounds_text_and_preserves_source_fields():
    events = [{
        "id": index,
        "source": "android",
        "source_event_id": f"notification-{index}",
        "package": "example.app",
        "title": f"Event {index}",
        "text": "x" * 250,
        "occurred_at": f"2026-10-11T{index:02d}:00:00Z",
        "category": "informational",
        "raw_payload": "should not be returned",
    } for index in range(12)]
    events.extend([
        {**events[0], "id": "action", "category": "action"},
        {**events[0], "id": "advert", "category": "promotion"},
    ])
    before = deepcopy(events)

    brief = build_brief([], events, datetime(2026, 10, 11, 12, tzinfo=UTC))

    assert [event["id"] for event in brief["notifications"]] == ["action", 11, 10, 9, 8, 7, 6, 5, 4, 3]
    assert brief["counts"]["notifications"] == 10
    assert all(len(event["text"]) == 200 for event in brief["notifications"])
    assert set(brief["notifications"][0]) == {
        "id", "source", "source_event_id", "package", "title", "text", "occurred_at", "category",
    }
    assert brief["notifications"][0]["source_event_id"] == "notification-0"
    assert events == before


def test_input_reminders_are_not_mutated_and_invalid_dates_do_not_break_other_items():
    reminders = [
        reminder("bad", "2026-99-99T00:00:00Z"),
        reminder("valid", "2026-10-11T15:00:00Z"),
    ]
    before = deepcopy(reminders)
    brief = build_brief(reminders, [], datetime(2026, 10, 11, 12, tzinfo=UTC))

    assert ids(brief, "due_today") == ["valid"]
    assert brief["counts"]["invalid_reminders"] == 1
    assert reminders == before
    assert brief["due_today"][0] is not reminders[1]


def test_naive_now_is_rejected_instead_of_using_host_timezone():
    with pytest.raises(ValueError, match="timezone"):
        build_brief([], [], datetime(2026, 10, 11))


def test_extreme_dates_cannot_overflow_utc_or_local_day_conversion():
    reminders = [
        reminder("utc-underflow", "0001-01-01T00:00:00+05:30"),
        reminder("far-future", "9999-12-31T23:59:59Z"),
        reminder("valid", "2026-10-11T15:00:00Z"),
    ]

    brief = build_brief(reminders, [], datetime(2026, 10, 11, 12, tzinfo=UTC))

    assert ids(brief, "due_today") == ["valid"]
    assert brief["overdue"] == brief["upcoming"] == []
    assert brief["counts"]["invalid_reminders"] == 1
