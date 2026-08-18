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
