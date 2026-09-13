"""Offline heuristic intent extract — no API keys. Good enough for v1 capture."""

from __future__ import annotations

import re

from prospective_memory.models import TriggerType

from datetime import datetime, timedelta, timezone

_RULES: list[tuple[re.Pattern[str], str, TriggerType, str, float]] = [
    (
        re.compile(r"\b(dahi|doodh|milk|grocery|kirana|sabzi|veg|onion|atta|rice|and[eé])\b", re.I),
        "grocery",
        TriggerType.ROUTE_CATEGORY,
        "kirana / grocery stop",
        0.72,
    ),
    (
        re.compile(r"\b(buy|lena|le lena|purchase|order)\b", re.I),
        "errand",
        TriggerType.ROUTE_CATEGORY,
        "next relevant stop",
        0.6,
    ),
    (
        re.compile(r"\b(bill|electricity|bijli|recharge|rent|emi|pay)\b", re.I),
        "bills",
        TriggerType.TIME,
        "pay soon",
        0.7,
    ),
    (
        re.compile(r"\b(call|phone|whatsapp|message|text|mail)\b", re.I),
        "people",
        TriggerType.NONE,
        "",
        0.62,
    ),
    (
        re.compile(r"\b(home|ghar|office|office pahunch|reached)\b", re.I),
        "place",
        TriggerType.FIXED_LOCATION,
        "home_or_office",
        0.58,
    ),
    (
        re.compile(r"\b(tomorrow|kal|tonight|shaam|morning|subah|monday|friday)\b", re.I),
        "timed",
        TriggerType.TIME,
        "time phrase in text",
        0.55,
    ),
]


def infer_time_cue(text: str, now: datetime | None = None) -> dict | None:
    if now is None:
        now = datetime.now(timezone.utc)
    blob = text.strip()
    lower = blob.lower()

    # 1. tomorrow morning / kal subah
    if re.search(r"\b(tomorrow morning|kal subah)\b", lower):
        target = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        stripped = re.sub(r"\b(tomorrow morning|kal subah)\b", "", blob, flags=re.I).strip()
        return {"preset": "tomorrow_morning", "due_date": target, "stripped_title": stripped or blob, "detail": "tomorrow morning"}

    # 2. tonight / this evening / shaam
    if re.search(r"\b(tonight|this evening|shaam)\b", lower):
        target = now.replace(hour=20, minute=0, second=0, microsecond=0)
        if now.hour >= 20:
            target = now + timedelta(hours=2)
        stripped = re.sub(r"\b(tonight|this evening|shaam)\b", "", blob, flags=re.I).strip()
        return {"preset": "evening", "due_date": target, "stripped_title": stripped or blob, "detail": "this evening"}

    # 3. weekend / saturday
    if re.search(r"\b(weekend|saturday)\b", lower):
        days_ahead = (5 - now.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        target = (now + timedelta(days=days_ahead)).replace(hour=9, minute=0, second=0, microsecond=0)
        stripped = re.sub(r"\b(weekend|saturday)\b", "", blob, flags=re.I).strip()
        return {"preset": "weekend", "due_date": target, "stripped_title": stripped or blob, "detail": "weekend"}

    # 4. 1h / 1 hour / in an hour
    if re.search(r"\b(\+?1h|1 hour|in an hour)\b", lower):
        target = now + timedelta(hours=1)
        stripped = re.sub(r"\b(\+?1h|1 hour|in an hour)\b", "", blob, flags=re.I).strip()
        return {"preset": "1h", "due_date": target, "stripped_title": stripped or blob, "detail": "1 hour"}

    # 5. 15m / 15 min / in 15
    if re.search(r"\b(\+?15m|\+15|15 mins?|in 15)\b", lower):
        target = now + timedelta(minutes=15)
        stripped = re.sub(r"\b(\+?15m|\+15|15 mins?|in 15)\b", "", blob, flags=re.I).strip()
        return {"preset": "15m", "due_date": target, "stripped_title": stripped or blob, "detail": "15 min"}

    # 6. tomorrow / kal / subah / morning
    if re.search(r"\b(tomorrow|kal|subah|morning)\b", lower):
        target = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        stripped = re.sub(r"\b(tomorrow|kal|subah|morning)\b", "", blob, flags=re.I).strip()
        return {"preset": "tomorrow_morning", "due_date": target, "stripped_title": stripped or blob, "detail": "tomorrow"}

    # 7. evening
    if re.search(r"\b(evening)\b", lower):
        target = now.replace(hour=20, minute=0, second=0, microsecond=0)
        if now.hour >= 20:
            target = now + timedelta(hours=2)
        stripped = re.sub(r"\b(evening)\b", "", blob, flags=re.I).strip()
        return {"preset": "evening", "due_date": target, "stripped_title": stripped or blob, "detail": "evening"}

    return None


def infer(text: str) -> dict:
    blob = text.strip()
    cue = infer_time_cue(blob)

    detected_category: str | None = None
    detected_conf: float = 0.5
    for pat, category, _, _, conf in _RULES:
        if pat.search(blob):
            detected_category = category
            detected_conf = conf
            break

    if cue:
        return {
            "category": detected_category if (detected_category and detected_category != "timed") else "timed",
            "trigger_type": TriggerType.TIME,
            "trigger_detail": cue["detail"],
            "confidence": max(0.65, detected_conf),
            "target_time": cue["due_date"],
            "stripped_title": cue["stripped_title"],
        }

    for pat, category, trigger, detail, conf in _RULES:
        if pat.search(blob):
            return {
                "category": category,
                "trigger_type": trigger,
                "trigger_detail": detail,
                "confidence": conf,
            }

    return {
        "category": "inbox",
        "trigger_type": TriggerType.NONE,
        "trigger_detail": "",
        "confidence": 0.4,
    }

