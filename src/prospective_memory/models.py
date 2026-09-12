from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    OPEN = "open"
    DONE = "done"
    DROPPED = "dropped"


class TriggerType(str, Enum):
    NONE = "none"
    TIME = "time"
    FIXED_LOCATION = "fixed_location"
    ROUTE_CATEGORY = "route_category"
    CHECK_IN = "check_in"
    APP_OPEN = "app_open"


class Task(BaseModel):
    id: str
    text: str
    raw: str
    category: str = "inbox"
    trigger_type: TriggerType = TriggerType.NONE
    trigger_detail: str = ""
    status: TaskStatus = TaskStatus.OPEN
    confidence: float = 0.5
    source: str = "api"
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source: str = "android"


class CaptureOut(BaseModel):
    task: Task
    inferred: bool


class JarvisKind(str, Enum):
    OTP = "otp"
    WHATSAPP = "whatsapp"
    MAIL = "mail"
    SMS = "sms"


class JarvisEventIn(BaseModel):
    id: str = Field(min_length=4, max_length=64)
    kind: JarvisKind
    package: str = Field(default="", max_length=200)
    app: str = Field(default="", max_length=80)
    title: str = Field(default="", max_length=200)
    text: str = Field(default="", max_length=500)
    otp: str | None = Field(default=None, max_length=16)
    posted_at: datetime | str | int | None = None


class JarvisBatchIn(BaseModel):
    events: list[JarvisEventIn] = Field(default_factory=list, max_length=40)
