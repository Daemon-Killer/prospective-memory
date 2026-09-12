# Remy Reminders — E2E Test Infrastructure Specification

**Document Version**: 1.0.0  
**Target Environment**: React Native (Expo) / Node.js E2E Test Harness  
**Scope**: End-to-End, Opaque-Box Domain Verification for Remy Reminders Mobile Application  
**Author**: test_writer_e2e (Specialist, QA)  

---

## 1. Executive Summary & Philosophy

Remy Reminders is an offline-first mobile reminder application built with React Native (Expo), featuring zero-friction notification shade interaction, local persistent storage with an in-memory hydrated cache for zero-latency operations, deterministic state machine transitions, and high-precision snooze calculation math based on $T_{base} = \max(T_{now}, T_{due})$.

To guarantee system integrity, prevent regressions, and verify behavior without coupling to internal private state, this E2E test infrastructure establishes an **opaque-box testing harness** executing against public domain interfaces (`IReminderRepository`, `INotificationService`, `snoozeCalculator`, and notification action handlers).

Testing follows a **4-Tier Testing Methodology**:
- **Tier 1: Feature Coverage** ($\ge 5$ tests per feature across 5 core features = 25 tests)
- **Tier 2: Boundary & Corner Cases** ($\ge 5$ tests per boundary category across 5 categories = 25 tests)
- **Tier 3: Cross-Feature Interactions** (12 pairwise feature combinations)
- **Tier 4: Real-World Workload Scenarios** (5 end-to-end user journeys)

**Total Test Count**: 67 automated test cases.

---

## 2. Test Architecture & Harness Design

### 2.1 Opaque-Box Execution Model

The E2E test runner interacts strictly with the public contract boundaries defined in `PROJECT.md`:
1. **Domain Types & Contracts** (`src/types/reminder.ts`)
2. **Repository Contract** (`IReminderRepository`)
3. **Notification Service Contract** (`INotificationService`)
4. **Snooze Math & Time Calculations** (`snoozeCalculator.ts`)
5. **Headless Background Action Dispatcher** (`backgroundTask.ts` / `handleNotificationResponse`)

```
+─────────────────────────────────────────────────────────────────────────+
│                           E2E Test Runner                               │
│  tests/e2e/runner.ts (Tier 1 + Tier 2 + Tier 3 + Tier 4 Test Suites)    │
+─────────────────────────────────────────────────────────────────────────+
                                    │
                                    ▼
+─────────────────────────────────────────────────────────────────────────+
│                     Test Harness & SUT Adapter Layer                    │
│                 (tests/e2e/harness/testHarness.ts)                      │
│   - Controllable Mock Clock (freeze/advance time)                        │
│   - Isolated In-Memory AsyncStorage Simulator                           │
│   - Mock Expo Notification System (categories, action dispatcher)       │
│   - Dual-mode Binding (loads src/ implementations or reference oracle)   │
+─────────────────────────────────────────────────────────────────────────+
                   │                                     │
                   ▼                                     ▼
+─────────────────────────────────────+   +───────────────────────────────+
│    IReminderRepository Engine       │   │  INotificationService Engine  │
│  - Hydrated in-memory cache         │   │  - Actionable categories      │
│  - Async persistent storage bridge  │   │  - Headless response dispatch │
│  - State machine transitions        │   │  - Alarm reconciliation       │
+─────────────────────────────────────+   +───────────────────────────────+
```

### 2.2 Controlled Test Fixtures & Virtual Clock

Testing time-sensitive scheduling and snooze math requires eliminating non-deterministic system clock dependencies. The harness includes:
- `MockClock`: Provides `now()`, `advanceMinutes(n)`, `advanceHours(n)`, `advanceDays(n)`, `setTime(date)`.
- `MockStorage`: Simulates the AsyncStorage key-value interface with persistence fidelity, latency simulation, and corruption testing.
- `MockNotificationChannel`: Captures scheduled notification triggers, channels, badges, categories, and allows firing simulated user actions from the notification shade (`ACTION_COMPLETE`, `ACTION_SNOOZE_15M`, `ACTION_SNOOZE_1H`, `ACTION_SNOOZE_TOMORROW`).

