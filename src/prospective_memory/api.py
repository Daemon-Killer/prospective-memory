from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from prospective_memory import __version__ as APP_VERSION
from prospective_memory.config import settings
from prospective_memory.db import (
    batch_sync_reminders,
    capture,
    complete_reminder_db,
    delete_reminder,
    ingest_jarvis_events,
    last_whatsapp,
    latest_otp,
    list_reminders,
    list_tasks,
    missed_summary,
    set_status,
    snooze_reminder_db,
    stats,
    upsert_reminder,
)
from prospective_memory.mcp_server import mcp
from prospective_memory.models import (
    CaptureIn,
    CaptureOut,
    JarvisBatchIn,
    ReminderIn,
    ReminderOut,
    ReminderSnoozeIn,
    ReminderSyncBatchIn,
    ReminderSyncBatchOut,
    TaskStatus,
)


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
        db_status = "untested"
        db_error = None
        count = None
        try:
            from prospective_memory.db import connect
            with connect() as conn:
                cur = conn.cursor()
                cur.execute("SELECT count(*) FROM reminders")
                res = cur.fetchone()
                if isinstance(res, (list, tuple)):
                    count = res[0]
                elif hasattr(res, "keys"):
                    count = res[list(res.keys())[0]]
                elif res is not None:
                    count = res[0]
                else:
                    count = 0
                db_status = f"connected ({count} reminders)"
        except Exception as e:
            db_status = "error"
            db_error = f"{type(e).__name__}: {str(e)}"

        return {
            "ok": db_status != "error",
            "version": APP_VERSION,
            "commit": "deploy_probe_v1",
            "db_type": "postgres" if settings.resolved_database_url() else "sqlite",
            "db_status": db_status,
            "db_error": db_error,
            "jarvis": True,
        }

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

    @app.get("/v1/reminders", response_model=list[ReminderOut], dependencies=[Depends(_check_token)])
    def get_reminders(
        status: str | None = None,
        since: str | None = None,
        include_deleted: bool | None = Query(default=None),
    ) -> list[ReminderOut]:
        # Incremental fetches must include tombstones so other devices can apply deletes.
        include_deleted_flag = bool(since) if include_deleted is None else include_deleted
        return list_reminders(
            status=status,
            since=since,
            include_deleted=include_deleted_flag,
        )

    @app.post("/v1/reminders", response_model=ReminderOut, dependencies=[Depends(_check_token)])
    def post_reminder(body: ReminderIn) -> ReminderOut:
        return upsert_reminder(body)

    @app.post("/v1/reminders/sync", response_model=ReminderSyncBatchOut, dependencies=[Depends(_check_token)])
    def post_reminders_sync(body: ReminderSyncBatchIn) -> ReminderSyncBatchOut:
        return batch_sync_reminders(
            client_reminders=body.reminders,
            client_sync_time=body.clientSyncTime,
        )

    @app.delete("/v1/reminders/{reminder_id}", dependencies=[Depends(_check_token)])
    def remove_reminder(reminder_id: str) -> dict:
        ok = delete_reminder(reminder_id)
        if not ok:
            raise HTTPException(404, "not found")
        return {"ok": True, "id": reminder_id}

    @app.post("/v1/reminders/{reminder_id}/snooze", response_model=ReminderOut, dependencies=[Depends(_check_token)])
    def post_reminder_snooze(reminder_id: str, body: ReminderSnoozeIn) -> ReminderOut:
        rem = snooze_reminder_db(reminder_id, target_date=body.dueDate)
        if not rem:
            raise HTTPException(404, "not found")
        return rem

    @app.post("/v1/reminders/{reminder_id}/complete", response_model=ReminderOut, dependencies=[Depends(_check_token)])
    def post_reminder_complete(reminder_id: str) -> ReminderOut:
        rem = complete_reminder_db(reminder_id)
        if not rem:
            raise HTTPException(404, "not found")
        return rem

    # Mount FastMCP SSE Starlette application for Claude Desktop, Cursor, and LLM SSE tool calling
    app.mount("/mcp", mcp.sse_app(mount_path="/mcp"))

    return app


app = create_app()
