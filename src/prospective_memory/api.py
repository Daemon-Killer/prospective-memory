from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from prospective_memory import __version__ as APP_VERSION
from prospective_memory.config import settings
from prospective_memory.db import (
    capture,
    ingest_jarvis_events,
    last_whatsapp,
    latest_otp,
    list_tasks,
    missed_summary,
    set_status,
    stats,
)
from prospective_memory.models import CaptureIn, CaptureOut, JarvisBatchIn, TaskStatus


def _check_token(x_pmem_token: str | None = Header(default=None)) -> None:
    expected = settings.resolved_token()
    if not x_pmem_token or x_pmem_token != expected:
        raise HTTPException(status_code=401, detail="missing or bad X-PMEM-TOKEN")


def create_app() -> FastAPI:
    app = FastAPI(title="Prospective Memory", version=APP_VERSION)

    @app.on_event("startup")
    def _startup() -> None:
        print(f"pmem api {APP_VERSION} starting", flush=True)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "version": APP_VERSION, "jarvis": True}

    @app.post("/v1/capture", response_model=CaptureOut, dependencies=[Depends(_check_token)])
    def post_capture(body: CaptureIn) -> CaptureOut:
        task = capture(body.text, source=body.source)
        return CaptureOut(task=task, inferred=task.confidence >= 0.55)

    @app.get("/v1/tasks", dependencies=[Depends(_check_token)])
    def get_tasks(
        status: str | None = Query("open"),
        category: str | None = None,
        q: str | None = None,
        limit: int = Query(50, ge=1, le=200),
    ) -> dict:
        tasks = list_tasks(status=status, category=category, query=q, limit=limit)
        return {"total": len(tasks), "tasks": [t.model_dump(mode="json") for t in tasks]}

    @app.post("/v1/tasks/{task_id}/done", dependencies=[Depends(_check_token)])
    def mark_done(task_id: str) -> dict:
        task = set_status(task_id, TaskStatus.DONE)
        if not task:
            raise HTTPException(404, "not found")
        return task.model_dump(mode="json")

    @app.post("/v1/tasks/{task_id}/drop", dependencies=[Depends(_check_token)])
    def mark_drop(task_id: str) -> dict:
        task = set_status(task_id, TaskStatus.DROPPED)
        if not task:
            raise HTTPException(404, "not found")
        return task.model_dump(mode="json")

    @app.get("/v1/stats", dependencies=[Depends(_check_token)])
    def get_stats() -> dict:
        return stats()

    @app.post("/v1/jarvis/events", dependencies=[Depends(_check_token)])
    def post_jarvis_events(body: JarvisBatchIn) -> dict:
        raw = [e.model_dump(mode="json") for e in body.events]
        return ingest_jarvis_events(raw)

    @app.get("/v1/jarvis/otp", dependencies=[Depends(_check_token)])
    def get_jarvis_otp() -> dict:
        return latest_otp()

    @app.get("/v1/jarvis/whatsapp", dependencies=[Depends(_check_token)])
    def get_jarvis_whatsapp(
        sender: str | None = None,
        limit: int = Query(10, ge=1, le=50),
    ) -> dict:
        return last_whatsapp(sender=sender, limit=limit)

    @app.get("/v1/jarvis/missed", dependencies=[Depends(_check_token)])
    def get_jarvis_missed(minutes: int = Query(60, ge=1, le=2160)) -> dict:
        return missed_summary(minutes=minutes)

    return app


app = create_app()
