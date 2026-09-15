# Original User Request

## 2026-09-10T13:30:45Z

Build an open-source, offline-first mobile reminder application inspired by Remy Reminders using React Native (Expo), featuring zero-friction notification snoozing/rescheduling directly from the notification shade, local persistent storage, and a minimalist Swiss/editorial design aesthetic.

Working directory: c:\Users\bda99\Desktop\prospective-memory\reminder app
Integrity mode: development

## Requirements

### R1. Offline-First Task Management Engine
The system must provide local storage for reminders with zero-latency reads and writes. Reminders must support titles, notes, due dates/times, snooze counters, last snoozed timestamp, and status (pending, completed, snoozed).

### R2. Actionable Notification & Notification Shade Snooze
The application must schedule local notifications with actionable categories that allow users to complete or snooze reminders directly from the system notification shade (+15m, +1h, tomorrow morning, or custom interval) without opening the app to the foreground.

### R3. Swiss Minimalist & Editorial User Interface
The UI must deliver a clean, typography-focused editorial design inspired by Swiss styling (high contrast, distinct typography, clean grid layout) with light, dark, and void/high-contrast visual themes.

### R4. Quick-Capture & Granular Rescheduling
Provide zero-friction task entry (quick capture bar) and in-app granular rescheduling controls (snooze sheets/modals) for rapid reminder management.

### R5. Open-Source Readiness & Developer Ergonomics
Include clear open-source documentation (README.md with architecture, local setup instructions for Android/Web, and MIT license) and clean TypeScript type definitions throughout.

## Acceptance Criteria

### Task & Storage Integrity
- [ ] Reminders persist across app reloads in local offline storage without network dependencies.
- [ ] Full CRUD operations (create, update, snooze, mark complete, and delete) execute reliably without schema errors.

### Notification & Action Handling
- [ ] Notification categories are registered with actionable buttons (Complete, +15m, +1h, Tomorrow).
- [ ] Triggering an action button correctly updates the reminder's scheduled time and registers the subsequent alert.

### Code Quality & Build Verification
- [ ] The project builds and passes TypeScript type-checking with zero errors (npx tsc --noEmit).
- [ ] Core business logic (snooze time calculation, status transitions) has automated unit tests passing 100%.
- [ ] The app can be started locally via Expo (npx expo start) for preview.

## 2026-09-11T03:15:41Z

Build an open-source, offline-first native Wear OS companion application and system surfaces for Remy Reminders (optimized for Samsung Galaxy Watch 7 / Wear OS 5), featuring a sub-1% OPR Swiss Void Watch Face, an interactive ProtoLayout 1.2 Swipe Tile, an independent local Room database with Bluetooth P2P sync, and anti-habituation somatosensory haptic cueing.

Working directory: c:\Users\bda99\Desktop\prospective-memory\reminder app\wear
Integrity mode: development

## Requirements

### R1. Native Wear OS System Surfaces (Tile & Complications)
Build an interactive ProtoLayout 1.2 Swipe Tile that provides a 1-swipe glance at pending reminders with instant action buttons (+15m, +1h, Complete), alongside a Complication Data Provider (SHORT_TEXT and RANGED_VALUE) that provides dynamic countdowns and overdue state to native watch faces.

### R2. Declarative Swiss Void Watch Face Format (WFF)
Author a native Watch Face Format XML watch face adhering to the Swiss Void aesthetic: true #000000 AMOLED canvas, ambient On-Pixel Ratio under 1%, tabular numerals for precise clock alignment, and #FF4500 International Orange accent for urgent cues.

### R3. Standalone Offline Engine & Bluetooth P2P Sync
Implement a standalone local Room database on the watch running the strict T_base = max(T_now, T_due) snooze engine so the watch functions 100% autonomously without a phone, syncing bidirectionally via Android’s Wearable.DataClient and MessageClient when connected.

### R4. Polymorphic Anti-Habituation Haptics & Rotary Dialing
Implement multi-frequency LRA vibration waveforms (frequency hopping between Meissner and Pacinian bands with stochastic temporal jitter) to prevent sensory adaptation, integrated with capacitive digital rotary bezel detent scrolling to adjust snooze intervals eyes-free.

### R5. Open-Source Documentation & Verification Battery
Provide clear architectural documentation for the Wear OS module, unit tests covering snooze math, Room persistence, and data serialization, and verify clean Kotlin/Gradle compilation.

## Acceptance Criteria

### System Surfaces
- [ ] ProtoLayout 1.2 Tile compiles and renders active tasks with functioning inline snooze and complete buttons.
- [ ] Complication Data Provider emits valid ShortTextComplicationData with formatted time and countdown values.
- [ ] Watch Face Format XML validates cleanly against Wear OS 5 WFF specifications with measured ambient OPR < 1.0%.

### Engine & Sync Sovereignty
- [ ] Local Room database persists reminders on the watch independently of phone connectivity.
- [ ] Watch snooze calculations strictly conform to T_base = max(T_now, T_due) and sync state bidirectionally with the phone app.

### Code Quality & Build Verification
- [ ] The Wear OS module builds cleanly with Kotlin/Gradle without compilation errors.
- [ ] Automated unit tests for snooze math, database operations, and sync message handlers pass 100%.

## 2026-09-11T13:30:35Z

Complete the remaining architectural work items for the Remy Reminders Wear OS 5 companion: implement the Wear OS launcher Activity (MainActivity.kt) so complication taps and app launches resolve cleanly, and implement the watch-side outbound synchronization manager (RemySyncManager.kt) to broadcast pending Room mutations back to the phone.

Working directory: c:\Users\bda99\Desktop\prospective-memory\reminder app\wear
Integrity mode: development

