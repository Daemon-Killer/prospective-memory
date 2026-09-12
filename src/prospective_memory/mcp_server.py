from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from prospective_memory import __version__
from prospective_memory.config import settings
from prospective_memory.models import TaskStatus

mcp = FastMCP(
    "prospective-memory",
    instructions=(
        "Phone-first personal inbox + JARVIS pull. "
        "Tasks: list_open_tasks / search_tasks / capture_task. "
        "Phone life: latest_otp (codes expire in ~3 minutes; if redacted, Android hid the digits — tell them to look at the phone), "
        "last_whatsapp (notification previews, not full chat history), "
        "missed_summary (what arrived recently). "
        "The phone owns OTPs, WhatsApp, mail alerts. This is pull-only. Never invent an OTP."
    ),
)


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


def run_stdio() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    run_stdio()
