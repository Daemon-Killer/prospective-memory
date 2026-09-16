from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from prospective_memory import __version__
from prospective_memory.config import settings
from prospective_memory.models import TaskStatus

mcp = FastMCP(
    "prospective-memory",
    instructions=(
        "Phone-first personal inbox + JARVIS pull + Cultural Watchlist. "
        "Tasks: list_open_tasks / search_tasks / capture_task. "
        "Reminders & Culture: list_reminders / create_reminder / capture_cultural_item / list_cultural_items. "
        "Phone life: latest_otp (codes expire in ~3 minutes; if redacted, Android hid the digits — tell them to look at the phone), "
        "last_whatsapp (notification previews, not full chat history), "
        "missed_summary (what arrived recently). "
        "The phone owns OTPs, WhatsApp, mail alerts. This is pull-only. Never invent an OTP."
    ),
)
# Disable DNS rebinding protection so SSE transport works across localhost, LAN, and proxies
mcp.settings.transport_security.enable_dns_rebinding_protection = False


def _remote() -> bool:
    return bool(settings.resolved_api_url())


@mcp.tool()
def capture_task(text: str, source: str = "mcp") -> dict[str, Any]:
    """Save a thought as an open task (same path as the Android capture box)."""
    if _remote():
        from prospective_memory import remote

        return remote.capture(text, source=source)
    from prospective_memory.db import capture

    return capture(text, source=source).model_dump(mode="json")


@mcp.tool()
def list_open_tasks(category: str | None = None, limit: int = 30) -> dict[str, Any]:
    """List open tasks, newest first. Optional category: grocery, bills, people, inbox, …"""
    if _remote():
        from prospective_memory import remote

        return remote.list_tasks(status="open", category=category, limit=limit)
    from prospective_memory.db import list_tasks

    tasks = list_tasks(status="open", category=category, limit=limit)
    return {"total": len(tasks), "tasks": [t.model_dump(mode="json") for t in tasks]}


@mcp.tool()
def search_tasks(query: str, include_done: bool = False, limit: int = 20) -> dict[str, Any]:
    """Search task text/category. By default only open items."""
    status = None if include_done else "open"
    if _remote():
        from prospective_memory import remote

        return remote.list_tasks(status=status, query=query, limit=limit)
    from prospective_memory.db import list_tasks

    tasks = list_tasks(status=status, query=query, limit=limit)
    return {"total": len(tasks), "tasks": [t.model_dump(mode="json") for t in tasks]}


@mcp.tool()
def complete_task(task_id: str) -> dict[str, Any]:
    """Mark a task done."""
    if _remote():
        from prospective_memory import remote

        return remote.set_status(task_id, "done")
    from prospective_memory.db import set_status

    task = set_status(task_id, TaskStatus.DONE)
    if not task:
        return {"error": "not found", "task_id": task_id}
    return task.model_dump(mode="json")


@mcp.tool()
def drop_task(task_id: str) -> dict[str, Any]:
    """Drop a task without completing it."""
    if _remote():
        from prospective_memory import remote

        return remote.set_status(task_id, "drop")
    from prospective_memory.db import set_status

    task = set_status(task_id, TaskStatus.DROPPED)
    if not task:
        return {"error": "not found", "task_id": task_id}
    return task.model_dump(mode="json")


@mcp.tool()
def task_stats() -> dict[str, Any]:
    """Counts by status and open categories. Includes live JARVIS notification counts."""
    if _remote():
        from prospective_memory import remote

        payload = remote.stats()
    else:
        from prospective_memory.db import stats

        payload = stats()
    payload["version"] = __version__
    payload["backend"] = settings.resolved_api_url() or "local"
    return payload


@mcp.tool()
def latest_otp() -> dict[str, Any]:
    """Newest OTP from the phone (SMS/bank/mail/WhatsApp notification). Expires in ~3 minutes. If redacted=true, Android hid the digits — tell the user to look at the phone. Never invent a code."""
    if _remote():
        from prospective_memory import remote

        return remote.latest_otp()
    from prospective_memory.db import latest_otp as _otp

    return _otp()


@mcp.tool()
def last_whatsapp(sender: str | None = None, limit: int = 10) -> dict[str, Any]:
    """Recent WhatsApp notification previews from the phone. Optional sender name filter (e.g. Mom). This is the notification shade, not full chat history."""
    if _remote():
        from prospective_memory import remote

        return remote.last_whatsapp(sender=sender, limit=limit)
    from prospective_memory.db import last_whatsapp as _wa

    return _wa(sender=sender, limit=limit)


