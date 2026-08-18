# Prospective Memory

**Phone-first capture. MCP pull. Not Takeout.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)

Dump a thought in a few seconds on Android. Later ask Grok/Claude: *“what’s open?”*  
No notifications in v1. No geofence. No Google history.

Sibling of [google-activity-assistant](https://github.com/Daemon-Killer/google-activity-assistant) — same *kind* of MCP host, **different store**.

---

## v1 loop

```text
Android (one box)  --POST /v1/capture-->  PC FastAPI + SQLite
                                              │
Grok / Claude  --MCP list_open_tasks----------┘
```

---

## Server (Windows)

```powershell
cd $env:USERPROFILE\Desktop\prospective-memory
uv sync
uv run pmem token          # print X-PMEM-TOKEN for the phone
uv run pmem serve          # http://0.0.0.0:8790
```

Leave `serve` running. In another terminal / Grok, MCP `serve-mcp` is already wired if you add the config below.

Phone must reach this machine:

- **Same Wi‑Fi:** `http://YOUR_LAN_IP:8790`
- **Out of house:** Cloudflare Tunnel / Tailscale (see `docs/V1.md`)

---

## Android

1. Open `android/` in Android Studio (or `gradlew.bat assembleDebug`).
2. Set **server URL** + **token** on first launch (same token as `pmem token`).
3. Save **URL + token**. Add lingo lines (`d=dahi lena`).
4. **Enable floating + tile** (overlay permission) — tap `+` → type → Enter. Drag the `+` onto the bottom **✕** to hide it; Enable turns it back on.
5. Home screen **widget** (stretch wide for a type-here bar) or long-press app icon → **Capture**. Keyboard opens immediately.
6. Empty Enter repeats the last lingo chip. Toast shows `category · text`. Offline posts queue and flush when the network is back.
7. Optional **Write** (handwriting test) is in `android/.../ink/`. First open downloads an on-device model. Not on the bubble. Drop it via `ink/REMOVE.txt`.

Allow HTTP cleartext for LAN IPs (already in network security config).

---

## MCP (Grok)

`~/.grok/config.toml`:

```toml
[mcp_servers.prospective_memory]
command = "C:\\Users\\bda99\\.local\\bin\\uv.exe"
args = [
  "run",
  "--directory",
  "C:\\Users\\bda99\\Desktop\\prospective-memory",
  "pmem",
  "serve-mcp",
]
enabled = true
startup_timeout_sec = 60
```

Ask: *“list open tasks”* / *“anything grocery?”* / *“mark that dahi task done.”*

---

## CLI

```powershell
uv run pmem capture "dahi lena"
uv run pmem list
uv run pmem stats
```

---

## Non-goals (v1)

- OS reminders, geofence, WhatsApp check-in, glyphs, voice  
- Merging with Google Takeout activity  
- Multi-user cloud
