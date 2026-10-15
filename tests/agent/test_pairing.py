from datetime import datetime, timedelta, timezone
import json
from urllib.parse import urlsplit, parse_qs
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from prospective_memory.agent.app import create_app
from prospective_memory.agent.config import Settings
from prospective_memory.agent.store import Store
from prospective_memory.agent.pairing import PairingError
from prospective_memory import agent_integration

MASTER = 'pairing-master-tests-' + 'x' * 40
NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)
AUTH = {'X-AGENT-TOKEN': MASTER}


def key_of(link):
    return parse_qs(urlsplit(link['setup_url']).fragment)['key'][0]


@pytest.fixture
def fixture(monkeypatch):
    store = Store(':memory:')
    child = create_app(Settings(agent_token=MASTER), store=store, clock=lambda: NOW)
    monkeypatch.setenv('AGENT_TOKEN', MASTER)
    monkeypatch.setattr(agent_integration, 'build_agent', lambda: child)
    parent = FastAPI()
    agent_integration.mount_agent(parent)
    with TestClient(parent) as client:
        yield store, client


def test_links_require_owner_and_hide_raw_key_from_storage(fixture):
    store, client = fixture
    assert client.post('/agent/v1/pairing/links').status_code == 401
    response = client.post('/agent/v1/pairing/links', headers=AUTH)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    key = key_of(response.json())
    with store._connection() as connection:
        stored = [dict(row) for row in connection.execute('SELECT * FROM metadata').fetchall()]
    assert key not in json.dumps(stored) and MASTER not in json.dumps(stored)


def test_exchange_pairing_persists_and_authenticates_without_master(fixture):
    store, client = fixture
    key = key_of(client.post('/agent/v1/pairing/links', headers=AUTH).json())
    payload = {'key': key, 'device_id': 'phone-1'}
    response = client.post('/agent/v1/pairing/exchange', json=payload)
    assert response.status_code == 200
    device = response.json()['device_token']
    assert device != MASTER and client.get('/agent/v1/context', headers={'X-AGENT-TOKEN': device}).status_code == 200
    assert client.post('/agent/v1/pairing/exchange', json=payload).json() == response.json()
    with store._connection() as connection:
        assert device not in json.dumps([dict(row) for row in connection.execute('SELECT * FROM metadata').fetchall()])


def test_a_saved_link_pairs_a_new_install_and_device_tokens_can_invite(fixture):
    store, client = fixture
    key = key_of(client.post('/agent/v1/pairing/links', headers=AUTH).json())
    first = client.post('/agent/v1/pairing/exchange', json={'key': key, 'device_id': 'install-1'}).json()['device_token']
    second = client.post('/agent/v1/pairing/exchange', json={'key': key, 'device_id': 'install-2'}).json()['device_token']
    assert first != second
    assert client.post('/agent/v1/pairing/links', headers={'X-AGENT-TOKEN': second}).status_code == 200


def test_invalid_setup_link_does_not_change_memory(fixture):
    store, client = fixture
    response = client.post('/agent/v1/pairing/exchange', json={'key': 'rpl_' + 'A' * 43, 'device_id': 'phone'})
    assert response.status_code == 403
    assert client.get('/agent/v1/context').status_code == 401
    assert store.pairing_devices(MASTER) == []


def test_expired_or_revoked_links_cannot_enroll(fixture):
    store, client = fixture
    link = store.create_pairing_link(MASTER, NOW - timedelta(days=366))
    assert client.post('/agent/v1/pairing/exchange', json={'key': key_of(link), 'device_id': 'phone'}).status_code == 403
    link = store.create_pairing_link(MASTER, NOW)
    assert client.delete('/agent/v1/pairing/link/' + link['id'], headers=AUTH).status_code == 200
    assert client.post('/agent/v1/pairing/exchange', json={'key': key_of(link), 'device_id': 'phone'}).status_code == 403


def test_device_revocation_cannot_be_undone_by_retry(fixture):
    store, client = fixture
    link = store.create_pairing_link(MASTER, NOW)
    payload = {'key': key_of(link), 'device_id': 'phone'}
    token = client.post('/agent/v1/pairing/exchange', json=payload).json()['device_token']
    info = client.get('/agent/v1/pairing/devices', headers=AUTH).json()['devices'][0]
    assert 'generation' not in info and token not in json.dumps(info)
    assert client.delete('/agent/v1/pairing/device/' + info['id'], headers=AUTH).status_code == 200
    assert client.get('/agent/v1/context', headers={'X-AGENT-TOKEN': token}).status_code == 401
    assert client.post('/agent/v1/pairing/exchange', json=payload).status_code == 403


def test_master_rotation_invalidates_old_device_and_link(fixture):
    store, _ = fixture
    link = store.create_pairing_link(MASTER, NOW)
    token = store.exchange_pairing_link(key_of(link), 'phone', 'Phone', MASTER, NOW)['device_token']
    assert not store.authenticate_device(token, MASTER + '-rotated')
    with pytest.raises(PairingError):
        store.exchange_pairing_link(key_of(link), 'new-phone', 'New', MASTER + '-rotated', NOW)


def test_new_link_replaces_old_credential_for_same_install(fixture):
    store, _ = fixture
    first = store.create_pairing_link(MASTER, NOW)
    second = store.create_pairing_link(MASTER, NOW)
    old = store.exchange_pairing_link(key_of(first), 'phone', 'Phone', MASTER, NOW)['device_token']
    new = store.exchange_pairing_link(key_of(second), 'phone', 'Phone', MASTER, NOW)['device_token']
    assert store.authenticate_device(new, MASTER) and not store.authenticate_device(old, MASTER)


def test_setup_page_is_public_but_never_contains_credentials(fixture):
    _, client = fixture
    response = client.get('/agent/connect')
    assert response.status_code == 200
    assert 'Open Remy &amp; connect' in response.text
    assert MASTER not in response.text
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert "frame-ancestors 'none'" in response.headers['content-security-policy']
    assert 'https://evil.example' not in response.text


def test_raw_exchange_body_is_bounded_and_errors_do_not_echo_secrets(fixture):
    _, client = fixture
    secret = 'not-a-valid-secret-' * 1000
    response = client.post('/agent/v1/pairing/exchange', content=json.dumps({'key': secret, 'device_id': 'phone'}), headers={'Content-Type': 'application/json'})
    assert response.status_code == 413 and secret not in response.text
    response = client.post('/agent/v1/pairing/exchange', json={'key': 'secret', 'device_id': 'phone'})
    assert response.status_code == 422 and 'secret' not in response.text


def test_fake_device_credential_cannot_read_or_invite(fixture):
    _, client = fixture
    headers = {'X-AGENT-TOKEN': 'rdv_' + 'a' * 64}
    assert client.get('/agent/v1/context', headers=headers).status_code == 401
    assert client.post('/agent/v1/pairing/links', headers=headers).status_code == 401
    assert client.get('/agent/health', headers=headers).status_code == 401


def test_pairing_survives_store_restart(tmp_path):
    database = str(tmp_path / 'persistent.sqlite3')
    store = Store(database)
    link = store.create_pairing_link(MASTER, NOW)
    token = store.exchange_pairing_link(key_of(link), 'phone', 'Phone', MASTER, NOW)['device_token']
    other = Store(database)
    assert other.authenticate_device(token, MASTER)
    assert other.exchange_pairing_link(key_of(link), 'phone', 'Phone', MASTER, NOW)['device_token'] == token
