"""Offline heuristic intent extract — no API keys. Good enough for v1 capture."""

from __future__ import annotations

import re

from prospective_memory.models import TriggerType

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


def infer(text: str) -> dict:
    blob = text.strip()
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