---

## 3. The 4-Tier Test Methodology

### 3.1 Tier 1: Core Feature Coverage ($\ge 5$ tests per feature)

Every core domain capability is verified across happy path scenarios, parameter variations, and invariant rejection.

#### Feature 1: Reminder Creation & Invariant Validation (F01, F02)
- **E2E-T1-CREAT-01**: Standard creation with title, notes, and valid future ISO due date.
- **E2E-T1-CREAT-02**: Minimal creation with title only (null/undefined notes), verifying default schema fields.
- **E2E-T1-CREAT-03**: Creation of overdue reminder ($T_{due} < T_{now}$), verifying accepted and correctly flagged.
- **E2E-T1-CREAT-04**: Invariant validation rejection on empty or whitespace-only title (throws validation error).
- **E2E-T1-CREAT-05**: Invariant validation rejection on malformed ISO 8601 date string.

#### Feature 2: Offline Persistence & Hydrated Cache CRUD (F01, F03)
- **E2E-T1-STORE-01**: Full CRUD lifecycle: Create $\to$ Read by ID $\to$ Update title/notes $\to$ Delete.
- **E2E-T1-STORE-02**: Cold boot hydration: Multiple reminders saved, repository disposed, fresh repository initialized against same storage, exact count and records restored.
- **E2E-T1-STORE-03**: Record mutation isolation: Updating reminder A leaves reminder B completely unmodified.
- **E2E-T1-STORE-04**: Idempotent deletion: Attempting to delete a non-existent or previously deleted ID returns false safely without throwing.
- **E2E-T1-STORE-05**: In-memory cache consistency: Synchronous `getAll()` immediately reflects created/updated/deleted records before and after storage sync.

#### Feature 3: Reminder Lifecycle State Machine & Audit (F03, F04)
- **E2E-T1-STATE-01**: `pending` $\to$ `completed`: Status transitions, `completedAt` timestamp is populated, `updatedAt` advances.
- **E2E-T1-STATE-02**: `completed` $\to$ `pending`: Toggling complete uncompletes, status reverts to `pending`, `completedAt` is cleared to null.
- **E2E-T1-STATE-03**: `pending` $\to$ `snoozed`: Status transitions to `snoozed`, `snoozeCount` increments $0 \to 1$, `lastSnoozedAt` recorded.
- **E2E-T1-STATE-04**: `snoozed` $\to$ `completed`: Snoozed reminder is completed, status updates to `completed`, `completedAt` set, `snoozeCount` is preserved.
- **E2E-T1-STATE-05**: Cumulative audit tracking: Snoozing a reminder 3 consecutive times accumulates `snoozeCount = 3` and updates `lastSnoozedAt` at each step.

#### Feature 4: Snooze Calculations & $T_{base}$ Math (F10, F11, F12, F13, F14)
- **E2E-T1-SNOOZE-01**: `+15m` snooze when future ($T_{now} < T_{due}$): Calculates strictly from $T_{due} + 15\text{m}$.
- **E2E-T1-SNOOZE-02**: `+15m` snooze when overdue ($T_{now} > T_{due}$): Calculates strictly from $T_{now} + 15\text{m}$ (anti-overdue trap).
- **E2E-T1-SNOOZE-03**: `+1h` snooze: Adds 60 minutes with seconds and milliseconds clamped to `:00.000`.
- **E2E-T1-SNOOZE-04**: `evening` preset before 18:30: Sets time to 19:00 today.
- **E2E-T1-SNOOZE-05**: `tomorrow_morning` preset: Sets time to next calendar day at 09:00:00.

