# Remy Reminders Desktop Companion

A lightweight, distraction-free desktop companion for **Remy Reminders (Prospective Memory)**.
Runs silently in the Windows system tray and summons an ultra-fast (<150ms) Swiss Void quick-capture HUD over any active window via global hotkey.

## Key Capabilities

1. **System-Wide Global Hotkey & Spotlight HUD**:
   - Shortcut: `Ctrl+Alt+R` on Windows (`Cmd+Shift+R` on macOS). If unavailable, Remy registers one fallback and shows the active shortcut in the tray and Agenda. `Ctrl+Shift+K` is no longer registered.
   - Floating, centered Swiss Void (`#000000`) quick-capture HUD over any active window (VS Code, browser, games, PDF).
   - Typing thoughts (`call accountant 5pm`, `dahi 15m`) and pressing Enter compiles the prospective memory card, commits it to local SQLite, and hides immediately.
   - Live compiler preview with preset chip badges (`[+15m]`, `[+1h]`, `[Tomorrow]`), music intent chips (`🎵 play spb songs hindi`), and lingo expansion.

2. **System Tray Persistence**:
   - Lives as a lightweight tray icon in the Windows taskbar notification area.
   - Starts silently on launch without popping up heavy windows.
   - Right-click tray menu:
     - `Open Agenda`
     - `Quick Capture` (shows the active shortcut)
     - `Sync Now`
     - `Quit Remy`
   - Clicking or double-clicking the tray icon toggles the Agenda window.
   - Closing the Agenda window minimizes to tray instead of quitting.

3. **Shared Ledger & FastMCP Local Sync**:
   - Reads and writes to local SQLite database (`data/tasks.db`) shared directly with Python backend, CLI, and FastMCP server.
   - Full schema compatibility (`reminders` and `tasks` tables).
   - Bidirectional cloud sync with `POST /v1/reminders/sync` (batching <= 500 items, Last-Write-Wins conflict resolution, exponential backoff ladder).

4. **Native Windows Notifications**:
   - Background scheduler checks due reminders every 10 seconds.
   - Interactive Windows toast notifications:
     - `[+15m Snooze]`: bumps reminder by 15 minutes, saves to SQLite, schedules sync.
     - `[Complete]`: marks reminder done, saves to SQLite, schedules sync.

5. **Swiss Void Aesthetic**:
   - OLED `#000000` dark theme, `#18181b` card surfaces, subtle borders, zero bloat.
   - Agenda window with filter tabs (Due & Pending, Snoozed, Completed, All) and quick action buttons.

## Commands

```bash
# Install dependencies
npm install

# Run tests (Vitest)
npm test

# Typecheck (TypeScript)
npm run typecheck

# Build application
npm run build

# Start desktop app
npm start
```
