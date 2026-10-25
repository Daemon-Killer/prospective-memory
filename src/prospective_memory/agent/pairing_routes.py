from fastapi import HTTPException, Path
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import Field
import secrets

from .models import StrictModel
from .pairing import PairingError


class Exchange(StrictModel):
    key: str = Field(min_length=47, max_length=47, pattern=r'^rpl_[A-Za-z0-9_-]{43}$')
    device_id: str = Field(min_length=1, max_length=128, pattern=r'^[A-Za-z0-9._-]+$')
    name: str = Field(default='Android phone', min_length=1, max_length=64)


def add_pairing_routes(app, store, master, protected, clock):
    def operation(callback, *args):
        try:
            return callback(*args)
        except PairingError as error:
            code = str(error)
            raise HTTPException(403 if code in ('invalid_setup_link', 'device_revoked') else 409,
                                detail={'code': code}) from None

    @app.post('/v1/pairing/links', dependencies=protected)
    def create_link():
        return JSONResponse(operation(store.create_pairing_link, master, clock()), headers={'Cache-Control': 'no-store'})

    @app.get('/v1/pairing/links', dependencies=protected)
    def links():
        return {'links': store.pairing_links(master, clock())}

    @app.post('/v1/pairing/exchange')
    def exchange(body: Exchange):
        return JSONResponse(operation(store.exchange_pairing_link, body.key, body.device_id, body.name, master, clock()), headers={'Cache-Control': 'no-store'})

    @app.get('/v1/pairing/devices', dependencies=protected)
    def devices():
        return {'devices': store.pairing_devices(master)}

    @app.delete('/v1/pairing/{kind}/{ident}', dependencies=protected)
    def revoke(kind: str, ident: str = Path(pattern=r'^[a-f0-9]{64}$')):
        operation(store.revoke_pairing, kind, ident)
        return {'ok': True}

    @app.get('/connect')
    def landing():
        nonce = secrets.token_urlsafe(18)
        page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Remy</title>
<style nonce="NONCE">body{font:17px system-ui;background:#101215;color:#eef2f6;margin:0;padding:36px 22px}main{max-width:480px;margin:10vh auto}h1{font-size:32px}p{line-height:1.6;color:#b8c3cf}a{display:block;padding:16px;border-radius:12px;text-align:center;margin-top:20px;background:#acd5c5;color:#101215;font-weight:700;text-decoration:none}.secondary{background:#252b33;color:#eef2f6}#open[hidden]{display:none}</style>
<main><p>REMY CLOUD</p><h1>Your assistant, connected.</h1><p id="status">Open this private link on your Android phone. Remy will ask you to confirm the connection, then remember it securely.</p><a id="open" hidden>Open Remy &amp; connect</a><a class="secondary" href="https://drive.google.com/file/d/17XvYljBwXW31q7T_c2T0Jmr7zrNs4YTt/view">Install or update Remy</a><p>Save this private link on your phone for future installs. Anyone with the link can connect to your assistant. You can revoke it from a connected Remy app.</p></main>
<script nonce="NONCE">const key=new URLSearchParams(location.hash.slice(1)).get('key');if(/^rpl_[A-Za-z0-9_-]{43}$/.test(key||'')){const a=document.getElementById('open');a.href='intent://pair?key='+encodeURIComponent(key)+'#Intent;scheme=remy;package=com.remy.reminders;end';a.hidden=false}else{document.getElementById('status').textContent='This setup link is incomplete. Open your original private setup link again.'}</script></html>'''.replace('NONCE', nonce)
        return HTMLResponse(page, headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            'X-Content-Type-Options': 'nosniff'})
