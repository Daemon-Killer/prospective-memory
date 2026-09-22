# Agent Directives for Prospective Memory (Remy)

## Automated Deployment & Release Policy
Whenever you make changes, bug fixes, or new features in `reminder app`:
1. Always run `npm run typecheck` in `reminder app` to verify TypeScript integrity.
2. Automatically trigger the release deployment pipeline without waiting for the user to ask:
   - Command: `npm run ship:drive` (or `powershell -ExecutionPolicy Bypass -File scripts/ship.ps1`)
   - This automatically compiles `gradlew assembleRelease`, updates `Remy-Reminders.apk`, and uploads the release build directly to Google Drive (`17XvYljBwXW31q7T_c2T0Jmr7zrNs4YTt`).
3. Report the updated Google Drive download link in your final response to the user.
