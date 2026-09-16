from __future__ import annotations

import json
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from prospective_memory.api import create_app
from prospective_memory.config import settings
from prospective_memory.mcp_server import (
    mcp,
    capture_cultural_item,
    list_cultural_items,
    create_reminder,
    list_reminders,
    snooze_reminder,
    complete_reminder,
    weekend_watchlist_prompt,
    triage_inbox_prompt,
    reminders_resource,
    watchlist_resource,
    stats_resource,
)


def test_fastmcp_configuration() -> None:
    assert mcp.name == "prospective-memory"
    assert mcp.settings.transport_security.enable_dns_rebinding_protection is False
    assert "Cultural Watchlist" in mcp.instructions


def test_fastmcp_cultural_tools(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "mcp_test.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setenv("PMEM_API_URL", "")

    # 1. Capture movie item
    item1 = capture_cultural_item(
        title="Dune: Part Two",
        media_type="movie",
        platform="Max",
        release_year=2024,
        runtime="166 min",
        genres=["Sci-Fi", "Adventure"],
        notes="Must watch on IMAX or home theater",
        recommended_by="Denis",
    )
    assert item1["title"] == "Dune: Part Two"
    assert item1["armed"] is False
    assert "culturalMetadata" in item1
    meta1 = json.loads(item1["culturalMetadata"])
    assert meta1["mediaType"] == "movie"
    assert meta1["platform"] == "Max"
    assert meta1["releaseYear"] == 2024
    assert meta1["runtime"] == "166 min"
    assert "Sci-Fi" in meta1["genres"]

    # 2. Capture book item
    item2 = capture_cultural_item(
        title="Project Hail Mary",
        media_type="book",
        platform="Kindle",
        release_year=2021,
        runtime="496 pages",
        genres=["Sci-Fi"],
        recommended_by="Andy",
    )
    assert item2["title"] == "Project Hail Mary"
    meta2 = json.loads(item2["culturalMetadata"])
    assert meta2["mediaType"] == "book"

    # 3. List all cultural items
    all_res = list_cultural_items(limit=10)
    assert all_res["total"] == 2
    titles = [x["title"] for x in all_res["items"]]
    assert "Dune: Part Two" in titles
    assert "Project Hail Mary" in titles

    # 4. Filter by media_type
    movies = list_cultural_items(media_type="movie")
    assert movies["total"] == 1
    assert movies["items"][0]["title"] == "Dune: Part Two"
    assert movies["items"][0]["parsedMetadata"]["mediaType"] == "movie"

    books = list_cultural_items(media_type="book")
    assert books["total"] == 1
    assert books["items"][0]["title"] == "Project Hail Mary"

    # 5. Filter by platform
    max_items = list_cultural_items(platform="Max")
    assert max_items["total"] == 1
    assert max_items["items"][0]["title"] == "Dune: Part Two"

    netflix_items = list_cultural_items(platform="Netflix")
    assert netflix_items["total"] == 0

    # 6. Capture with creator and test query/genre filtering
    item3 = capture_cultural_item(
        title="Oppenheimer",
        media_type="movie",
        platform="Prime Video",
        release_year=2023,
        runtime="180 min",
        genres=["History", "Drama"],
        creator="Christopher Nolan",
    )
    meta3 = json.loads(item3["culturalMetadata"])
    assert meta3["creator"] == "Christopher Nolan"

    # Test genre filtering
    hist_items = list_cultural_items(genre="History")
    assert hist_items["total"] == 1
    assert hist_items["items"][0]["title"] == "Oppenheimer"

    # Test query searching (matches title or creator)
    nolan_items = list_cultural_items(query="Nolan")
    assert nolan_items["total"] == 1
    assert nolan_items["items"][0]["title"] == "Oppenheimer"

    # 7. Verify mirrored task category in tasks table is 'watchlist'
    from prospective_memory.db import open_db
    with open_db(db) as conn:
        row = conn.execute("SELECT category FROM tasks WHERE id = ?", (item3["id"],)).fetchone()
        assert row is not None
        assert row[0] == "watchlist"


def test_fastmcp_prompts_and_resources(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "prompts_res.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setenv("PMEM_API_URL", "")

    # Seed cultural item
    capture_cultural_item(
        title="Blade Runner 2049",
        media_type="movie",
        platform="Netflix",
        release_year=2017,
        genres=["Sci-Fi", "Cyberpunk"],
    )

    # Test prompts
    p1 = weekend_watchlist_prompt()
    assert "cultural watchlist" in p1
    assert "list_cultural_items" in p1

    p2 = weekend_watchlist_prompt(genre="Sci-Fi")
    assert "'Sci-Fi' genre" in p2

    p3 = triage_inbox_prompt()
    assert "list_open_tasks" in p3
    assert "list_reminders" in p3

    # Test resources
    rem_json = reminders_resource()
    assert isinstance(rem_json, str)
    parsed_rem = json.loads(rem_json)
    assert isinstance(parsed_rem, list)

    watch_json = watchlist_resource()
    parsed_watch = json.loads(watch_json)
    assert parsed_watch["total"] >= 1

    stats_json = stats_resource()
    parsed_stats = json.loads(stats_json)
    assert "open" in parsed_stats or "version" in parsed_stats


def test_fastapi_mcp_sse_mount(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "fastapi_mcp.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    app = create_app()
    # Verify /mcp routes are mounted
    mounted_routes = [r.path for r in app.routes]
    assert "/mcp" in mounted_routes

    client = TestClient(app, base_url="http://127.0.0.1:8000")
    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["ok"] is True


def test_mcp_configuration_manifests() -> None:
    root = Path(__file__).parent.parent

    # 1. claude_desktop_config.json
    claude_cfg_file = root / "claude_desktop_config.json"
    assert claude_cfg_file.exists()
    claude_cfg = json.loads(claude_cfg_file.read_text(encoding="utf-8"))
    assert "mcpServers" in claude_cfg
    assert "remy-prospective-memory" in claude_cfg["mcpServers"]
    assert "remy-remote-sse" in claude_cfg["mcpServers"]
    claude_dir = Path(claude_cfg["mcpServers"]["remy-prospective-memory"]["args"][1])
    assert claude_dir.exists(), f"Directory {claude_dir} does not exist"

    # 2. cursor_mcp_config.json & .cursor/mcp.json
    cursor_cfg_file = root / "cursor_mcp_config.json"
    assert cursor_cfg_file.exists()
    cursor_cfg = json.loads(cursor_cfg_file.read_text(encoding="utf-8"))
    assert "remy-prospective-memory" in cursor_cfg["mcpServers"]

    dot_cursor_file = root / ".cursor" / "mcp.json"
    assert dot_cursor_file.exists()
    dot_cursor = json.loads(dot_cursor_file.read_text(encoding="utf-8"))
    assert "remy-prospective-memory" in dot_cursor["mcpServers"]
    cursor_dir = Path(dot_cursor["mcpServers"]["remy-prospective-memory"]["args"][1])
    assert cursor_dir.exists(), f"Directory {cursor_dir} does not exist"

    # 3. docs/MCP_SETUP.md
    docs_file = root / "docs" / "MCP_SETUP.md"
    assert docs_file.exists()
    doc_text = docs_file.read_text(encoding="utf-8")
    assert "AI Brain Bridge" in doc_text
    assert "FastMCP Tool Inventory" in doc_text