## Requirements

### R1. Swiss Void Wear OS Launcher Activity (MainActivity.kt)
Implement a lightweight, standalone Wear OS launcher activity in com.remy.wear.MainActivity with true #000000 AMOLED theme:
- Displays active pending and snoozed reminders reactively from Room (ReminderDao.observeActiveReminders()).
- Provides 1-tap quick actions (snooze +15m, complete) for each item.
- Registered in AndroidManifest.xml with MAIN and LAUNCHER intent filters.
- Serves as the verified target for RemyComplicationService.createTapAction to eliminate ActivityNotFoundException.

### R2. Watch-Side Outbound Sync Dispatcher (RemySyncManager.kt)
Implement the outbound synchronization pipeline bridging the local Room SQLite database and Play Services Wearable API:
- Queries ReminderDao.getPendingUploads() whenever local mutations occur (from Tile, Notification, or MainActivity).
- Serializes pending records into SyncContracts.ReminderBatchPayload and broadcasts via Wearable.getDataClient(context).putDataItem() and Wearable.getMessageClient(context).sendMessage().
- On successful delivery or receipt acknowledgment, calls ReminderDao.markSynced(id, updatedAt) to transition items from PENDING_UPLOAD to SYNCED.
- Triggers push-driven updates to complication slots and ProtoLayout tiles upon sync completion.

### R3. Automated Test Battery & APK Assembly
- Unit test suite for RemySyncManager: verifies pending upload polling, serialization into wire payload, dispatch handling, and atomic markSynced transition.
- Full verification: gradlew.bat test passes 100% with zero regressions.
- Binary packaging: gradlew.bat assembleDebug succeeds cleanly.

## Acceptance Criteria

### Launcher Activity & Complication Binding
- [ ] com.remy.wear.MainActivity is declared in AndroidManifest.xml with ACTION_MAIN and CATEGORY_LAUNCHER.
- [ ] Tapping complications on the watch face launches MainActivity without ActivityNotFoundException.
- [ ] MainActivity renders active reminders reactively from Room DB with empty state fallback.

### Outbound Sync Lifecycle
- [ ] Snoozing or completing a reminder marks syncStatus = 'PENDING_UPLOAD'.
- [ ] RemySyncManager extracts pending uploads and constructs valid SyncContracts.ReminderBatchPayload.
- [ ] Successful sync marks records syncStatus = 'SYNCED'.

### Code Quality & Build Verification
- [ ] Automated tests for outbound sync pass 100% (gradlew.bat test).
- [ ] The entire Wear OS companion APK compiles cleanly (gradlew.bat assembleDebug).

## 2026-09-14T14:44:30Z

Build the Remy Android Notification Sensory Engine: a low-latency, privacy-preserving notification listener with on-device intent classification that parses incoming system alerts into actionable prospective memory to-dos and a dedicated Deals & Voucher Radar, managed via a calm review queue.

Working directory: c:\Users\bda99\Desktop\prospective-memory\reminder app
Integrity mode: development

## Requirements

### R1. Native Android Notification Listener & App Whitelisting
Implement a background Android notification listener service that captures incoming system status-bar notifications. Provide an on-device configurable whitelist/blacklist to control which apps are monitored, strictly quarantining or redacting sensitive authentication codes (OTPs, passwords) so they are never leaked or stored as general reminders.

### R2. Dual-Stream On-Device Intent Classifier
Implement an on-device rule and pattern classification engine (operating in <30ms with zero required cloud calls) that classifies incoming notifications into three discrete streams:
1. **Actionable To-Do**: Extracts action verbs, commitment context, inferred deadlines, and delivery milestones (e.g., courier out for delivery, utility bill due dates, flight check-in).
2. **Deal / Voucher Radar**: Identifies promotional offers, extracting merchant name, promo code (e.g., `SAVE50`, `SWIGGYIT`), discount value, and expiration date.
3. **Noise**: Silently discards conversational chatter, social reactions, and non-actionable status messages.

### R3. Suggested Review Queue (Sensory Inbox)
Implement a non-intrusive "Incoming Suggestions" shelf in the Remy user interface adhering to Swiss Void design:
- Candidate to-dos wait in this queue without polluting the active prospective agenda.
- 1-tap **[Accept]** promotes the candidate into the active reminder ledger with its parsed time cue and tags.
- 1-tap **[Dismiss]** permanently purges the suggestion.

### R4. Dedicated Deals & Voucher Radar View
Implement a dedicated Deals & Vouchers view/tab in the application:
- Lists active, non-expired merchant discount vouchers.
- Features 1-tap copy of the promo code to clipboard with visual feedback.
- Automatically flags or purges expired vouchers based on parsed expiry dates.

## Acceptance Criteria

### Classification & Parsing Suite
- [ ] Automated test suite verifies at least 15 diverse notification test cases spanning food delivery, e-commerce, banking bills, transport, promo coupons, and chat messages with correct 3-way classification (Actionable vs Deal vs Noise).
- [ ] Promo code extractor reliably captures alphanumeric voucher codes and discount terms across standard notification phrasing.
- [ ] Financial OTPs and security verification patterns are quarantined and excluded from task suggestions.

### Review Queue & State Transitions
- [ ] Tapping [Accept] creates a valid reminder in `storageService` with correct title, inferred due date, and armed state.
- [ ] Tapping [Dismiss] removes the suggestion from storage and UI without creating orphaned records.
- [ ] Vouchers past their expiration date are hidden or marked expired in the Deals Radar.

### Integration & Monorepo Stability
- [ ] All existing 396 tests in `reminder app` continue to pass without regression.
- [ ] New components compile cleanly without TypeScript or React Native bundling errors.