#### Feature 5: Actionable Notification Payloads & Background Dispatch (F05, F06, F07, F09)
- **E2E-T1-NOTIF-01**: Notification scheduling: Generates notification ID, associates with reminder, payload contains reminder ID and category `remy_reminder_actions`.
- **E2E-T1-NOTIF-02**: Action dispatch `ACTION_COMPLETE`: Fires from notification shade, marks reminder completed in storage, cancels notification.
- **E2E-T1-NOTIF-03**: Action dispatch `ACTION_SNOOZE_15M`: Fires from shade, updates reminder status to `snoozed`, recalculates due date, schedules new notification.
- **E2E-T1-NOTIF-04**: Action dispatch `ACTION_SNOOZE_1H`: Fires from shade, snoozes +1 hour, updates persistence, schedules new notification.
- **E2E-T1-NOTIF-05**: Cold boot reconciliation: `reconcileActiveReminders()` scans storage, cancels orphaned alerts, reschedules alerts for active future reminders.

---

### 3.2 Tier 2: Boundary & Corner Cases ($\ge 5$ tests per boundary category)

#### Category 2.1: Overdue Time Boundaries
- **E2E-T2-BND-01**: Overdue by 1 millisecond ($T_{now} = T_{due} + 1\text{ms}$): Verifies $T_{base}$ boundary correctly switches from $T_{due}$ to $T_{now}$.
- **E2E-T2-BND-02**: Extreme overdue (30 days in the past): Snoozing +15m schedules 15 minutes from current wall clock, never into the past.
- **E2E-T2-BND-03**: Exact boundary equality ($T_{now} == T_{due}$): Handled deterministically without off-by-one errors.
- **E2E-T2-BND-04**: Unix Epoch boundary (1970-01-01T00:00:00.000Z): Validates historical date ingestion without arithmetic overflow.
- **E2E-T2-BND-05**: Far future timestamp (year 2099): Validates 64-bit timestamp math and date string formatting.

#### Category 2.2: Snooze Preset & Threshold Boundaries
- **E2E-T2-SNOOZE-01**: Evening cutoff at 18:29:59: Schedules today at 19:00.
- **E2E-T2-SNOOZE-02**: Evening cutoff at 18:30:00: Shifts to tomorrow evening at 19:00.
- **E2E-T2-SNOOZE-03**: Midnight crossing (23:55:00 + 15m): Rollover into next calendar day at 00:10:00.
- **E2E-T2-SNOOZE-04**: Leap year boundary: Snooze tomorrow morning from Feb 28, 2028 (leap year) targets Feb 29, 2028 09:00.
- **E2E-T2-SNOOZE-05**: Weekend calculation: Target Saturday 09:00 evaluated on Friday, Saturday before 09:00, Saturday after 09:00, and Sunday.

#### Category 2.3: Storage Faults, Serialization & Concurrency
- **E2E-T2-STRG-01**: Storage corruption resilience: Invalid JSON string in storage recovers gracefully to empty state without throwing fatal error.
- **E2E-T2-STRG-02**: Empty storage cold boot: Fresh initialization against empty storage returns empty array `[]`.
- **E2E-T2-STRG-03**: Concurrent read/write stress: 50 simultaneous asynchronous operations maintain consistent state without dropped writes.
- **E2E-T2-STRG-04**: Double initialization idempotency: Calling `init()` repeatedly on active repository does not duplicate items or corrupt state.
- **E2E-T2-STRG-05**: Persistence of optional/null fields: Null notes, null notificationId, and null lastSnoozedAt serialize and deserialize cleanly.

#### Category 2.4: Input Adversarial & Boundary Characters
- **E2E-T2-CHAR-01**: Unicode, Bidirectional (RTL Arabic/Hebrew) and emojis (🚨📝⏰🔥) in title and notes.
- **E2E-T2-CHAR-02**: Injection sequences: SQL/HTML/Script strings (`<script>alert(1)</script>`, `' OR 1=1 --`) stored without execution or truncation.
- **E2E-T2-CHAR-03**: Maximum length payload: 10,000-character title and notes handled without buffer overflow.
- **E2E-T2-CHAR-04**: Whitespace-only notes: Normalized to empty/null without failing schema validation.
- **E2E-T2-CHAR-05**: Escape characters: Escaped newlines, tabs, carriage returns (`\r\n\t\\`) preserved verbatim across serialization.

