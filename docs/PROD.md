# Production backend (Railway)

Public inbox so the phone works off home Wi‑Fi.

| | |
|---|---|
| Health | https://prospective-memory-production.up.railway.app/health |
| Capture | `POST /v1/capture` header `X-PMEM-TOKEN` |
| JARVIS events | `POST /v1/jarvis/events` |
| Live OTP | `GET /v1/jarvis/otp` (expires ~3 min) |
| WhatsApp | `GET /v1/jarvis/whatsapp` |
| Missed | `GET /v1/jarvis/missed?minutes=60` |
| Dashboard | https://railway.com/project/5eb5f4f8-0c48-40a8-aefa-dac09354e511 |

## Phone

In Capture settings:

- **URL:** `https://prospective-memory-production.up.railway.app`
- **Token:** the `PMEM_TOKEN` Railway variable (same as MCP)

HTTPS — no LAN IP.

## MCP (Grok)

`~/.grok/config.toml` env:

```toml
env = { PMEM_API_URL = "https://prospective-memory-production.up.railway.app", PMEM_TOKEN = "<same token>" }
```

Restart Grok so list/capture hit Railway, not local SQLite.

## Deploy again

```powershell
cd $env:USERPROFILE\Desktop\prospective-memory
railway up -y --detach -m "describe change"
```
