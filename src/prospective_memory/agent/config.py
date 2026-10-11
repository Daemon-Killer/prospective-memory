"""Configuration is explicit; secrets never come from notification content."""

from dataclasses import dataclass
import os
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class Settings:
    agent_token: str
    database: str = "data/agent.sqlite3"
    timezone: str = "Asia/Kolkata"
    retention_days: int = 30
    allowed_packages: tuple[str, ...] = ()
    remy_url: str | None = None
    remy_token: str | None = None

    def __post_init__(self):
        if len(self.agent_token) < 32:
            raise ValueError("AGENT_TOKEN must contain at least 32 characters.")
        if not self.agent_token.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in self.agent_token):
            raise ValueError("AGENT_TOKEN must use printable ASCII without spaces.")
        if not 1 <= self.retention_days <= 365:
            raise ValueError("AGENT_RETENTION_DAYS must be between 1 and 365.")
        try:
            ZoneInfo(self.timezone)
        except ZoneInfoNotFoundError:
            raise ValueError("Unknown AGENT_TIMEZONE; install tzdata if needed.") from None
        if bool(self.remy_url) != bool(self.remy_token):
            raise ValueError("Configure both REMY_API_URL and REMY_API_TOKEN, or neither.")
        if self.remy_token and (not self.remy_token.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in self.remy_token)):
            raise ValueError("REMY_API_TOKEN must use printable ASCII without spaces.")
        if self.remy_url:
            parsed = urlparse(self.remy_url)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.query or parsed.fragment):
                raise ValueError("REMY_API_URL must be an HTTP(S) base URL without credentials.")

    @classmethod
    def from_env(cls):
        return cls(
            agent_token=os.environ.get("AGENT_TOKEN", ""),
            database=os.environ.get("AGENT_DATABASE", "data/agent.sqlite3"),
            timezone=os.environ.get("AGENT_TIMEZONE", "Asia/Kolkata"),
            retention_days=int(os.environ.get("AGENT_RETENTION_DAYS", "30")),
            allowed_packages=tuple(p.strip() for p in os.environ.get(
                "AGENT_ALLOWED_PACKAGES", "").split(",") if p.strip()),
            remy_url=os.environ.get("REMY_API_URL") or None,
            remy_token=os.environ.get("REMY_API_TOKEN") or None,
        )