#### Category 2.5: Action & Notification State Boundary
- **E2E-T2-ACT-01**: Shade action received for non-existent reminder ID: Handled safely with error log, no unhandled rejection.
- **E2E-T2-ACT-02**: Snooze action on completed reminder: Does not corrupt completed state or re-arm invalid alarms.
- **E2E-T2-ACT-03**: Unknown action identifier: Gracefully ignored without crashing background task runner.
- **E2E-T2-ACT-04**: Notification cancel on invalid notificationId: Executes as no-op safely.
- **E2E-T2-ACT-05**: Permission denied fallback: Scheduling returns null when permissions are not granted, keeping reminder storage valid.

---

### 3.3 Tier 3: Cross-Feature Interactions (Pairwise Combinations)

Tests the interplay between independent modules:
- **E2E-T3-PAIR-01** [Create $\times$ Snooze $\times$ Notification]: Reminder created $\to$ notification scheduled $\to$ user snoozes +15m from shade $\to$ storage updated to snoozed $\to$ old notification cancelled $\to$ new notification scheduled.
- **E2E-T3-PAIR-02** [Snooze $\times$ Cold Boot $\times$ Reconciliation]: Reminder snoozed to future date $\to$ app killed $\to$ cold boot runs reconciliation $\to$ notification re-registered, snooze counter intact.
- **E2E-T3-PAIR-03** [Create $\times$ Complete $\times$ Headless Action]: Reminder completed in app $\to$ obsolete notification response arrives in background $\to$ state machine guards completion.
- **E2E-T3-PAIR-04** [Overdue $\times$ Snooze +1h $\times$ Toggle Complete]: Overdue task snoozed (calculates from now) $\to$ marked complete $\to$ uncompleted $\to$ preserves snoozed due date.
- **E2E-T3-PAIR-05** [Create $\times$ Delete $\times$ Notification Cancel]: Active reminder deleted $\to$ notification automatically cancelled, preventing phantom alerts.
- **E2E-T3-PAIR-06** [Bulk Creation $\times$ Multi-Reminder Snooze]: 10 reminders created $\to$ 3 snoozed with different presets (+15m, +1h, evening) $\to$ 7 remain unmodified.
- **E2E-T3-PAIR-07** [Update Input $\times$ Snooze State]: Reminder in `snoozed` state updated with new title and notes $\to$ status remains `snoozed`, `snoozeCount` preserved.
- **E2E-T3-PAIR-08** [Weekend Snooze $\times$ Cold Boot]: Weekend snooze scheduled $\to$ memory cleared $\to$ reloaded from storage $\to$ exact Saturday 09:00 timestamp verified.
- **E2E-T3-PAIR-09** [Past-Due Reconciliation]: Expired reminders in storage reconciled $\to$ expired notifications not scheduled, reminder remains overdue pending user action.
- **E2E-T3-PAIR-10** [Sequential Snooze Presets]: +15m $\to$ +1h $\to$ tomorrow morning $\to$ audit history records 3 snoozes, due dates monotonically advance.
- **E2E-T3-PAIR-11** [Custom Date Snooze $\times$ In-Memory Cache]: Custom target date set $\to$ synchronous cache read immediately returns new ISO date string.
- **E2E-T3-PAIR-12** [Toggle Complete $\times$ Delete Race]: Rapid toggle complete followed immediately by delete $\to$ item completely removed from storage and cache.

---

### 3.4 Tier 4: Real-World Workload Scenarios

