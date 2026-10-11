"""Validated personal context, deliberately separate from notification inference.

Learning uploads are device snapshots for context. They are never commands to
replace another device's learning database, and do not certify code or mastery.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Literal

from pydantic import Field, StrictBool, field_validator, model_validator

from .models import StrictModel, normalize_aware, utc_iso


MAX_SNAPSHOT_BYTES = 1024 * 1024
MAX_LEARNING_RECORDS = 5000
MAX_FACTS = 500
MAX_DEVICES = 20
Identifier = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")]
Revision = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]


class FactWrite(StrictModel):
    base_revision: Revision
    value: str = Field(min_length=1, max_length=4000)
    kind: Literal["fact", "goal", "routine", "preference"]
    source_device_id: Identifier


class LearningProfile(StrictModel):
    track: Literal["frontend", "fullstack", "backend"]
    experienceYears: float = Field(ge=0, le=60, allow_inf_nan=False)
    weekdayMinutes: int = Field(strict=True, ge=15, le=240)
    weekendMinutes: int = Field(strict=True, ge=15, le=240)
    goal: str = Field(min_length=1, max_length=1000)

    @field_validator("experienceYears", mode="before")
    @classmethod
    def numeric_experience(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Experience must be a number.")
        return value


class LearningRecord(StrictModel):
    id: Identifier
    conceptId: Identifier
    createdAt: str = Field(min_length=1, max_length=64)

    @field_validator("createdAt")
    @classmethod
    def aware_timestamp(cls, value):
        from datetime import datetime

        try:
            return utc_iso(normalize_aware(datetime.fromisoformat(value.replace("Z", "+00:00"))))
        except (ValueError, OverflowError):
            raise ValueError("Learning timestamps need an explicit UTC offset.") from None


class LearningAttempt(LearningRecord):
    checkId: Identifier
    confidence: Literal[25, 50, 75, 100]
    selectedIndex: int = Field(strict=True, ge=0, le=99)
    hintUsed: StrictBool
    correct: StrictBool
    checkerVersion: Literal[1]

    @field_validator("confidence", "checkerVersion", mode="before")
    @classmethod
    def whole_number(cls, value):
        if type(value) is not int:
            raise ValueError("Learning checker fields must be integers.")
        return value


class LearningEvidence(LearningRecord):
    kind: Literal["build", "explain"]
    notes: str = Field(min_length=1, max_length=4000)
    reference: str | None = Field(default=None, min_length=1, max_length=2048)
    selfReviewed: StrictBool

    @model_validator(mode="before")
    @classmethod
    def optional_reference(cls, value):
        if isinstance(value, dict) and "reference" in value and value["reference"] is None:
            raise ValueError("Reference must be omitted or contain text.")
        return value


class LearningMisconception(LearningRecord):
    note: str = Field(min_length=1, max_length=4000)
    status: Literal["open", "resolved"]
    resolutionNote: str | None = Field(default=None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def coherent_resolution(self):
        if (self.status == "resolved") != (self.resolutionNote is not None):
            raise ValueError("Only resolved misconceptions need a resolution note.")
        return self


class LearningSnapshotState(StrictModel):
    version: Literal[1]
    profile: LearningProfile
    attempts: list[LearningAttempt] = Field(max_length=MAX_LEARNING_RECORDS)
    evidence: list[LearningEvidence] = Field(max_length=MAX_LEARNING_RECORDS)
    misconceptions: list[LearningMisconception] = Field(max_length=MAX_LEARNING_RECORDS)

    @field_validator("version", mode="before")
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError("Learning format version must be an integer.")
        return value

    @model_validator(mode="after")
    def bounded_unique_records(self):
        records = [*self.attempts, *self.evidence, *self.misconceptions]
        if len(records) > MAX_LEARNING_RECORDS:
            raise ValueError("Learning snapshot has too many records.")
        if len({item.id for item in records}) != len(records):
            raise ValueError("Learning record IDs must be unique within a snapshot.")
        if len(canonical_json(self.model_dump(mode="json", exclude_none=True)).encode("utf-8")) > MAX_SNAPSHOT_BYTES:
            raise ValueError("Learning snapshot exceeds one MiB.")
        return self


class LearningSync(StrictModel):
    device_id: Identifier
    sequence: int = Field(strict=True, ge=1, le=9007199254740991)
    state: LearningSnapshotState


# Unlike the conservative notification filter, this detects credential values
# rather than rejecting ordinary learning goals that mention authentication.
_FACT_CREDENTIAL = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    r"\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|"
    r"\b(?:password|passcode|api[ _-]?key|(?:access|refresh)[ _-]?token|"
    r"secret[ _-]?key|private[ _-]?key)\s*(?:[:=]|\bis\b)\s*\S{4,}|"
    r"\b(?:otp|verification code|one[- ]time (?:password|code)|pin)\s*(?:[:=]|\bis\b)?\s*\d{4,8}\b",
    re.IGNORECASE,
)


def contains_credential(value: str) -> bool:
    return bool(_FACT_CREDENTIAL.search(value))


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":"))


class MemoryConflict(Exception):
    def __init__(self, code: str, current=None):
        self.code = code
        self.current = current
        super().__init__(code)


class MemoryLimit(Exception):
    pass


def learning_summary(device_id: str, sequence: int, updated_at: str, state: dict) -> dict:
    dates = [item["createdAt"] for key in ("attempts", "evidence", "misconceptions") for item in state[key]]
    # All persisted snapshots have normalized, timezone-aware timestamps.
    from datetime import datetime
    latest = max(dates, key=lambda value: datetime.fromisoformat(value.replace("Z", "+00:00"))) if dates else None
    return {
        "device_id": device_id,
        "sequence": sequence,
        "updated_at": updated_at,
        "profile": state["profile"],
        "attempts_count": len(state["attempts"]),
        "evidence_count": len(state["evidence"]),
        "open_misconceptions_count": sum(item["status"] == "open" for item in state["misconceptions"]),
        "latest_activity_at": latest,
    }


def build_personal_context(facts: list[dict], snapshots: list[dict]) -> dict:
    devices = []
    ids = {"attempts": set(), "evidence": set(), "open_misconceptions": set()}
    for snapshot in snapshots:
        state = snapshot["state"]
        devices.append(learning_summary(snapshot["device_id"], snapshot["sequence"], snapshot["updated_at"], state))
        ids["attempts"].update(item["id"] for item in state["attempts"])
        ids["evidence"].update(item["id"] for item in state["evidence"])
        ids["open_misconceptions"].update(item["id"] for item in state["misconceptions"] if item["status"] == "open")
    return {
        "facts": facts,
        "learning": {
            "devices": devices,
            "totals": {"devices_count": len(devices), "attempts_count": len(ids["attempts"]),
                       "evidence_count": len(ids["evidence"]),
                       "open_misconceptions_count": len(ids["open_misconceptions"])},
        },
        "semantics": {
            "facts": "Explicitly saved personal context; notification content does not create trusted facts.",
            "learning": "Latest uploaded snapshot per device, not a command to replace local learning history.",
            "totals": "Unique record IDs across device snapshots. Open means open on at least one device; totals do not establish mastery.",
            "history": "Notification history is separately available at /v1/memories and follows event retention.",
        },
    }


class SharedMemoryBodyLimit:
    """Bound raw uploads, including chunked requests, before JSON validation."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope.get("type") != "http" or scope.get("method") not in {"POST", "PUT"}:
            return await self.app(scope, receive, send)
        if path.endswith("/v1/learning/sync"):
            limit = MAX_SNAPSHOT_BYTES + 65536
        elif "/v1/facts/" in path:
            limit = 65536
        else:
            return await self.app(scope, receive, send)

        chunks = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
                from starlette.responses import JSONResponse
                return await JSONResponse({"detail": {"code": "payload_too_large"}}, status_code=413)(scope, receive, send)
            chunks.append(message)
            if not message.get("more_body", False):
                break
        position = 0

        async def replay():
            nonlocal position
            if position < len(chunks):
                message = chunks[position]
                position += 1
                return message
            return await receive()

        return await self.app(scope, replay, send)
