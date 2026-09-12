from __future__ import annotations

import os
import secrets
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = REPO_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PMEM_", env_file=".env", extra="ignore")

    data_dir: Path = DEFAULT_DATA
    db_path: Path = DEFAULT_DATA / "tasks.db"
    token: str = ""
    host: str = "0.0.0.0"
    port: int = 8790
    # When set, MCP/CLI talk to this hosted API instead of local SQLite.
    api_url: str = ""
    database_url: str = ""

    def ensure(self) -> None:
        if self.is_hosted() and not self.resolved_database_url():
            hosted = Path("/tmp/pmem-data")
            hosted.mkdir(parents=True, exist_ok=True)
            self.data_dir = hosted
            self.db_path = hosted / "tasks.db"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def listen_port(self) -> int:
        raw = os.environ.get("PORT") or str(self.port)
        try:
            return int(raw)
        except ValueError:
            return 8790

    def resolved_database_url(self) -> str:
        return (
            self.database_url
            or os.environ.get("DATABASE_URL")
            or os.environ.get("DATABASE_PRIVATE_URL")
            or ""
        ).strip()

    def resolved_api_url(self) -> str:
        return (self.api_url or os.environ.get("PMEM_API_URL") or "").strip().rstrip("/")

    def is_hosted(self) -> bool:
        return bool(
            os.environ.get("RAILWAY_ENVIRONMENT")
            or os.environ.get("RAILWAY_PROJECT_ID")
            or os.environ.get("RENDER")
            or os.environ.get("RENDER_SERVICE_ID")
            or os.environ.get("RENDER_INSTANCE_ID")
        )

    def resolved_token(self) -> str:
        if self.token.strip():
            return self.token.strip()
        env = os.environ.get("PMEM_TOKEN", "").strip()
        if env:
            return env
        if self.is_hosted():
            raise RuntimeError("PMEM_TOKEN must be set in production")
        self.ensure()
        token_file = self.data_dir / "token.txt"
        if token_file.exists():
            return token_file.read_text(encoding="utf-8").strip()
        generated = secrets.token_urlsafe(24)
        token_file.write_text(generated, encoding="utf-8")
        return generated


settings = Settings()
