from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from prospective_memory.db import ingest_jarvis_events, last_whatsapp, latest_otp, missed_summary
from prospective_memory.jarvis import extract_otp, looks_like_otp, redact


def test_extract_otp_indian_sms() -> None:
    assert extract_otp("123456 is the OTP for HDFC Bank txn") == "123456"
    assert extract_otp("Your SBI OTP is 998877") == "998877"
    assert extract_otp("verification code: 4411") == "4411"


def test_extract_otp_ignores_non_otp() -> None:
    assert extract_otp("Mom: get milk for 123456") is None
    assert extract_otp("Meet at 2026") is None
    assert looks_like_otp("OTP from Axis") is True


def test_redact() -> None:
    assert "123456" not in redact("code 123456 from HDFC", "123456")


def test_otp_ttl_and_whatsapp(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "t.db"
    from prospective_memory import db as dbmod

    monkeypatch.setattr(dbmod.settings, "db_path", db)
    monkeypatch.setattr(dbmod.settings, "data_dir", tmp_path)
    monkeypatch.setattr(dbmod.settings, "database_url", "")

    now = datetime.now(timezone.utc)
    ingest_jarvis_events(
        [
            {
                "id": "otp-1-abcd",
                "kind": "sms",
                "package": "com.google.android.apps.messaging",
                "app": "Messages",
                "title": "HDFC",
                "text": "882211 is the OTP for login",
                "posted_at": now.isoformat(),
            },
            {
                "id": "wa-1-abcd",
                "kind": "whatsapp",
                "package": "com.whatsapp",
                "app": "WhatsApp",
                "title": "Mom",
                "text": "dahi lena",
                "posted_at": now.isoformat(),
            },
            {
                "id": "mail-1-abcd",
                "kind": "mail",
                "package": "com.google.android.gm",
                "app": "Gmail",
                "title": "HR",
                "text": "Offer letter attached",
                "posted_at": (now - timedelta(minutes=10)).isoformat(),
            },
        ],
        db_path=db,
    )

    otp = latest_otp(db_path=db)
    assert otp["found"] is True
    assert otp["code"] == "882211"
    assert otp["redacted"] is False
    assert "882211" not in (otp.get("text") or "")

    wa = last_whatsapp(sender="Mom", db_path=db)
    assert wa["total"] == 1
    assert wa["messages"][0]["text"] == "dahi lena"

    missed = missed_summary(minutes=60, db_path=db)
    assert missed["counts"]["otp"] == 1
    assert missed["counts"]["whatsapp"] == 1
    assert missed["counts"]["mail"] == 1
    otp_highlight = next(h for h in missed["highlights"] if h["kind"] == "otp")
    assert otp_highlight["last_text"] == "OTP"
    assert "882211" not in str(missed)


def test_expired_otp_gone(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "t.db"
    from prospective_memory import db as dbmod

    monkeypatch.setattr(dbmod.settings, "db_path", db)
    monkeypatch.setattr(dbmod.settings, "data_dir", tmp_path)
    monkeypatch.setattr(dbmod.settings, "database_url", "")

    old = datetime.now(timezone.utc) - timedelta(minutes=10)
    ingest_jarvis_events(
        [
            {
                "id": "otp-old-xx",
                "kind": "otp",
                "package": "sms",
                "app": "Messages",
                "title": "Axis",
                "text": "OTP 445566",
                "otp": "445566",
                "posted_at": old.isoformat(),
            }
        ],
        db_path=db,
    )
    # posted_at is 10 min ago so expires_at = posted+3min is already past; purge on read
    assert latest_otp(db_path=db)["found"] is False
