"""Private recovery links and revocable installation credentials.

Only hashes are persisted. A setup link is a bearer credential: keep it private.
Metadata transactions work identically in SQLite and the companion PG schema.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import re
import secrets

KEY_RE = re.compile(r'^rpl_[A-Za-z0-9_-]{43}$')
DEVICE_RE = re.compile(r'^rdv_[a-f0-9]{64}$')
PUBLIC_BASE = 'https://prospective-memory-api.onrender.com/agent'


class PairingError(Exception):
    pass


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec='microseconds')


class PairingStoreMixin:
    def create_pairing_link(self, master: str, now: datetime) -> dict:
        key = 'rpl_' + secrets.token_urlsafe(32)
        ident = digest(key)
        record = dict(id=ident, generation=digest(master), created_at=stamp(now),
                      expires_at=stamp(now + timedelta(days=365)), revoked=False)
        with self._connection(write=True) as connection:
            rows = connection.execute("SELECT key,value FROM metadata WHERE key LIKE ?", ('pair-link:%',)).fetchall()
            active = 0
            for row in rows:
                old = json.loads(row['value'])
                if old['revoked'] or old['expires_at'] <= stamp(now) or old['generation'] != digest(master):
                    connection.execute('DELETE FROM metadata WHERE key=?', (row['key'],))
                else:
                    active += 1
            if active >= 16:
                raise PairingError('link_capacity')
            connection.execute('INSERT INTO metadata(key,value) VALUES(?,?)', ('pair-link:' + ident, json.dumps(record)))
        return {'id': ident, 'setup_url': PUBLIC_BASE + '/connect#key=' + key, 'expires_at': record['expires_at']}

    def exchange_pairing_link(self, key: str, device_id: str, name: str, master: str, now: datetime) -> dict:
        if not KEY_RE.fullmatch(key):
            raise PairingError('invalid_setup_link')
        ident = digest(key)
        generation = digest(master)
        # Deterministic per link/install, so retrying a lost acknowledgement is safe.
        token = 'rdv_' + hmac.new(master.encode(), ('remy-device-v1:' + ident + ':' + device_id).encode(), hashlib.sha256).hexdigest()
        credential_key = 'pair-device:' + digest(token)
        with self._connection(write=True) as connection:
            row = connection.execute('SELECT value FROM metadata WHERE key=?', ('pair-link:' + ident,)).fetchone()
            link = json.loads(row['value']) if row else None
            if not link or link['revoked'] or link['generation'] != generation or link['expires_at'] <= stamp(now):
                raise PairingError('invalid_setup_link')
            rows = connection.execute('SELECT key,value FROM metadata WHERE key LIKE ?', ('pair-device:%',)).fetchall()
            active = 0
            existing = None
            for row in rows:
                device = json.loads(row['value'])
                if row['key'] == credential_key:
                    existing = device
                    if device['revoked']:
                        # Revocation cannot be undone by replaying an old link.
                        raise PairingError('device_revoked')
                elif device['device_id'] == device_id:
                    device['revoked'] = True
                    connection.execute('UPDATE metadata SET value=? WHERE key=?', (json.dumps(device), row['key']))
                elif not device['revoked'] and device['generation'] == generation:
                    active += 1
            if existing is None:
                if active >= 32:
                    raise PairingError('device_capacity')
                record = dict(id=digest(token), device_id=device_id, name=name,
                              generation=generation, created_at=stamp(now), revoked=False)
                connection.execute('INSERT INTO metadata(key,value) VALUES(?,?)', (credential_key, json.dumps(record)))
        return {'device_token': token, 'device_id': device_id}

    def authenticate_device(self, token: str, master: str) -> bool:
        if not DEVICE_RE.fullmatch(token):
            return False
        with self._connection() as connection:
            row = connection.execute('SELECT value FROM metadata WHERE key=?', ('pair-device:' + digest(token),)).fetchone()
        record = json.loads(row['value']) if row else None
        return bool(record and not record['revoked'] and hmac.compare_digest(record['generation'], digest(master)))

    def pairing_devices(self, master: str) -> list[dict]:
        with self._connection() as connection:
            rows = connection.execute('SELECT value FROM metadata WHERE key LIKE ?', ('pair-device:%',)).fetchall()
        return [{k: v for k, v in record.items() if k != 'generation'} for row in rows
                if (record := json.loads(row['value']))['generation'] == digest(master) and not record['revoked']]

    def pairing_links(self, master: str, now: datetime) -> list[dict]:
        with self._connection() as connection:
            rows = connection.execute('SELECT value FROM metadata WHERE key LIKE ?', ('pair-link:%',)).fetchall()
        return [{k: v for k, v in record.items() if k != 'generation'} for row in rows
                if (record := json.loads(row['value']))['generation'] == digest(master)
                and not record['revoked'] and record['expires_at'] > stamp(now)]

    def revoke_pairing(self, kind: str, ident: str) -> None:
        if kind not in ('link', 'device') or not re.fullmatch(r'[a-f0-9]{64}', ident):
            raise PairingError('invalid_pairing_id')
        with self._connection(write=True) as connection:
            row = connection.execute('SELECT value FROM metadata WHERE key=?', ('pair-' + kind + ':' + ident,)).fetchone()
            if row:
                record = json.loads(row['value'])
                record['revoked'] = True
                connection.execute('UPDATE metadata SET value=? WHERE key=?', (json.dumps(record), 'pair-' + kind + ':' + ident))
