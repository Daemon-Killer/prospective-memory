from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from prospective_memory import agent_integration as integration
from prospective_memory.agent.config import Settings
from prospective_memory.agent.app import create_app
from prospective_memory.agent.store import Store
from prospective_memory.agent.remy_client import RemyError

TOKEN = 'integration-test-token-' + 'a' * 40


def test_mount_auth_and_recovery(monkeypatch):
    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    calls = []
    def build():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError('private database DSN must never be returned')
        return create_app(Settings(agent_token=TOKEN), store=Store(':memory:'))
    monkeypatch.setattr(integration, 'build_agent', build)
    app = FastAPI()
    integration.mount_agent(app)
    @app.get('/existing')
    def existing():
        return {'ok': True}
    with TestClient(app) as client:
        assert client.get('/existing').status_code == 200
        assert client.get('/agent/v1/context').status_code == 401
        assert calls == []
        headers = {'X-AGENT-TOKEN': TOKEN}
        failed = client.get('/agent/v1/context', headers=headers)
        assert failed.status_code == 503
        assert 'private' not in failed.text
        assert client.get('/existing').status_code == 200
        assert client.get('/agent/v1/context', headers=headers).json()['facts'] == []
        payload = {'base_revision': 0, 'kind': 'goal', 'value': 'Learn systems deeply', 'source_device_id': 'mount-test'}
        assert client.put('/agent/v1/facts/goal-one', headers=headers, json=payload).status_code == 200
        assert client.get('/agent/v1/context', headers=headers).json()['facts'][0]['value'] == payload['value']


def test_mount_without_token_fails_closed(monkeypatch):
    monkeypatch.delenv('AGENT_TOKEN', raising=False)
    app = FastAPI()
    integration.mount_agent(app)
    with TestClient(app) as client:
        assert client.get('/agent/health').status_code == 503


def test_hosted_memory_requires_persistent_database(monkeypatch):
    import pytest
    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    monkeypatch.setattr(integration, 'settings', type('Config', (), {
        'resolved_database_url': lambda self: '', 'is_hosted': lambda self: True})())
    with pytest.raises(RuntimeError, match='requires PostgreSQL'):
        integration.build_agent()


def test_reminder_adapter_sanitizes_and_marks_uncertain_writes(monkeypatch):
    import asyncio
    import pytest
    def broken(*args, **kwargs):
        raise RuntimeError('private connection details')
    monkeypatch.setattr(integration.db, 'complete_reminder_db', broken)
    with pytest.raises(RemyError) as error:
        asyncio.run(integration.LocalRemyClient().complete_reminder('example'))
    assert error.value.ambiguous
    assert 'private' not in str(error.value)


def test_reminder_adapter_reads_authoritative_store(monkeypatch):
    import asyncio
    from prospective_memory.models import ReminderOut
    now = '2026-10-11T12:00:00Z'
    item = ReminderOut(id='source-reminder', title='Review closures', dueDate=now,
        status='pending', snoozeCount=0, createdAt=now, updatedAt=now)
    seen = []
    def reminders(**kwargs):
        seen.append(kwargs)
        return [item]
    monkeypatch.setattr(integration.db, 'list_reminders', reminders)
    result = asyncio.run(integration.LocalRemyClient().list_reminders())
    assert result[0]['id'] == item.id
    assert seen == [{'include_deleted': True}]


def test_initialized_mount_sanitizes_runtime_storage_failure_and_recovers(monkeypatch):
    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    store = Store(':memory:')
    normal = store.get_personal_context
    broken = [True]

    def context():
        if broken[0]:
            raise RuntimeError('private-db-password-sentinel')
        return normal()

    monkeypatch.setattr(store, 'get_personal_context', context)
    monkeypatch.setattr(integration, 'build_agent', lambda: create_app(Settings(agent_token=TOKEN), store=store))
    parent = FastAPI()
    integration.mount_agent(parent)
    with TestClient(parent) as client:
        response = client.get('/agent/v1/context', headers={'X-AGENT-TOKEN': TOKEN})
        assert response.status_code == 503
        assert response.json() == {'detail': {'code': 'agent_storage_unavailable'}}
        assert 'sentinel' not in response.text
        broken[0] = False
        assert client.get('/agent/v1/context', headers={'X-AGENT-TOKEN': TOKEN}).status_code == 200


@pytest.mark.parametrize('path', ['/agent/v1/context', '/agent/v1/brief'])
def test_agent_storage_wait_does_not_block_existing_remy_requests(monkeypatch, path):
    import asyncio
    import threading
    import httpx

    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    entered, release = threading.Event(), threading.Event()
    store = Store(':memory:')
    normal = store.get_personal_context

    def slow_context():
        entered.set()
        release.wait(3)
        return normal()

    monkeypatch.setattr(store, 'get_personal_context', slow_context)
    monkeypatch.setattr(integration, 'build_agent', lambda: create_app(Settings(agent_token=TOKEN), store=store))
    parent = FastAPI()
    integration.mount_agent(parent)

    @parent.get('/existing')
    async def existing():
        return {'ok': True}

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=parent), base_url='http://test') as client:
            request = asyncio.create_task(client.get(path, headers={'X-AGENT-TOKEN': TOKEN}))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                response = await client.get('/existing')
                assert response.status_code == 200
                assert not request.done(), 'Synchronous storage blocked the shared ASGI event loop.'
            finally:
                release.set()
                assert (await request).status_code == 200

    asyncio.run(exercise())


def test_partial_response_failure_never_sends_duplicate_headers(monkeypatch):
    from starlette.responses import StreamingResponse

    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    child = FastAPI()

    @child.get('/partial')
    async def partial():
        async def body():
            yield b'first chunk'
            raise RuntimeError('private-stream-sentinel')
        return StreamingResponse(body())

    monkeypatch.setattr(integration, 'build_agent', lambda: child)
    parent = FastAPI()
    integration.mount_agent(parent)
    with TestClient(parent) as client:
        response = client.get('/agent/partial', headers={'X-AGENT-TOKEN': TOKEN})
        assert response.status_code == 200
        assert response.text == 'first chunk'


def test_parent_shutdown_closes_agent_storage(monkeypatch):
    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    closed = []
    store = Store(':memory:')
    store.close = lambda: closed.append(True)
    child = create_app(Settings(agent_token=TOKEN), store=store)
    child.state.agent_store = store
    monkeypatch.setattr(integration, 'build_agent', lambda: child)
    parent = FastAPI()
    integration.mount_agent(parent)
    with TestClient(parent) as client:
        assert client.get('/agent/health', headers={'X-AGENT-TOKEN': TOKEN}).status_code == 200
        assert closed == []
    assert closed == [True]


def test_agent_health_checks_live_storage_without_error_details(monkeypatch):
    monkeypatch.setenv('AGENT_TOKEN', TOKEN)
    store = Store(':memory:')
    healthy = [False]

    def ping():
        if not healthy[0]:
            raise RuntimeError('private-health-sentinel')
        return True

    store.ping = ping
    monkeypatch.setattr(integration, 'build_agent', lambda: create_app(Settings(agent_token=TOKEN), store=store))
    parent = FastAPI()
    integration.mount_agent(parent)
    with TestClient(parent) as client:
        failed = client.get('/agent/health', headers={'X-AGENT-TOKEN': TOKEN})
        assert failed.status_code == 503 and 'sentinel' not in failed.text
        healthy[0] = True
        assert client.get('/agent/health', headers={'X-AGENT-TOKEN': TOKEN}).json()['ok']
