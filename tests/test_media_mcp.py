from __future__ import annotations

import json
from pathlib import Path
from starlette.testclient import TestClient

from prospective_memory.api import create_app
from prospective_memory.config import settings
from prospective_memory.mcp_server import (
    resolve_music_query,
    play_music,
    now_playing_resource,
)


def test_resolve_music_query_spb_hindi() -> None:
    res = resolve_music_query("play spb songs hindi")
    assert res["resolved"] is True
    assert "Balasubrahmanyam" in res["artist"]
    assert res["clean_query"] == "spb songs hindi"
    assert res["source"] == "jiosaavn_cdn"
    assert res["stream_url"].endswith(".mp3")


def test_resolve_music_query_lofi() -> None:
    res = resolve_music_query("play lofi")
    assert res["resolved"] is True
    assert "Lofi" in res["title"]
    assert "zeno.fm" in res["stream_url"]


def test_play_music_and_now_playing_resource() -> None:
    res = play_music("play lofi beats")
    assert res["status"] == "playing"
    assert res["action"] == "play"
    assert res["now_playing"]["resolved"] is True

    # Resource check
    now_json = now_playing_resource()
    data = json.loads(now_json)
    assert data["status"] == "playing"
    assert data["track"]["clean_query"] == "lofi beats"
    assert data["updated_at"] is not None


def test_api_media_resolve_endpoint(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "api_media.db"
    monkeypatch.setattr(settings, "db_path", db)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    app = create_app()
    client = TestClient(app, base_url="http://127.0.0.1:8000")

    # GET
    res_get = client.get("/v1/media/resolve?q=play spb songs hindi")
    assert res_get.status_code == 200
    data_get = res_get.json()
    assert data_get["resolved"] is True
    assert "Balasubrahmanyam" in data_get["artist"]

    # POST
    res_post = client.post("/v1/media/resolve", json={"q": "listen to ghazal"})
    assert res_post.status_code == 200
    data_post = res_post.json()
    assert data_post["resolved"] is True
    assert "Jagjit" in data_post["artist"]

    # Now playing
    client.get("/v1/media/resolve?q=play spb songs hindi")
    res_now = client.get("/v1/media/now_playing")
    assert res_now.status_code == 200

    # GET with whitespace query fails with 400
    res_ws = client.get("/v1/media/resolve?q=   ")
    assert res_ws.status_code == 400

    # POST with empty query fails with 400
    res_empty_post = client.post("/v1/media/resolve", json={"q": "   "})
    assert res_empty_post.status_code == 400


def test_resolve_music_query_disambiguation() -> None:
    # Sports and tasks must not resolve to music streaming
    res_tennis = resolve_music_query("play tennis")
    assert res_tennis["resolved"] is False

    res_kids = resolve_music_query("play with kids")
    assert res_kids["resolved"] is False

    res_mom = resolve_music_query("listen to mom")
    assert res_mom["resolved"] is False

    res_jacket = resolve_music_query("put on jacket")
    assert res_jacket["resolved"] is False

    res_empty = resolve_music_query("   ")
    assert res_empty["resolved"] is False


def test_play_music_rejects_non_music() -> None:
    res = play_music("play tennis")
    assert res["status"] == "rejected"
    assert res["action"] == "none"
    assert res["now_playing"] is None

