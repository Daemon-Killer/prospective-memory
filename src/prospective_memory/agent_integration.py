"""Mount the personal assistant beside Remy's authoritative reminder API."""
from __future__ import annotations

import asyncio
import os
import threading

from fastapi import FastAPI
from starlette.responses import JSONResponse

from .agent.app import create_app
from .agent.config import Settings as AgentSettings
from .agent.remy_client import RemyError, _validate_reminder
from .agent.store import Store
from .config import settings
from . import db
from .models import ReminderIn


class LocalRemyClient:
    """Reuse the same database operations; never copy the phone's API secret."""

    async def close(self):
        pass

    async def _call(self, operation, *args, write=False, **kwargs):
        try:
            result = await asyncio.to_thread(operation, *args, **kwargs)
        except Exception:
            raise RemyError('storage_unavailable', retryable=not write, ambiguous=write) from None
        if result is None:
            raise RemyError('http_404')
        return result

    async def list_reminders(self):
        items = await self._call(db.list_reminders, include_deleted=True)
        return [_validate_reminder(item.model_dump(mode='json')) for item in items]

    async def create_reminder(self, payload):
        try:
            reminder = ReminderIn(**payload)
        except Exception:
            raise RemyError('invalid_request') from None
        item = await self._call(db.upsert_reminder, reminder, write=True)
        return _validate_reminder(item.model_dump(mode='json'), write=True)

    async def complete_reminder(self, reminder_id):
        item = await self._call(db.complete_reminder_db, reminder_id, write=True)
        return _validate_reminder(item.model_dump(mode='json'), write=True)

    async def snooze_reminder(self, reminder_id, due_date):
        item = await self._call(db.snooze_reminder_db, reminder_id, due_date, write=True)
        return _validate_reminder(item.model_dump(mode='json'), write=True)


def build_agent():
    config = AgentSettings.from_env()
    database_url = settings.resolved_database_url()
    if database_url:
        from .agent.postgres_store import PostgresStore
        store = PostgresStore(database_url)
    elif settings.is_hosted():
        # A free Render filesystem is ephemeral. Never silently lose shared memory.
        raise RuntimeError('Hosted shared memory requires PostgreSQL.')
    else:
        store = Store(str(settings.data_dir / 'agent.sqlite3'))
    try:
        app = create_app(config, store=store, remy_client=LocalRemyClient())
    except Exception:
        close = getattr(store, 'close', None)
        if close:
            close()
        raise
    app.state.agent_store = store
    return app


class AgentMount:
    """Lazy initialization keeps a DB outage from disabling Remy's existing API.

    Retry on later requests after an unavailable initialization; the parent
    ASGI mount does not run a child FastAPI lifespan.
    """

    def __init__(self):
        self.app = None
        self.lock = threading.Lock()

    def _initialize(self):
        with self.lock:
            if self.app is None:
                child = build_agent()

                async def unavailable(_request, _error):
                    return JSONResponse({'detail': {'code': 'agent_storage_unavailable'}}, status_code=503)

                # FastAPI's outer error middleware still re-raises after sending
                # this response; __call__ below consumes that sanitized failure.
                child.add_exception_handler(Exception, unavailable)
                self.app = child
        return self.app

    async def close(self):
        def shutdown():
            with self.lock:
                if self.app is not None:
                    store = getattr(self.app.state, 'agent_store', None)
                    close = getattr(store, 'close', None)
                    if close:
                        close()
                    self.app = None
        await asyncio.to_thread(shutdown)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return
        # Reject unauthenticated requests before opening any DB connections.
        import secrets
        token = os.environ.get('AGENT_TOKEN', '')
        provided = dict(scope.get('headers', [])).get(b'x-agent-token', b'')
        if not token:
            response = JSONResponse({'detail': {'code': 'agent_unconfigured'}}, status_code=503)
        elif not secrets.compare_digest(provided, token.encode('utf-8')):
            response = JSONResponse({'detail': 'Missing or invalid agent token.'}, status_code=401)
        else:
            try:
                app = self.app or await asyncio.to_thread(self._initialize)
            except Exception:
                response = JSONResponse({'detail': {'code': 'agent_storage_unavailable'}}, status_code=503)
            else:
                started = False
                finished = False

                async def tracked_send(message):
                    nonlocal started, finished
                    if message['type'] == 'http.response.start':
                        started = True
                    elif message['type'] == 'http.response.body' and not message.get('more_body', False):
                        finished = True
                    await send(message)

                try:
                    await app(scope, receive, tracked_send)
                except Exception:
                    # Unexpected database/driver details never escape to ASGI
                    # logs. Never send a second response after headers were sent.
                    if not started:
                        await JSONResponse({'detail': {'code': 'agent_storage_unavailable'}}, status_code=503)(scope, receive, send)
                    elif not finished:
                        await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
                return
        await response(scope, receive, send)


def mount_agent(app: FastAPI):
    mount = AgentMount()
    app.mount('/agent', mount)
    app.router.add_event_handler('shutdown', mount.close)
