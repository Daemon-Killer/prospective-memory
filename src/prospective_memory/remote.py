"""HTTP client for the hosted inbox. Used by MCP when PMEM_API_URL is set."""

from __future__ import annotations

from typing import Any

import httpx

from prospective_memory.config import settings


def _headers() -> dict[str, str]:
    return {"X-PMEM-TOKEN": settings.resolved_token(), "Content-Type": "application/json"}


def _base() -> str:
    url = settings.resolved_api_url()
    if not url:
        raise RuntimeError("PMEM_API_URL is not set")
    return url


def capture(text: str, source: str = "mcp") -> dict[str, Any]:
    r = httpx.post(
        f"{_base()}/v1/capture",
        headers=_headers(),
        json={"text": text, "source": source},
        timeout=20.0,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("task") or body


def list_tasks(
    *,
    status: str | None = "open",
    category: str | None = None,
    query: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    if category:
        params["category"] = category
    if query:
        params["q"] = query
    r = httpx.get(f"{_base()}/v1/tasks", headers=_headers(), params=params, timeout=20.0)
    r.raise_for_status()
    return r.json()


def set_status(task_id: str, status: str) -> dict[str, Any]:
    path = "done" if status == "done" else "drop"
    r = httpx.post(f"{_base()}/v1/tasks/{task_id}/{path}", headers=_headers(), timeout=20.0)
    r.raise_for_status()
    return r.json()


def stats() -> dict[str, Any]:
    r = httpx.get(f"{_base()}/v1/stats", headers=_headers(), timeout=20.0)
    r.raise_for_status()
    return r.json()


def latest_otp() -> dict[str, Any]:
    r = httpx.get(f"{_base()}/v1/jarvis/otp", headers=_headers(), timeout=20.0)
    r.raise_for_status()
    return r.json()


def last_whatsapp(sender: str | None = None, limit: int = 10) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": limit}
    if sender:
        params["sender"] = sender
    r = httpx.get(f"{_base()}/v1/jarvis/whatsapp", headers=_headers(), params=params, timeout=20.0)
    r.raise_for_status()
    return r.json()


def missed_summary(minutes: int = 60) -> dict[str, Any]:
    r = httpx.get(
        f"{_base()}/v1/jarvis/missed",
        headers=_headers(),
        params={"minutes": minutes},
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()


def list_reminders(
    status: str | None = None,
    since: str | None = None,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"include_deleted": include_deleted}
    if status:
        params["status"] = status
    if since:
        params["since"] = since
    r = httpx.get(f"{_base()}/v1/reminders", headers=_headers(), params=params, timeout=20.0)
    r.raise_for_status()
    return r.json()


def upsert_reminder(reminder_data: dict[str, Any]) -> dict[str, Any]:
    r = httpx.post(
        f"{_base()}/v1/reminders",
        headers=_headers(),
        json=reminder_data,
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()


def delete_reminder(reminder_id: str) -> dict[str, Any]:
    r = httpx.delete(
        f"{_base()}/v1/reminders/{reminder_id}",
        headers=_headers(),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()


def snooze_reminder(reminder_id: str, due_date: str) -> dict[str, Any]:
    r = httpx.post(
        f"{_base()}/v1/reminders/{reminder_id}/snooze",
        headers=_headers(),
        json={"dueDate": due_date},
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()


def complete_reminder(reminder_id: str) -> dict[str, Any]:
    r = httpx.post(
        f"{_base()}/v1/reminders/{reminder_id}/complete",
        headers=_headers(),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()

