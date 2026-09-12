"""Phone JARVIS helpers: OTP extract, redact, event TTL.

OTPs never live in the task inbox. They expire in minutes.
WhatsApp/mail/SMS previews roll off after a day and a half.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

OTP_TTL_SEC = 180
EVENT_TTL_SEC = 36 * 3600
YEARS = {"2024", "2025", "2026", "2027", "2028", "2029", "2030"}

_OTP_HINT = re.compile(
    r"\b(otp|one[\s-]?time(?:\s+pass(?:word|code))?|verification code|"
    r"verification pin|auth(?:entication)? code|security code)\b",
    re.I,
)
_ISOLATED = re.compile(r"(?<!\d)(\d{4,8})(?!\d)")
_KINDS = frozenset({"otp", "whatsapp", "mail", "sms"})


def looks_like_otp(text: str) -> bool:
    return bool(text and _OTP_HINT.search(text))


def extract_otp(text: str) -> str | None:
    if not text or not looks_like_otp(text):
        return None
    codes = [c for c in _ISOLATED.findall(text) if c not in YEARS]
    if not codes:
        return None
    six = [c for c in codes if len(c) == 6]
    return (six or codes)[0]


def redact(text: str, code: str | None) -> str:
    if not text or not code:
        return text
    return text.replace(code, "******")


def event_expiry(kind: str, posted_at: datetime) -> datetime:
    ttl = OTP_TTL_SEC if kind == "otp" else EVENT_TTL_SEC
    return posted_at + timedelta(seconds=ttl)


def normalize_event(raw: dict) -> dict | None:
    """Sanitize a phone-posted event. Returns None if it should be dropped."""
    eid = str(raw.get("id") or "").strip()[:64]
    if len(eid) < 4:
        return None
    kind = str(raw.get("kind") or "").strip().lower()
    if kind not in _KINDS:
        return None
    title = str(raw.get("title") or "").strip()[:200]
    text = str(raw.get("text") or "").strip()[:500]
    if not title and not text:
        return None
    package = str(raw.get("package") or "").strip()[:200]
    app = str(raw.get("app") or raw.get("app_label") or "").strip()[:80]
    posted = _parse_posted(raw.get("posted_at"))
    claimed = str(raw.get("otp") or "").strip()
    blob = f"{title}\n{text}"
    code = claimed if re.fullmatch(r"\d{4,8}", claimed) else extract_otp(blob)
    if not code:
        code = extract_otp(blob)
    if code:
        kind = "otp"
        title = redact(title, code)
        text = redact(text, code)
    elif looks_like_otp(blob):
        kind = "otp"
        code = None
    else:
        code = None
    now = datetime.now(timezone.utc)
    return {
        "id": eid,
        "kind": kind,
        "package": package,
        "app_label": app,
        "title": title,
        "text": text,
        "otp": code,
        "posted_at": posted,
        "expires_at": event_expiry(kind, posted),
        "created_at": now,
    }


def _parse_posted(value: object) -> datetime:
    now = datetime.now(timezone.utc)
    if value is None or value == "":
        return now
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        ms = float(value)
        if ms > 1e12:
            ms /= 1000.0
        return datetime.fromtimestamp(ms, tz=timezone.utc)
    s = str(value).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return now
