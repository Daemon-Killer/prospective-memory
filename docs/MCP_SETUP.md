# AI Brain Bridge (FastMCP + Claude / Grok / Gemini)

The Remy Reminders monorepo includes a bidirectional **FastMCP** server interface that connects your phone-first prospective memory ledger to frontier LLMs: Claude Desktop, Cursor IDE, Grok, and Gemini.

## Transports Supported

1. **Standard I/O (stdio)**: Best for Claude Desktop and Cursor running locally on your workstation.
2. **Server-Sent Events (SSE)**: Best for remote servers (Render, Railway, Docker), Cursor remote connections, and multi-client setups.

---

## 1. Quickstart: Claude Desktop Integration

### Configuration File Locations
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Configuration Snippet (`claude_desktop_config.json`)

#### Option A: Local stdio transport (Default)
```json
{
  "mcpServers": {
    "remy-prospective-memory": {
      "command": "uv",
      "args": [
        "--directory",
        "c:\\Users\\bda99\\Desktop\\prospective-memory",
        "run",
        "pmem",
        "serve-mcp"
      ],
      "env": {
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

#### Option B: HTTP / SSE transport (via FastAPI API)
When running the FastAPI server (`pmem serve` or cloud deployment):
```json
{
  "mcpServers": {
    "remy-remote-sse": {
      "url": "http://127.0.0.1:8000/mcp/sse"
    }
  }
}
```

---

## 2. Cursor IDE Integration

Place the configuration in `.cursor/mcp.json` at the root of the project:

```json
{
  "mcpServers": {
    "remy-prospective-memory": {
      "command": "uv",
      "args": [
        "--directory",
        "c:\\Users\\bda99\\Desktop\\prospective-memory",
        "run",
        "pmem",
        "serve-mcp"
      ]
    },
    "remy-remote-sse": {
      "url": "http://127.0.0.1:8000/mcp/sse"
    }
  }
}
```

---

## 3. FastMCP Tool Inventory

| Tool Name | Parameters | Description |
|---|---|---|
| `capture_task` | `text`, `source` | Rapidly save a thought or prospective task into the phone inbox. |
| `list_open_tasks` | `category`, `limit` | List active tasks with categorization and time triggers. |
| `search_tasks` | `query`, `include_done`, `limit` | Full-text search across open/completed tasks. |
| `complete_task` | `task_id` | Mark a task done. |
| `drop_task` | `task_id` | Drop a task without completing it. |
| `task_stats` | *(none)* | Aggregate status counts, category distributions, and JARVIS stats. |
| `list_reminders` | `status`, `limit` | Query the unified ledger (pending, snoozed, completed). |
| `create_reminder` | `title`, `due_date`, `armed`, `notes`, `cultural_metadata` | Create a scheduled or unarmed reminder with optional cultural metadata. |
| `snooze_reminder` | `reminder_id`, `target_iso`, `minutes` | Push reminder alert forward into the future. |
| `complete_reminder`| `reminder_id` | Mark reminder complete in the ledger. |
| `capture_cultural_item` | `title`, `media_type`, `platform`, `release_year`, `runtime`, `genres`, `notes`, `recommended_by` | Log a leisure/cultural recommendation (movie, show, doc, book). |
| `list_cultural_items` | `media_type`, `platform`, `status`, `limit` | Query leisure watchlist items filtered by streaming platform or type. |
| `latest_otp` | *(none)* | Live incoming OTP codes received by the Android companion app. |
| `last_whatsapp` | `sender`, `limit` | Recent WhatsApp notification previews from the notification shade. |
| `missed_summary` | `minutes` | Notification summary across WhatsApp, SMS, and mail. |

---

## 4. MCP Prompts & Resources

### Prompts
- **`weekend_watchlist_prompt(genre: str)`**: Directs the LLM to inspect queued movie and book recommendations and draft a tailored weekend plan.
- **`triage_inbox_prompt()`**: Guides the LLM to triage unarmed items and schedule overdue reminders.

### Resources
- `ledger://reminders`: Real-time JSON snapshot of active reminders.
- `ledger://watchlist`: Real-time JSON snapshot of cultural recommendations.
- `ledger://stats`: System health, ledger counts, and sync status.
