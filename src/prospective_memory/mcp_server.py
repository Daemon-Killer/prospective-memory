from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from prospective_memory import __version__
from prospective_memory.config import settings
from prospective_memory.models import TaskStatus

mcp = FastMCP(
    "prospective-memory",
    instructions=(
        "Open-task inbox captured from the user's phone. "
        "Use list_open_tasks / search_tasks when they ask what to do, buy, or remember. "
        "Use capture_task if they dictate a thought here. "
        "Not a notification service — pull only. Not Google Takeout."
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
    """Counts by status and open categories."""
    if _remote():
        from prospective_memory import remote

        payload = remote.stats()
    else:
        from prospective_memory.db import stats

        payload = stats()
    payload["version"] = __version__
    payload["backend"] = settings.resolved_api_url() or "local"
    return payload


def run_stdio() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    run_stdio()
