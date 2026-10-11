"""Build a read-only briefing from normalized reminders and stored events."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo


_ACTIVE_STATUSES = {"pending", "snoozed"}
_CONNECTION_STATES = {"live", "cached", "unconfigured", "unavailable"}
_NOTIFICATION_FIELDS = (
    "id", "source", "source_event_id", "package", "title", "text",
    "occurred_at", "category",
)


def _parse_timestamp(value: object) -> datetime | None:
    """Accept ISO timestamps with an explicit timezone; normalize to UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def _is_active(reminder: dict) -> bool:
    status = reminder.get("status", "pending")
    return (
        isinstance(status, str)
        and status.lower() in _ACTIVE_STATUSES
        and reminder.get("completed") is not True
        and reminder.get("deleted") is not True
        and reminder.get("isDeleted") is not True
    )


def _notifications(events: list[dict]) -> list[dict]:
    selected = []
    for event in events:
        if event.get("category") not in {"action", "informational"}:
            continue
        # Only the normalized event schema may enter the briefing. In particular,
        # extra raw payload fields are never passed through to the client.
        notification = {key: event.get(key) for key in _NOTIFICATION_FIELDS}
        notification["text"] = str(event.get("text") or "")[:200]
        occurred_at = _parse_timestamp(event.get("occurred_at"))
        selected.append((notification, occurred_at or datetime.min.replace(tzinfo=UTC)))

    # Reserve attention for actionable items first; newest items win within a
    # category. Python's stable sort preserves source order for equal timestamps.
    selected.sort(key=lambda item: item[1], reverse=True)
    selected.sort(key=lambda item: item[0]["category"] != "action")
    return [notification for notification, _ in selected[:10]]


def build_brief(
    reminders: list[dict],
    events: list[dict],
    now: datetime,
    timezone_name: str = "Asia/Kolkata",
    reminders_synced_at: str | None = None,
    connection_state: str = "live",
) -> dict:
    """Return disjoint reminder buckets and at most ten notification excerpts.

    ``now`` and reminder ``dueDate`` timestamps must carry timezone information.
    Upcoming covers the next seven local calendar days, excluding today. Unarmed
    active reminders always remain in the inbox, even when their date is invalid;
    invalid dates are counted and never used to infer urgency. Inputs are not
    mutated, and no data is fetched or written by this function.
    """
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must include timezone information")
    if connection_state not in _CONNECTION_STATES:
        raise ValueError("unknown reminder connection state")

    timezone = ZoneInfo(timezone_name)
    utc_now = now.astimezone(UTC)
    local_now = now.astimezone(timezone)
    today: date = local_now.date()
    horizon = today + timedelta(days=7)
    tomorrow_start = datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone).astimezone(UTC)
    horizon_end = datetime.combine(horizon + timedelta(days=1), datetime.min.time(), timezone).astimezone(UTC)
    buckets: dict[str, list[tuple[dict, datetime | None]]] = {
        "overdue": [], "due_today": [], "upcoming": [], "inbox": [],
    }
    invalid_reminders = 0
    active_reminders = 0

    for reminder in reminders:
        if not _is_active(reminder):
            continue
        active_reminders += 1
        due_at = _parse_timestamp(reminder.get("dueDate"))
        if due_at is None:
            invalid_reminders += 1
        item = (dict(reminder), due_at)
        if reminder.get("armed", True) is False:
            buckets["inbox"].append(item)
            continue
        if due_at is None:
            continue
        if due_at < utc_now:
            buckets["overdue"].append(item)
            continue
        if due_at < tomorrow_start:
            buckets["due_today"].append(item)
        elif due_at < horizon_end:
            buckets["upcoming"].append(item)

    missing_date = datetime.max.replace(tzinfo=UTC)
    reminder_lists = {
        name: [item for item, _ in sorted(items, key=lambda row: row[1] or missing_date)]
        for name, items in buckets.items()
    }
    notifications = _notifications(events)
    counts = {name: len(items) for name, items in reminder_lists.items()}
    counts.update({
        "active_reminders": active_reminders,
        "invalid_reminders": invalid_reminders,
        "notifications": len(notifications),
    })

    return {
        "generated_at": utc_now.isoformat().replace("+00:00", "Z"),
        "local_date": today.isoformat(),
        "local_time": local_now.isoformat(),
        "timezone": timezone_name,
        "reminder_source": {
            "state": connection_state,
            "synced_at": reminders_synced_at,
            "stale": connection_state != "live",
        },
        **reminder_lists,
        "counts": counts,
        "notifications": notifications,
    }