@mcp.tool()
def missed_summary(minutes: int = 60) -> dict[str, Any]:
    """What arrived on the phone recently: WhatsApp, mail, SMS, OTPs (codes not included). Default last 60 minutes."""
    if _remote():
        from prospective_memory import remote

        return remote.missed_summary(minutes=minutes)
    from prospective_memory.db import missed_summary as _missed
    return _missed(minutes=minutes)


@mcp.tool()
def list_reminders(
    status: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """List reminders from the unified Remy Reminders ledger (pending, snoozed, completed)."""
    if _remote():
        from prospective_memory import remote

        items = remote.list_reminders(status=status)[:limit]
        return {"total": len(items), "reminders": items}
    from prospective_memory.db import list_reminders as _list_rem

    items = _list_rem(status=status)[:limit]
    return {"total": len(items), "reminders": [r.model_dump(mode="json") for r in items]}


@mcp.tool()
def create_reminder(
    title: str,
    due_date: str | None = None,
    armed: bool = True,
    notes: str | None = None,
    cultural_metadata: str | None = None,
) -> dict[str, Any]:
    """Create a new reminder in the unified ledger. If armed=false, creates an unarmed inbox item."""
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    effective_title = title
    if due_date:
        due_iso = due_date
    elif armed:
        from prospective_memory.infer import infer_time_cue
        cue = infer_time_cue(title, now)
        if cue:
            due_iso = cue["due_date"].isoformat()
            effective_title = cue.get("stripped_title") or title
        else:
            due_iso = (now + timedelta(hours=1)).isoformat()
    else:
        due_iso = now_iso

    rem_id = uuid4().hex[:16]

    if _remote():
        from prospective_memory import remote

        payload = {
            "id": rem_id,
            "title": effective_title,
            "notes": notes,
            "dueDate": due_iso,
            "status": "pending",
            "snoozeCount": 0,
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "armed": armed,
            "culturalMetadata": cultural_metadata,
        }
        return remote.upsert_reminder(payload)
    from prospective_memory.db import upsert_reminder
    from prospective_memory.models import ReminderIn

    rem = ReminderIn(
        id=rem_id,
        title=effective_title,
        notes=notes,
        dueDate=due_iso,
        status="pending",
        snoozeCount=0,
        createdAt=now_iso,
        updatedAt=now_iso,
        armed=armed,
        culturalMetadata=cultural_metadata,
    )
    saved = upsert_reminder(rem)
    return saved.model_dump(mode="json")


@mcp.tool()
def capture_cultural_item(
    title: str,
    media_type: str = "movie",
    platform: str | None = None,
    release_year: int | None = None,
    runtime: str | None = None,
    genres: list[str] | None = None,
    notes: str | None = None,
    recommended_by: str | None = None,
    creator: str | None = None,
) -> dict[str, Any]:
    """Capture a cultural or leisure recommendation (movie, show, documentary, book) into the ledger."""
    import json
    from datetime import datetime, timezone
    from uuid import uuid4

    now_iso = datetime.now(timezone.utc).isoformat()
    rem_id = uuid4().hex[:16]

    meta_dict = {
        "mediaType": media_type.lower() if media_type else "movie",
        "platform": platform,
        "releaseYear": release_year,
        "runtime": runtime,
        "genres": genres or [],
        "recommendedBy": recommended_by,
        "creator": creator,
    }
    meta_json = json.dumps(meta_dict)

    if _remote():
        from prospective_memory import remote

        payload = {
            "id": rem_id,
            "title": title,
            "notes": notes,
            "dueDate": now_iso,
            "status": "pending",
            "snoozeCount": 0,
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "armed": False,
            "culturalMetadata": meta_json,
        }
        return remote.upsert_reminder(payload)
    from prospective_memory.db import upsert_reminder
    from prospective_memory.models import ReminderIn

    rem = ReminderIn(
        id=rem_id,
        title=title,
        notes=notes,
        dueDate=now_iso,
        status="pending",
        snoozeCount=0,
        createdAt=now_iso,
        updatedAt=now_iso,
        armed=False,
        culturalMetadata=meta_json,
    )
    saved = upsert_reminder(rem)
    return saved.model_dump(mode="json")


@mcp.tool()
def list_cultural_items(
    media_type: str | None = None,
    platform: str | None = None,
    genre: str | None = None,
    query: str | None = None,
    status: str | None = "pending",
    limit: int = 50,
) -> dict[str, Any]:
    """List movie and cultural recommendations queued in the leisure ledger."""
    import json
    if _remote():
        from prospective_memory import remote
        items = remote.list_reminders(status=status)
    else:
        from prospective_memory.db import list_reminders as _list_rem
        items = [r.model_dump(mode="json") for r in _list_rem(status=status)]

    cultural_items = []
    for item in items:
        meta_raw = item.get("culturalMetadata")
        if not meta_raw:
            continue
        try:
            meta = json.loads(meta_raw) if isinstance(meta_raw, str) else meta_raw
        except Exception:
            continue
        if media_type and meta.get("mediaType", "").lower() != media_type.lower():
            continue
        if platform and meta.get("platform", "").lower() != platform.lower():
            continue
        if genre:
            item_genres = [g.lower() for g in meta.get("genres", [])]
            if genre.lower() not in item_genres:
                continue
        if query:
            q = query.lower()
            title_match = q in item.get("title", "").lower()
            notes_match = q in str(item.get("notes", "")).lower()
            creator_match = q in str(meta.get("creator", "")).lower()
            if not (title_match or notes_match or creator_match):
                continue
        item_copy = dict(item)
        item_copy["parsedMetadata"] = meta
        cultural_items.append(item_copy)
        if len(cultural_items) >= limit:
            break

    return {"total": len(cultural_items), "items": cultural_items}


@mcp.tool()
def snooze_reminder(
    reminder_id: str,
    target_iso: str | None = None,
    minutes: int = 15,
) -> dict[str, Any]:
    """Snooze a reminder to a target ISO date/time or by N minutes."""
    from datetime import datetime, timezone, timedelta
    if target_iso:
        target = target_iso
    else:
        safe_minutes = max(1, minutes)
        target = (datetime.now(timezone.utc) + timedelta(minutes=safe_minutes)).isoformat()

    if _remote():
        from prospective_memory import remote

        return remote.snooze_reminder(reminder_id, target)
    from prospective_memory.db import snooze_reminder_db

    updated = snooze_reminder_db(reminder_id, target)
    if not updated:
        return {"error": "not found", "reminder_id": reminder_id}
    return updated.model_dump(mode="json")


@mcp.tool()
def complete_reminder(reminder_id: str) -> dict[str, Any]:
    """Mark a reminder completed in the unified ledger."""
    if _remote():
        from prospective_memory import remote

        return remote.complete_reminder(reminder_id)
    from prospective_memory.db import complete_reminder_db

    updated = complete_reminder_db(reminder_id)
    if not updated:
        return {"error": "not found", "reminder_id": reminder_id}
    return updated.model_dump(mode="json")


@mcp.prompt()
def weekend_watchlist_prompt(genre: str = "") -> str:
    """Prompt for curating recommendations from the user's weekend cultural watchlist."""
    genre_text = f" focusing on the '{genre}' genre" if genre else ""
    return (
        f"Review the user's cultural watchlist{genre_text} using the `list_cultural_items` tool. "
        "Recommend 2-3 optimal options for a weekend viewing/reading session. "
        "For each option, explain why it fits well, list its platform and runtime, and propose a Friday/Saturday evening schedule."
    )


@mcp.prompt()
def triage_inbox_prompt() -> str:
    """Prompt for triaging unarmed thoughts, tasks, and overdue reminders."""
    return (
        "Retrieve open tasks with `list_open_tasks` and pending reminders with `list_reminders(status='pending')`. "
        "Identify items that lack time cues or are overdue. "
        "Ask the user for each item whether to arm it with a specific due date, snooze it, or drop it."
    )


@mcp.resource("ledger://reminders")
def reminders_resource() -> str:
    """Resource returning active reminders as JSON."""
    import json
    if _remote():
        from prospective_memory import remote
        items = remote.list_reminders(status="pending")
    else:
        from prospective_memory.db import list_reminders as _list_rem
        items = [r.model_dump(mode="json") for r in _list_rem(status="pending")]
    return json.dumps(items, indent=2)


@mcp.resource("ledger://watchlist")
def watchlist_resource() -> str:
    """Resource returning queued watchlist and cultural items as JSON."""
    import json
    return json.dumps(list_cultural_items(limit=100), indent=2)


@mcp.resource("ledger://stats")
def stats_resource() -> str:
    """Resource returning system and ledger statistics as JSON."""
    import json
    return json.dumps(task_stats(), indent=2)


def run_stdio() -> None:
    mcp.run(transport="stdio")


def run_sse(host: str = "127.0.0.1", port: int = 8001) -> None:
    mcp.settings.host = host
    mcp.settings.port = port
    mcp.run(transport="sse")


if __name__ == "__main__":
    run_stdio()