Exhaustive, multi-step user journeys:
1. **E2E-T4-WORK-01: "The Morning Executive Rush"**
   - User creates 15 reminders at 08:00 AM (standups, approvals, medication, calls).
   - Notification shade fires actions: 4 reminders snoozed (+15m, +1h, evening, custom).
   - 6 reminders marked complete in rapid succession.
   - App experiences cold restart / reboot.
   - Cold-boot reconciliation executes.
   - Comprehensive assertion: 15 reminders verified for exact status, snooze counts, and active alert registration.
2. **E2E-T4-WORK-02: "The Chronic Snoozer Journey"**
   - High-priority reminder created.
   - User snoozes 8 consecutive times over 3 simulated days.
   - Verifies $T_{base}$ progression, `snoozeCount = 8`, `lastSnoozedAt` updating continuously, and final completion audit.
3. **E2E-T4-WORK-03: "Month-End & Leap-Day Calendar Crossing"**
   - Reminder set at 2028-02-28 23:45.
   - Snoozed +15m $\to$ rolls into leap day Feb 29 at 00:00.
   - Snoozed tomorrow morning $\to$ Feb 29 at 09:00.
   - Snoozed tomorrow morning again $\to$ March 1 at 09:00.
   - Month boundary roll verified across non-leap and leap years.
4. **E2E-T4-WORK-04: "The Offline Commuter / Battery-Saver Disconnect"**
   - 30 rapid operations queued offline (10 creates, 5 snoozes, 5 updates, 5 completes, 5 deletes).
   - Storage simulates intermittent persistence locks.
   - System restarts.
   - Verifies zero dropped records, exact 20 remaining items, and 0 corrupt records.
5. **E2E-T4-WORK-05: "Adversarial Chaos & Resource Stress"**
   - 25 reminders ingested with hostile inputs (RTL text, HTML tags, SQL injections, Unicode surrogate pairs, 10k char notes).
   - Rapid concurrent mutations.
   - Verifies zero crashes, 100% data integrity upon serialization and round-trip parsing.

---

## 4. Test Matrix & Traceability

