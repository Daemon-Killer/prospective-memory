"""Validated input contracts. Dates must carry an explicit UTC offset."""

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Timestamp must include a UTC offset")
    try:
        return value.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError("Timestamp is outside the supported UTC range") from None


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Event(StrictModel):
    source: str = Field(min_length=1, max_length=80)
    source_event_id: str = Field(min_length=1, max_length=256)
    package: str | None = Field(default=None, min_length=1, max_length=200)
    title: str = Field(default="", max_length=500)
    text: str = Field(default="", max_length=4000)
    occurred_at: datetime
    category: Literal["informational", "action", "promotion"] = "informational"
    sensitivity: Literal["normal", "secret"] = "normal"
    group_summary: bool = False

    @field_validator("occurred_at")
    @classmethod
    def aware_time(cls, value):
        return normalize_aware(value)

    def as_event(self):
        data = self.model_dump()
        data["occurred_at"] = utc_iso(self.occurred_at)
        return data


class EventBatch(StrictModel):
    events: list[Event] = Field(min_length=1, max_length=40)


class ReminderCreate(StrictModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    due_date: datetime | None = None
    armed: bool = True
    priority: Literal["low", "medium", "high"] | None = None

    @field_validator("due_date")
    @classmethod
    def aware_due_date(cls, value):
        if value is not None:
            return normalize_aware(value)
        return value

    @model_validator(mode="after")
    def scheduled_needs_time(self):
        if self.armed and self.due_date is None:
            raise ValueError("An armed reminder requires due_date; use armed=false for inbox.")
        return self


class Snooze(StrictModel):
    due_date: datetime

    @field_validator("due_date")
    @classmethod
    def aware_due_date(cls, value):
        return normalize_aware(value)

