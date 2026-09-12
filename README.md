# Prospective Memory

**Phone-first capture. MCP pull. Not Takeout.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)

Dump a thought in a few seconds on Android. Later ask Grok: *“what’s open?”*  
Phone JARVIS (v0.7): OTPs, WhatsApp previews, mail/SMS — pull from the laptop, home on the phone.

Sibling of [google-activity-assistant](https://github.com/Daemon-Killer/google-activity-assistant) — same *kind* of MCP host, **different store**.

---

## Loop

```text
Android capture  --POST /v1/capture-------->  FastAPI (Railway or PC)
Android JARVIS   --POST /v1/jarvis/events--/         │
  (OTP / WhatsApp / mail / SMS)                      │
Grok  --MCP list_open_tasks / latest_otp / last_whatsapp / missed_summary
```

The phone owns personal life (OTP, WhatsApp, mail). The laptop asks the phone's inbox. OTPs expire in 3 minutes and are not stored as tasks.

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
8. **Phone JARVIS:** tap **Turn on phone JARVIS** → enable **Capture JARVIS** in notification access. If the toggle is greyed out (sideload), App info → three dots → **Allow restricted settings**, then try again. A heads-up with **Copy** appears when an OTP is seen.

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

Ask: *“list open tasks”* / *“anything grocery?”* / *“what’s the OTP?”* / *“last WhatsApp from Mom”* / *“what did I miss?”*

---

## CLI

```powershell
uv run pmem capture "dahi lena"
uv run pmem list
uv run pmem stats
uv run pmem otp
uv run pmem whatsapp
uv run pmem missed
```

---

## Non-goals

- Unofficial WhatsApp protocol / full chat history (notification previews only)
- UPI send, unsupervised mail send
- OS reminders, geofence
- Merging with Google Takeout activity
- Multi-user cloud