| ID | Tier | Target Component | Description | Expected Output Source |
|---|---|---|---|---|
| E2E-T1-CREAT-01 | Tier 1 | Storage / Domain | Standard reminder creation | PROJECT.md Interface Contracts |
| E2E-T1-CREAT-02 | Tier 1 | Storage / Domain | Minimal creation (title only) | PROJECT.md Interface Contracts |
| E2E-T1-CREAT-03 | Tier 1 | Storage / Domain | Overdue reminder creation | PROJECT.md F01, F02 |
| E2E-T1-CREAT-04 | Tier 1 | Domain Validation | Empty title validation rejection | PROJECT.md F02 |
| E2E-T1-CREAT-05 | Tier 1 | Domain Validation | Invalid ISO date rejection | PROJECT.md F02 |
| E2E-T1-STORE-01 | Tier 1 | Storage Repository | Full CRUD lifecycle | PROJECT.md IReminderRepository |
| E2E-T1-STORE-02 | Tier 1 | Storage Repository | Cold boot cache hydration | PROJECT.md R1, F01 |
| E2E-T1-STORE-03 | Tier 1 | Storage Repository | Record update isolation | Storage Invariant |
| E2E-T1-STORE-04 | Tier 1 | Storage Repository | Idempotent delete | PROJECT.md IReminderRepository |
| E2E-T1-STORE-05 | Tier 1 | Storage Repository | In-memory cache sync | PROJECT.md R1 (0ms reads) |
| E2E-T1-STATE-01 | Tier 1 | State Machine | Pending $\to$ Completed | PROJECT.md F03 |
| E2E-T1-STATE-02 | Tier 1 | State Machine | Completed $\to$ Pending (Toggle) | PROJECT.md F03 |
| E2E-T1-STATE-03 | Tier 1 | State Machine | Pending $\to$ Snoozed | PROJECT.md F03, F04 |
| E2E-T1-STATE-04 | Tier 1 | State Machine | Snoozed $\to$ Completed | PROJECT.md F03, F04 |
| E2E-T1-STATE-05 | Tier 1 | State Machine | Cumulative snooze audit | PROJECT.md F04 |
| E2E-T1-SNOOZE-01 | Tier 1 | Snooze Math | Future +15m ($T_{base} = T_{due}$) | PROJECT.md F10 |
| E2E-T1-SNOOZE-02 | Tier 1 | Snooze Math | Overdue +15m ($T_{base} = T_{now}$) | PROJECT.md F10 |
| E2E-T1-SNOOZE-03 | Tier 1 | Snooze Math | +1h Snooze Normalization | PROJECT.md F11 |
| E2E-T1-SNOOZE-04 | Tier 1 | Snooze Math | Evening Snooze before 18:30 | PROJECT.md F12 |
| E2E-T1-SNOOZE-05 | Tier 1 | Snooze Math | Tomorrow Morning Snooze | PROJECT.md F13 |
| E2E-T1-NOTIF-01 | Tier 1 | Notification Service| Scheduling & Payload Binding | PROJECT.md F05, INotificationService |
| E2E-T1-NOTIF-02 | Tier 1 | Notification Service| Shade ACTION_COMPLETE | PROJECT.md F05, F06 |
| E2E-T1-NOTIF-03 | Tier 1 | Notification Service| Shade ACTION_SNOOZE_15M | PROJECT.md F05, F06, F10 |
| E2E-T1-NOTIF-04 | Tier 1 | Notification Service| Shade ACTION_SNOOZE_1H | PROJECT.md F05, F06, F11 |
| E2E-T1-NOTIF-05 | Tier 1 | Notification Service| Cold Boot Reconciliation | PROJECT.md F09 |
| E2E-T2-BND-01 | Tier 2 | Boundary / Time | 1ms Overdue Transition | Mathematical Definition of max() |
| E2E-T2-BND-02 | Tier 2 | Boundary / Time | 30-Day Overdue Recovery | Anti-overdue specification |
| E2E-T2-BND-03 | Tier 2 | Boundary / Time | Exact Equality $T_{now} == T_{due}$ | Boundary Value Analysis |
| E2E-T2-BND-04 | Tier 2 | Boundary / Time | Unix Epoch Boundary | ISO 8601 specification |
| E2E-T2-BND-05 | Tier 2 | Boundary / Time | Far Future (Year 2099) | Timestamp overflow resilience |
| E2E-T2-SNOOZE-01 | Tier 2 | Boundary / Snooze | Evening Cutoff at 18:29:59 | PROJECT.md F12 specification |
| E2E-T2-SNOOZE-02 | Tier 2 | Boundary / Snooze | Evening Cutoff at 18:30:00 | PROJECT.md F12 specification |
| E2E-T2-SNOOZE-03 | Tier 2 | Boundary / Snooze | Midnight Rollover | Calendar arithmetic |
| E2E-T2-SNOOZE-04 | Tier 2 | Boundary / Snooze | Leap Year Feb 28 $\to$ Feb 29 | Gregorian calendar rules |
| E2E-T2-SNOOZE-05 | Tier 2 | Boundary / Snooze | Weekend Saturday/Sunday rules | PROJECT.md F14 specification |
| E2E-T2-STRG-01 | Tier 2 | Storage Fault | Corrupt JSON Recovery | R1 Resiliency requirement |
| E2E-T2-STRG-02 | Tier 2 | Storage Fault | Empty Storage Cold Boot | R1 Zero-configuration |
| E2E-T2-STRG-03 | Tier 2 | Storage Fault | 50 Concurrent Async Writes | Concurrency safety |
| E2E-T2-STRG-04 | Tier 2 | Storage Fault | Double Init Idempotency | Defensive programming |
| E2E-T2-STRG-05 | Tier 2 | Storage Fault | Nullable Fields Serialization | TypeScript schema |
| E2E-T2-CHAR-01 | Tier 2 | Boundary / Input | Unicode & Emojis | Character encoding integrity |
| E2E-T2-CHAR-02 | Tier 2 | Boundary / Input | Injection Sequences | Sanitization & Escaping |
| E2E-T2-CHAR-03 | Tier 2 | Boundary / Input | 10k String Stress | Memory boundary stress |
| E2E-T2-CHAR-04 | Tier 2 | Boundary / Input | Whitespace Notes Trimming | Invariant validation |
| E2E-T2-CHAR-05 | Tier 2 | Boundary / Input | Escape Characters (\r\n\t) | Literal string preservation |
| E2E-T2-ACT-01 | Tier 2 | Notification Action | Action on Non-Existent ID | Fault tolerance |
| E2E-T2-ACT-02 | Tier 2 | Notification Action | Snooze on Completed Task | State machine guard |
| E2E-T2-ACT-03 | Tier 2 | Notification Action | Unknown Action Identifier | Payload parser tolerance |
| E2E-T2-ACT-04 | Tier 2 | Notification Action | Cancel Non-Existent Alert | Safe cleanup |
| E2E-T2-ACT-05 | Tier 2 | Notification Action | Permission Denied Fallback | PROJECT.md F23 |
| E2E-T3-PAIR-01 | Tier 3 | Cross-Feature | Create + Snooze + Notification | Multi-system flow |
| E2E-T3-PAIR-02 | Tier 3 | Cross-Feature | Snooze + Cold Boot + Reconcile | Persistence + Alarm lifecycle |
| E2E-T3-PAIR-03 | Tier 3 | Cross-Feature | Complete + Headless Action Race| Concurrency + State machine |
| E2E-T3-PAIR-04 | Tier 3 | Cross-Feature | Overdue + +1h + Toggle Complete| State + Calculation math |
| E2E-T3-PAIR-05 | Tier 3 | Cross-Feature | Create + Delete + Cancel Alert | Resource cleanup |
| E2E-T3-PAIR-06 | Tier 3 | Cross-Feature | Bulk Create + Multi-Snooze | Ledger row isolation |
| E2E-T3-PAIR-07 | Tier 3 | Cross-Feature | Update Input + Snooze State | State invariant protection |
| E2E-T3-PAIR-08 | Tier 3 | Cross-Feature | Weekend Snooze + Cold Boot | Calendar + Hydration |
| E2E-T3-PAIR-09 | Tier 3 | Cross-Feature | Past-Due Notification Sweep | Reconciliation engine |
| E2E-T3-PAIR-10 | Tier 3 | Cross-Feature | Sequential Preset Progression | Audit history accumulation |
| E2E-T3-PAIR-11 | Tier 3 | Cross-Feature | Custom Date + Cache Read | Cache synchronicity |
| E2E-T3-PAIR-12 | Tier 3 | Cross-Feature | Complete + Delete Race | CRUD race handling |
| E2E-T4-WORK-01 | Tier 4 | Workload Scenario | Morning Executive Rush (15 tasks)| Real-world end-to-end flow |
| E2E-T4-WORK-02 | Tier 4 | Workload Scenario | Chronic Snoozer (8x snoozes) | Long-term usage cycle |
| E2E-T4-WORK-03 | Tier 4 | Workload Scenario | Month-End & Leap Day Crossing | Calendar edge journey |
| E2E-T4-WORK-04 | Tier 4 | Workload Scenario | Offline Commuter (30 batch ops) | Offline-first sync stress |
| E2E-T4-WORK-05 | Tier 4 | Workload Scenario | Adversarial Chaos & Resource Stress| Security & extreme load |

---

## 5. Execution Model & Runner

The E2E test harness is executed directly via Node.js using TypeScript execution:

```bash
# Run all E2E test suites (Tier 1 through Tier 4)
node --no-warnings --experimental-strip-types tests/e2e/runner.ts

# Or via npm script (when wired into package.json)
npm run test:e2e
```

### Exit Code Protocol
- `0`: 100% of test cases passed.
- `1`: One or more test assertions failed, or an unhandled exception occurred.
