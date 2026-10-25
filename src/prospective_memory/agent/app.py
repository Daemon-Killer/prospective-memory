"""Authenticated, local companion API. Remy owns reminder state and alarms."""

from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import secrets
from typing import Callable
from uuid import NAMESPACE_URL, uuid5

from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .brief import build_brief
from .config import Settings
from .extraction import review_candidates
from .models import EventBatch, ReminderCreate, Snooze, utc_iso
from .remy_client import RemyClient, RemyError
from .store import Store
from .shared_memory import (FactWrite, LearningSync, MemoryConflict, MemoryLimit,
                            SharedMemoryBodyLimit, build_personal_context, contains_credential)


def utc_now():
    return datetime.now(timezone.utc)


def create_app(settings: Settings | None = None, *, store: Store | None = None,
               remy_client: RemyClient | None = None,
               clock: Callable[[], datetime] = utc_now) -> FastAPI:
    settings = settings or Settings.from_env()
    store = store or Store(settings.database)
    remy = remy_client
    if remy is None and settings.remy_url:
        remy = RemyClient(settings.remy_url, settings.remy_token)

    @asynccontextmanager
    async def lifespan(app):
        yield
        if remy is not None:
            await remy.close()

    app = FastAPI(title="Remy Personal Agent", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SharedMemoryBodyLimit)
    app.state.agent_store = store

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, exc):
        # Validation responses must not echo a rejected password, notification or
        # personal note back into logs or a client's error telemetry.
        return JSONResponse({"detail": {"code": "invalid_request", "fields": [
            {"loc": error["loc"], "type": error["type"]} for error in exc.errors()
        ]}}, status_code=422)

    @app.exception_handler(MemoryConflict)
    async def memory_conflict(_request, exc):
        detail = {"code": exc.code}
        if exc.code == "sequence_conflict":
            detail["current_sequence"] = exc.current
        else:
            detail["current"] = exc.current
        return JSONResponse({"detail": detail}, status_code=409)

    @app.exception_handler(MemoryLimit)
    async def memory_limit(_request, _exc):
        return JSONResponse({"detail": {"code": "memory_capacity", "message": "Shared memory capacity reached."}}, status_code=409)

    async def authenticate(x_agent_token: str | None = Header(default=None)):
        value = x_agent_token or ""
        if not secrets.compare_digest(value.encode("utf-8"), settings.agent_token.encode("ascii")) and not await asyncio.to_thread(store.authenticate_device, value, settings.agent_token):
            raise HTTPException(401, detail="Missing or invalid agent token.")

    protected = [Depends(authenticate)]
    from .pairing_routes import add_pairing_routes
    add_pairing_routes(app, store, settings.agent_token, protected, clock)

    def personal_context():
        facts, snapshots = store.get_personal_context()
        return build_personal_context(facts, snapshots)

    def prune():
        store.prune_events(utc_iso(clock() - timedelta(days=settings.retention_days)))

    def require_remy():
        if remy is None:
            raise HTTPException(503, detail={"code": "remy_unconfigured",
                                           "message": "Configure the existing Remy API first."})
        return remy

    async def reminders_snapshot():
        if remy is not None:
            try:
                items = await remy.list_reminders()
                stamp = utc_iso(clock())
                await asyncio.to_thread(store.replace_reminders, items, stamp)
                return items, stamp, "live", None
            except RemyError as exc:
                items, stamp = await asyncio.to_thread(store.get_reminders)
                return items, stamp, "cached" if stamp else "unavailable", exc.code
        items, stamp = await asyncio.to_thread(store.get_reminders)
        return items, stamp, "cached" if stamp else "unconfigured", None

    def cache_action(reminder):
        # A write response updates an existing full snapshot without claiming
        # the entire server was freshly synchronized.
        items, stamp = store.get_reminders()
        if stamp is not None:
            items = [item for item in items if item["id"] != reminder["id"]]
            items.append(reminder)
            store.replace_reminders(items, stamp)

    def key_value(key: str):
        if not re.fullmatch(r"[A-Za-z0-9._-]{8,128}", key):
            raise HTTPException(422, detail="Idempotency-Key must be 8–128 letters, digits, dots, underscores or hyphens.")
        return key

    def action_response(key, result):
        status = result.get("http_status", 200)
        body = {k: v for k, v in result.items() if k != "http_status"}
        return JSONResponse({"action_key": key, **body}, status_code=status)

    async def perform(key: str, request: dict):
        client = require_remy()
        key_value(key)
        fingerprint = hashlib.sha256(json.dumps(
            request, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        try:
            claim = await asyncio.to_thread(store.begin_action, key, fingerprint, request=request)
        except ValueError:
            raise HTTPException(409, detail={"code": "idempotency_conflict",
                                            "message": "This key already belongs to another request."}) from None
        if claim["status"] == "existing":
            if claim["action_status"] == "done":
                return action_response(key, claim["result"])
            raise HTTPException(409, detail={"code": "action_pending", "action_key": key,
                "message": "Outcome is unresolved. Reconcile this key before issuing another action."})
        try:
            kind, rid, payload = request["kind"], request["reminder_id"], request["payload"]
            if kind == "create":
                reminder = await client.create_reminder(payload)
            elif kind == "complete":
                reminder = await client.complete_reminder(rid)
            else:
                reminder = await client.snooze_reminder(rid, payload["dueDate"])
        except RemyError as exc:
            if exc.ambiguous:
                raise HTTPException(502, detail={"code": exc.code, "action_key": key,
                    "pending": True, "message": "Remy may have received this action; reconcile before retrying."}) from None
            result = {"ok": False, "error": exc.code, "http_status": 502}
            result = await asyncio.to_thread(store.finish_action_once, key, result)
            return action_response(key, result)
        result = {"ok": True, "reminder": reminder}
        result = await asyncio.to_thread(store.finish_action_once, key, result)
        if result.get("ok"):
            await asyncio.to_thread(cache_action, result["reminder"])
        return action_response(key, result)

    @app.get("/health")
    async def health():
        ping = getattr(store, "ping", None)
        if ping is not None:
            try:
                available = await asyncio.to_thread(ping)
            except Exception:
                available = False
            if not available:
                raise HTTPException(503, detail={"code": "agent_storage_unavailable"})
        return {"ok": True, "version": "0.1.0"}

    @app.post("/v1/events", dependencies=protected)
    def ingest(batch: EventBatch):
        prune()
        results = []
        cutoff = clock() - timedelta(days=settings.retention_days)
        for event in batch.events:
            if settings.allowed_packages and event.package not in settings.allowed_packages:
                result = {"status": "ignored", "reason": "package_not_allowed"}
            elif event.occurred_at < cutoff:
                result = {"status": "ignored", "reason": "outside_retention"}
            elif event.occurred_at > clock() + timedelta(minutes=5):
                result = {"status": "ignored", "reason": "future_event_clock"}
            else:
                result = store.ingest_event(event.as_event())
            results.append({**result, "source": event.source, "source_event_id": event.source_event_id})
        return {"results": results}

    @app.get("/v1/facts", dependencies=protected)
    def facts(include_deleted: bool = False):
        return {"facts": store.list_facts(include_deleted=include_deleted)}

    @app.put("/v1/facts/{fact_id}", dependencies=protected)
    def put_fact(body: FactWrite, fact_id: str = Path(pattern=r"^[A-Za-z0-9._-]{1,128}$")):
        if contains_credential(body.value):
            raise HTTPException(422, detail={"code": "credential_content", "message": "Keep passwords and authentication codes out of personal memory."})
        return store.put_fact(fact_id, body.model_dump(), utc_iso(clock()))

    @app.delete("/v1/facts/{fact_id}", dependencies=protected)
    def delete_fact(fact_id: str = Path(pattern=r"^[A-Za-z0-9._-]{1,128}$"),
                          revision: int = Query(ge=1, le=9007199254740991)):
        result = store.delete_fact(fact_id, revision, utc_iso(clock()))
        if result is None:
            raise HTTPException(404, detail="Unknown personal fact.")
        return result

    @app.post("/v1/learning/sync", dependencies=protected)
    def learning_sync(body: LearningSync):
        return store.sync_learning(body.device_id, body.sequence,
                                   body.state.model_dump(mode="json", exclude_none=True), utc_iso(clock()))

    @app.get("/v1/context", dependencies=protected)
    def context():
        return personal_context()

    @app.get("/v1/memories", dependencies=protected)
    def memories(q: str = Query(default="", max_length=500),
                       limit: int = Query(default=50, ge=1, le=200)):
        prune()
        return {"search_type": "literal_substring", "events": store.search_events(q, limit)}

    @app.get("/v1/suggestions", dependencies=protected)
    def suggestions(limit: int = Query(default=30, ge=1, le=100)):
        prune()
        return {"mode": "rules_review_only", "suggestions": review_candidates(
            store.recent_events(limit=500), limit)}

    @app.get("/v1/reminders", dependencies=protected)
    async def list_reminders():
        items, stamp, state, error = await reminders_snapshot()
        return {"reminders": items, "source": {"state": state, "synced_at": stamp,
                "stale": state != "live", "error": error}}

    @app.post("/v1/sync", dependencies=protected)
    async def sync():
        require_remy()
        items, stamp, state, error = await reminders_snapshot()
        if state != "live":
            raise HTTPException(502, detail={"code": error, "message": "Remy sync failed; cache retained."})
        return {"synced": len(items), "synced_at": stamp}

    @app.get("/v1/brief", dependencies=protected)
    async def brief():
        await asyncio.to_thread(prune)
        items, stamp, state, error = await reminders_snapshot()
        events = await asyncio.to_thread(store.recent_events,
            since_iso=utc_iso(clock() - timedelta(hours=24)), limit=200)
        output = build_brief(items, events, clock(),
            settings.timezone, reminders_synced_at=stamp, connection_state=state)
        output["reminder_source"]["error"] = error
        output["notification_scope"] = "selected captured previews from the last 24 hours"
        output["personal_context"] = await asyncio.to_thread(personal_context)
        return output

    @app.post("/v1/reminders", dependencies=protected)
    async def create_reminder(body: ReminderCreate, idempotency_key: str = Header()):
        key_value(idempotency_key)
        now = utc_iso(clock())
        rid = str(uuid5(NAMESPACE_URL, "remy-personal-agent:create:" + idempotency_key))
        payload = {"id": rid, "title": body.title, "notes": body.notes,
                   "dueDate": utc_iso(body.due_date) if body.due_date else now,
                   "status": "pending", "snoozeCount": 0, "createdAt": now,
                   "updatedAt": now, "isDeleted": False, "armed": body.armed,
                   "priority": body.priority}
        # Server timestamps and the inbox placeholder must remain identical on
        # replay, including after a restart.
        existing = await asyncio.to_thread(store.get_action, idempotency_key)
        if existing and (existing.get("request") or {}).get("kind") == "create":
            old = existing["request"]["payload"]
            payload["createdAt"], payload["updatedAt"] = old["createdAt"], old["updatedAt"]
            if body.due_date is None:
                payload["dueDate"] = old["dueDate"]
        return await perform(idempotency_key, {"kind": "create", "reminder_id": rid, "payload": payload})

    @app.post("/v1/reminders/{reminder_id}/complete", dependencies=protected)
    async def complete(reminder_id: str, idempotency_key: str = Header()):
        return await perform(idempotency_key, {"kind": "complete", "reminder_id": reminder_id, "payload": {}})

    @app.post("/v1/reminders/{reminder_id}/snooze", dependencies=protected)
    async def snooze(reminder_id: str, body: Snooze, idempotency_key: str = Header()):
        key_value(idempotency_key)
        if body.due_date <= clock() and (await asyncio.to_thread(store.get_action, idempotency_key)) is None:
            raise HTTPException(422, detail="Snooze time must be in the future.")
        return await perform(idempotency_key, {"kind": "snooze", "reminder_id": reminder_id,
                                               "payload": {"dueDate": utc_iso(body.due_date)}})

    @app.get("/v1/actions/{key}", dependencies=protected)
    def action_status(key: str):
        key_value(key)
        action = store.get_action(key)
        if action is None:
            raise HTTPException(404, detail="Unknown action key.")
        return {"action_key": key, **action}

    @app.post("/v1/actions/{key}/reconcile", dependencies=protected)
    async def reconcile(key: str):
        key_value(key)
        action = await asyncio.to_thread(store.get_action, key)
        if action is None:
            raise HTTPException(404, detail="Unknown action key.")
        if action["status"] == "done":
            return action_response(key, action["result"])
        client = require_remy()
        try:
            reminders = await client.list_reminders()
        except RemyError as exc:
            raise HTTPException(502, detail={"code": exc.code, "pending": True}) from None
        request = action["request"]
        match = next((r for r in reminders if r["id"] == request["reminder_id"] and not r.get("isDeleted")), None)
        matched = False
        if match:
            kind, payload = request["kind"], request["payload"]
            if kind == "complete":
                matched = match["status"] == "completed"
            elif kind == "snooze":
                matched = match["status"] == "snoozed" and _same_time(match["dueDate"], payload["dueDate"])
            elif kind == "create":
                matched = (match["title"] == payload["title"] and match.get("armed", True) == payload["armed"]
                           and _same_time(match["dueDate"], payload["dueDate"]))
        if not matched:
            raise HTTPException(409, detail={"code": "still_unresolved", "pending": True,
                "message": "No matching state in Remy. Verify there before using a new action key."})
        result = await asyncio.to_thread(store.finish_action_once, key, {"ok": True, "reminder": match})
        await asyncio.to_thread(store.replace_reminders, reminders, utc_iso(clock()))
        return action_response(key, {**result, "reconciled": True})

    return app


def _same_time(left: str, right: str) -> bool:
    try:
        return datetime.fromisoformat(left.replace("Z", "+00:00")) == datetime.fromisoformat(right.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False

