"""Small, non-retrying adapter for Remy's authenticated reminder API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx


class RemyError(Exception):
    """A sanitized failure; ambiguous writes must be reconciled before retrying."""

    def __init__(
        self, code: str, *, retryable: bool = False, ambiguous: bool = False
    ) -> None:
        self.code = code
        self.retryable = retryable
        self.ambiguous = ambiguous
        super().__init__(f"Remy request failed ({code}).")


def _instant(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("A timezone is required")
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        # Normalizing boundary dates can overflow even when parsing succeeds.
        raise ValueError("Invalid timezone-aware timestamp") from None


def _validate_reminder(value: Any, *, write: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RemyError("invalid_response", ambiguous=write)

    for field in ("id", "title", "dueDate", "status", "createdAt", "updatedAt"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise RemyError("invalid_response", ambiguous=write)

    if value["status"] not in ("pending", "snoozed", "completed"):
        raise RemyError("invalid_response", ambiguous=write)
    try:
        for field in ("dueDate", "createdAt", "updatedAt"):
            _instant(value[field])
    except (ValueError, OverflowError):
        raise RemyError("invalid_response", ambiguous=write) from None

    count = value.get("snoozeCount")
    if type(count) is not int or count < 0:
        raise RemyError("invalid_response", ambiguous=write)

    reminder = dict(value)
    for field, default in (("armed", True), ("isDeleted", False)):
        flag = reminder.setdefault(field, default)
        if type(flag) is not bool:
            raise RemyError("invalid_response", ambiguous=write)
    return reminder


class RemyClient:
    """Use REST reminder endpoints only; never follow redirects or retry writes."""

    def __init__(
        self,
        base_url: str,
        token: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        try:
            url = httpx.URL(base_url)
        except (httpx.InvalidURL, TypeError, ValueError):
            raise RemyError("invalid_configuration") from None
        if (
            url.scheme not in ("http", "https")
            or not url.host
            or url.username
            or url.password
            or url.query
            or url.fragment
            or not isinstance(token, str)
            or not token
            or any(not 33 <= ord(character) <= 126 for character in token)
        ):
            raise RemyError("invalid_configuration")
        self._base_url = str(url).rstrip("/")
        self._token = token
        self._owns_client = client is None
        self._client = client if client is not None else httpx.AsyncClient()

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _request(
        self, method: str, path: str, *, json: dict | None = None, params: dict | None = None
    ) -> Any:
        write = method != "GET"
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                headers={"X-PMEM-TOKEN": self._token},
                json=json,
                params=params,
                timeout=10.0,
                follow_redirects=False,
            )
        except httpx.TimeoutException:
            raise RemyError("timeout", retryable=not write, ambiguous=write) from None
        except httpx.RequestError:
            raise RemyError("transport_error", retryable=not write, ambiguous=write) from None

        status = response.status_code
        if not 200 <= status < 300:
            raise RemyError(
                f"http_{status}",
                retryable=not write and (status in (408, 429) or status >= 500),
                ambiguous=write and not 400 <= status < 500,
            )
        try:
            return response.json()
        except (ValueError, UnicodeError):
            raise RemyError("invalid_response", ambiguous=write) from None

    async def list_reminders(self) -> list[dict]:
        result = await self._request(
            "GET", "/v1/reminders", params={"include_deleted": "true"}
        )
        if not isinstance(result, list):
            raise RemyError("invalid_response")
        return [_validate_reminder(item) for item in result]

    async def _write_reminder(
        self,
        path: str,
        *,
        json: dict | None = None,
        expected_id: str | None = None,
        expected_status: str | None = None,
        expected_due_date: str | None = None,
    ) -> dict:
        result = _validate_reminder(
            await self._request("POST", path, json=json), write=True
        )
        if expected_id is not None and result["id"] != expected_id:
            raise RemyError("invalid_response", ambiguous=True)
        if expected_status is not None and result["status"] != expected_status:
            raise RemyError("invalid_response", ambiguous=True)
        if expected_due_date is not None and _instant(result["dueDate"]) != _instant(expected_due_date):
            raise RemyError("invalid_response", ambiguous=True)
        return result

    async def create_reminder(self, payload: dict) -> dict:
        try:
            expected = _validate_reminder(payload)
        except RemyError:
            raise RemyError("invalid_request") from None
        result = await self._write_reminder(
            "/v1/reminders",
            json=payload,
            expected_id=expected["id"],
            expected_status=expected["status"],
            expected_due_date=expected["dueDate"],
        )
        if any(result[field] != expected[field] for field in ("title", "armed", "isDeleted")):
            raise RemyError("invalid_response", ambiguous=True)
        return result

    @staticmethod
    def _id_path(reminder_id: str) -> str:
        if not isinstance(reminder_id, str) or not reminder_id.strip():
            raise RemyError("invalid_request")
        # A dot-only path component is normalized by HTTP clients even when
        # encoded. Reject it instead of risking a request to another endpoint.
        if reminder_id in (".", ".."):
            raise RemyError("invalid_request")
        return quote(reminder_id, safe="")

    async def complete_reminder(self, id: str) -> dict:
        return await self._write_reminder(
            f"/v1/reminders/{self._id_path(id)}/complete",
            expected_id=id,
            expected_status="completed",
        )

    async def snooze_reminder(self, id: str, due_date: str) -> dict:
        try:
            _instant(due_date)
        except (TypeError, ValueError, OverflowError):
            raise RemyError("invalid_request") from None
        return await self._write_reminder(
            f"/v1/reminders/{self._id_path(id)}/snooze",
            json={"dueDate": due_date},
            expected_id=id,
            expected_status="snoozed",
            expected_due_date=due_date,
        )
