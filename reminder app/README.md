# Remy Reminders

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-3178c6.svg)](https://www.typescriptlang.org/)
[![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020.svg)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-0.86.3-61dafb.svg)](https://reactnative.dev/)
[![Tests](https://img.shields.io/badge/Unit%20Tests-332%2F332%20Pass-brightgreen.svg)]()
[![E2E Tests](https://img.shields.io/badge/E2E%20Tests-67%2F67%20Pass-brightgreen.svg)]()
[![Offline First](https://img.shields.io/badge/Architecture-Offline--First-orange.svg)]()

> **Zero-friction prospective memory engine with actionable notification shade rescheduling, local-first persistence, and an austere Swiss typographic aesthetic.**

---

## 1. Prospective Memory & Product Philosophy

In cognitive psychology, **prospective memory** denotes the cognitive faculty enabling individuals to formulate, retain, and reliably retrieve an intention to execute an action at a designated future juncture or upon encountering a specific environmental cue.

Traditional mobile reminder applications systematically fail prospective memory in three critical ways:
1. **The Notification Shade Friction Trap**: Alerts momentarily trigger cognitive awareness, but acting upon them forces the user to unlock their phone, wait for app foregrounding, context-switch out of their active task, and navigate complex modal interfaces. Consequently, users reflexively dismiss notifications to clear screen real estate, silently abandoning their prospective memory intentions.
2. **The Overdue Drift Problem**: When tasks slip past their scheduled deadlines, conventional snooze algorithms calculate offsets from the original obsolete due time rather than current real-world wall clock time, silently rescheduling tasks into the past or immediate present.
3. **Visual & Notification Fatigue**: Flamboyant skeuomorphism, unnecessary gamification, and chaotic color palettes produce visual friction that degrades cognitive focus.

**Remy Reminders** is engineered to eliminate these failure modes:
- **Zero-Friction Shade Rescheduling**: Complete, snooze for 15 minutes, delay for 1 hour, or defer until tomorrow morning directly from the Android/iOS notification shade without foregrounding the application.
- **Strict $T_{base}$ Mathematical Invariant**: Every snooze calculation operates on $T_{base} = \max(T_{now}, T_{due})$, ensuring that overdue intentions are perpetually rescheduled relative to current reality rather than obsolete milestones.
- **Local-First Zero-Latency Storage**: Instantaneous synchronous reads and asynchronous serialized flush cycles guarantee zero spinner delays, zero network dependencies, and complete data sovereignty.
- **Austere Swiss Editorial Aesthetic**: High-contrast typographic hierarchy, tabular monospace numerals, asymmetric structured grids, and monochromatic minimalism designed to honor the International Typographic Style.

---

## 2. System Architecture

Remy Reminders is built on a clean decoupled architecture separating UI presentation, reactive state hooks, domain state machines, local storage persistence, and native background notification dispatchers.

```
+-------------------------------------------------------------------------------+
|                      Swiss Editorial User Interface Layer                     |
|                                                                               |
|  +---------------------+   +---------------------+   +---------------------+  |
|  |  Editorial Masthead |   |  QuickCaptureBar    |   |  ReminderCard List  |  |
|  |  Date & Live Status |   |  Chips: +15m/+1h... |   |  Ledger Row & Swipe |  |
|  +---------------------+   +---------------------+   +---------------------+  |
|  +---------------------+   +---------------------+   +---------------------+  |
|  |  Granular Snooze    |   |  ThemeEngine        |   |  EmptyState         |  |
|  |  Modal (6 Presets)  |   |  (Light/Dark/Void)  |   |  Clear Manifesto    |  |
|  +---------------------+   +---------------------+   +---------------------+  |
+-------------------------------------------------------------------------------+
                                        │
                                        ▼
+-------------------------------------------------------------------------------+
|                           Reactive Hooks & State                              |
|           useReminders          useTheme           useNotifications           |
+-------------------------------------------------------------------------------+
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
+---------------------------------------+   +-----------------------------------+
|     Domain Engine & State Machine     |   |       Snooze Math & Timing        |
|  - Status: pending/snoozed/completed  |   |  - T_base = max(T_now, T_due)     |
|  - Audit: snoozeCount, lastSnoozedAt  |   |  - Presets: 15m, 1h, eve, mor, sat|
|  - Invariant schema validators        |   |  - 18:30 evening cutoff rule      |
+---------------------------------------+   +-----------------------------------+
                    │                                       │
                    ▼                                       ▼
+---------------------------------------+   +-----------------------------------+
|      Local Storage Repository         |   |    Actionable Notification Engine |
|  - In-Memory Synchronous Cache (0ms)  |   |  - Category: remy_reminder_actions|
|  - Serialized Async Flush Pipeline    |   |  - Android MAX Priority Channel   |
|  - AsyncStorage Persistent Layer      |   |  - Headless TaskManager Background|
|  - Cold-Boot Rehydration & Recovery   |   |  - Cold-Boot Reconciliation Sweep |
+---------------------------------------+   +-----------------------------------+
```

### Headless Notification Shade Lifecycle

```
[System Notification Alert Fires]
                 │
                 ├── User taps Action Button in Shade
                 │   ("Complete" | "+15m" | "+1h" | "Tomorrow 9am")
                 ▼
[expo-task-manager: BACKGROUND_NOTIFICATION_TASK]
                 │  (Executes headlessly in background without UI)
                 ▼
[NotificationService.handleNotificationResponse]
                 ├── If Complete:
                 │     StorageService.toggleComplete(id)
                 │     Cancel active alert
                 │
                 └── If Snooze (+15m / +1h / Tomorrow):
                       Calculate new due date via T_base math
                       StorageService.snooze(id, targetDate, preset)
                       Schedule next OS Notification
                 │
                 ▼
[Local Repository Updated & Alarm Registered in Background]
```

---

## 3. Swiss Minimalist Design & Theme Triad

Inspired by Josef Müller-Brockmann and the International Typographic Style, the interface treats information density, typography, and contrast as functional tools rather than ornamentation.

### Typographic Principles
- **Monospace Tabular Numerals**: All timestamps, snooze counters, and date headers utilize `fontVariant: ['tabular-nums']` to ensure absolute alignment across vertically scrolling ledger rows.
- **Asymmetric Grid & High Contrast**: Strict boundaries, sharp square geometry (zero rounded pill distraction on cards), and crisp border separators.
- **Auditory & Haptic Tactility**: Crisp selection feedback on chip interactions and impact pulses on task submission.

### The Theme Triad

| Theme | Inspiration | Background | Surface | Accent | Primary Use |
|---|---|---|---|---|---|
| **`Light`** | Broadside Newsprint | `#FFFFFF` | `#F4F4F4` | `#111111` | High-ambient outdoor readability |
| **`Dark`** | Architectural Slate | `#121212` | `#1E1E1E` | `#FFFFFF` | Studio & low-light environments |
| **`Void`** | Pure OLED Negative Space | `#000000` | `#0D0D0D` | `#FF4500` (Intl Orange) | Maximum battery savings & zero light spill |

---

## 4. Key Features & Capabilities

- **F01: Zero-Latency Local Storage Engine**: In-memory cache provides instantaneous synchronous reads and mutations, backed by an atomic serialized queue flushing to `@react-native-async-storage/async-storage`.
- **F02: Actionable Notification Shade Controls**: Action category `remy_reminder_actions` registered with:
  - `Complete` (Finishes task and clears alert)
  - `+15m` (Snoozes task by 15 minutes)
  - `+1h` (Snoozes task by 1 hour)
  - `Tomorrow` (Reschedules task to next morning 09:00)
- **F03: Headless Background Action Execution**: Rescheduling and completion actions execute headlessly through `expo-task-manager` without requiring the app to open.
- **F04: Quick-Capture Bar with Preset Chips**: Always-accessible bottom input bar with instant preset chips (`+15M`, `+1H`, `TONIGHT`, `TOMORROW 9AM`), fortified with synchronous `useRef` locks against rapid multi-tap microtask race conditions.
- **F05: Granular Snooze Modal Sheet**: Bottom sheet modal providing 6 precision presets:
  - `+15 Minutes`
  - `+1 Hour`
  - `This Evening` (19:00 today; rolls to 19:00 tomorrow if past 18:30)
  - `Tomorrow Morning` (09:00 tomorrow)
  - `This Weekend` (Saturday 09:00)
  - `Custom Date & Time Picker` (Granular modal picker)
- **F06: High-Precision $T_{base}$ Mathematical Invariant**:
  $$\Delta T = f(\max(T_{now}, T_{due}))$$
  Overdue tasks calculate forward offsets from the instant of user action, preventing backward scheduling.
- **F07: Overdue Warning Indicators**: High-contrast visual markers (`[!] OVERDUE`) indicating exact elapsed overdue duration (`2h 15m`, `3d 4h`).
- **F08: Android MAX Priority Notification Channel**: Heads-up banner visibility, lockscreen presentation, high-priority bypass, and custom vibration sequencing.
- **F09: Cold-Boot Alarm Reconciliation**: Automatic recovery sweep on device restart or app initialization that synchronizes system alarms with the active database.
- **F10: Cross-Platform Safety Fallback**: Clean graceful fallbacks for web browsers, desktop wrappers, and headless testing harnesses.

---

## 5. File & Directory Layout

```
remy-reminders/
├── app.json                     # Expo SDK 57 project configuration & permissions
├── package.json                 # Project dependencies, scripts, and runtime engines
├── tsconfig.json                # TypeScript strict configuration
├── babel.config.js              # Babel presets & module mapping
├── jest.config.js               # Jest harness configuration with react-native presets
├── App.tsx                      # Root application entry point & context providers
├── LICENSE                      # Open-source MIT License
├── README.md                    # System architecture, philosophy & usage documentation
├── assets/                      # Application icons, splash screens & favicons
├── src/
│   ├── types/                   # TypeScript interfaces & domain contracts
│   │   ├── reminder.ts          # Reminder, SnoozePreset, Status & Input interfaces
│   │   ├── theme.ts             # ThemeMode, ThemeColors & design token contracts
│   │   └── index.ts             # Barrel exports
│   ├── theme/                   # Swiss Design tokens and theme engine
│   │   ├── colors.ts            # Palette triads (Light, Dark, Void)
│   │   ├── typography.ts        # Modular font scales, weights & monospace tokens
│   │   ├── spacing.ts           # 4px/8px Swiss baseline grid scales
│   │   ├── ThemeContext.tsx     # Reactive theme provider & mode switcher
│   │   └── index.ts             # Barrel exports
│   ├── utils/                   # Pure business logic and algorithms
│   │   ├── snoozeCalculator.ts  # T_base math, preset offsets & cutoff algorithms
│   │   ├── dateFormatting.ts    # Tabular date, time, and relative duration formatters
│   │   ├── idGenerator.ts       # UUID v4 generator with cryptographic fallback
│   │   └── index.ts             # Barrel exports
│   ├── services/                # Persistence & native device infrastructure
│   │   ├── storageService.ts    # AsyncStorage repository with 0ms in-memory cache
│   │   ├── notificationService.ts # Actionable categories, scheduling & shade dispatcher
│   │   ├── backgroundTask.ts    # TaskManager background action registration
│   │   └── index.ts             # Barrel exports
│   ├── hooks/                   # Reactive state management hooks
│   │   ├── useReminders.ts      # Reactive reminder queries, filters & mutations
│   │   ├── useNotifications.ts  # Notification setup, listeners & permission flows
│   │   ├── useTheme.ts          # Theme consumer hook
│   │   └── index.ts             # Barrel exports
│   ├── components/              # Swiss UI Component library
│   │   ├── Masthead.tsx         # Editorial date masthead, counters & overdue count
│   │   ├── QuickCaptureBar.tsx  # Frictionless input bar with preset chips & ref lock
│   │   ├── ReminderCard.tsx     # Monospace ledger row with tabular time & snooze badge
│   │   ├── ReminderList.tsx     # Scrollable task ledger with sectional grouping
│   │   ├── SnoozeModal.tsx      # Granular rescheduling sheet with 6 presets & custom picker
│   │   ├── ThemeToggle.tsx      # Triad theme switcher (Light / Dark / Void)
│   │   ├── EmptyState.tsx       # "MEMORY STACK CLEAR" minimal manifesto
│   │   └── index.ts             # Barrel exports
│   └── screens/
│       ├── HomeScreen.tsx       # Master layout screen integrating all components
│       └── index.ts             # Barrel exports
└── tests/                       # Automated test infrastructure
    ├── snoozeCalculator.test.ts # Math & boundary unit tests
    ├── snoozeCalculator.adversarial.test.ts # Adversarial calendar & timezone tests
    ├── storageService.test.ts   # Repository CRUD & hydration tests
    ├── storageService.stress.test.ts # Concurrency, corruption & I/O stress tests
    ├── notificationService.test.ts # Notification categories & permissions tests
    ├── notificationService.stress.test.ts # Heavy volume & payload stress tests
    ├── idGenerator.test.ts      # UUID uniqueness & format validation
    ├── theme.test.tsx           # Theme triad switching & style propagation tests
    ├── uiComponents.test.tsx    # Component render & interaction tests
    ├── challenger_m2_2.test.ts  # Background shade action interaction tests
    ├── challenger_m3_1.test.tsx # UI state transitions & burst capture concurrency tests
    ├── challenger_m3_2.test.tsx # Theme rendering & Swiss layout compliance tests
    ├── mocks/                   # Test environment mocks
    │   ├── mockAsyncStorage.ts  # In-memory storage mock
    │   └── mockNotifications.ts # Expo Notifications driver mock
    └── e2e/                     # 4-Tier Opaque-Box E2E Test Suite
        ├── runner.ts            # Master TypeScript E2E runner
        ├── runner.js            # Node runtime executable wrapper
        ├── tier1_feature_coverage.test.ts # Core feature coverage (25 tests)
        ├── tier2_boundary_corner.test.ts  # Edge & boundary cases (25 tests)
        ├── tier3_cross_feature.test.ts    # Pairwise cross-feature interactions (12 tests)
        ├── tier4_workload_scenarios.test.ts # Real-world user journeys (5 tests)
        └── harness/             # E2E test harness & simulated clock/storage/alarms
            ├── mockClock.ts
            ├── mockStorage.ts
            ├── mockNotifications.ts
            ├── referenceDomain.ts
            ├── testFramework.ts
            ├── testHarness.ts
            └── types.ts
```

---

## 6. Setup & Execution Guide

### Prerequisites
- **Node.js**: v20.x or v22.x LTS
- **npm**: v10.x or higher
- **Expo CLI**: bundled with `npx expo`
- For Android device/emulator testing: Android Studio with an Android 13+ (API 33+) emulator or physical device.

### Installation

Clone the repository and install all dependencies:

```bash
git clone https://github.com/remy-reminders/remy-reminders.git
cd remy-reminders
npm install
```

---

### Running on Web

To start the web preview in your browser with Metro bundler:

```bash
npm run web
# or
npx expo start --web
```

The application will launch at `http://localhost:8081` with full support for theme switching, task creation, snoozing, and local storage persistence.

---

### Running on Android

#### Option A: Expo Go (Instant Preview)
1. Install **Expo Go** from Google Play Store on your Android device.
2. Start the Expo development server:
   ```bash
   npx expo start
   ```
3. Scan the QR code displayed in the terminal using the Expo Go camera scanner.

#### Option B: Android Emulator / Development Build
1. Start an Android Virtual Device (AVD) from Android Studio.
2. Run the Android target:
   ```bash
   npm run android
   # or
   npx expo start --android
   ```

#### Android Native Permissions Configured in `app.json`:
- `RECEIVE_BOOT_COMPLETED`: Automatically re-schedules active alarms when the device boots.
- `SCHEDULE_EXACT_ALARM`: Ensures millisecond-accurate notification triggering.
- `POST_NOTIFICATIONS`: Requests Android 13+ notification runtime permissions.
- `VIBRATE`: Provides haptic feedback and heads-up alert pulsation.

---

## 7. Testing & Verification

The repository enforces complete type-safety and 100% automated test coverage across two distinct testing tracks: the Jest Unit/Integration Suite and the 4-Tier E2E Test Suite.

### 1. TypeScript Typechecking
Verify full type-safety across all components, services, and hooks:

```bash
npm run typecheck
```
*Expected result: `tsc --noEmit` exits with 0 errors.*

---

### 2. Jest Unit & Integration Test Suite
Execute the 12 unit and integration test suites:

```bash
npm test
```

Generate a detailed code coverage report:

```bash
npm run test:coverage
```

#### Test Suite Summary:
| Test Suite | Focus Area | Status |
|---|---|---|
| `snoozeCalculator.test.ts` | $T_{base}$ calculation logic and preset algorithms | PASS |
| `snoozeCalculator.adversarial.test.ts` | Leap years, midnight rollovers, 18:30 cutoffs | PASS |
| `storageService.test.ts` | In-memory caching, CRUD, rehydration | PASS |
| `storageService.stress.test.ts` | 300+ large payloads, concurrent writes, corrupt JSON | PASS |
| `notificationService.test.ts` | Category registration, permissions, action triggers | PASS |
| `notificationService.stress.test.ts` | Burst notification scheduling, ID reconciliations | PASS |
| `idGenerator.test.ts` | UUID v4 RFC-4122 compliance | PASS |
| `theme.test.tsx` | Light, Dark, Void theme switching & token resolution | PASS |
| `uiComponents.test.tsx` | Masthead, QuickCapture, Cards, Modal rendering | PASS |
| `challenger_m2_2.test.ts` | Headless shade actions, notification routing | PASS |
| `challenger_m3_1.test.tsx` | UI state transitions, burst concurrency, ref locks | PASS |
| `challenger_m3_2.test.tsx` | Swiss layout compliance, typography tokens, tabular numbers | PASS |
| **Total** | **332 Unit Tests** | **100% PASS** |

---

### 3. 4-Tier Opaque-Box E2E Test Suite
Run the 4-tier E2E runner exercising complete user journeys and cold reboots:

```bash
npm run test:e2e
```

Or via direct Node execution:
```bash
node --no-warnings --experimental-strip-types tests/e2e/runner.ts
```

#### E2E Tier Coverage:
- **Tier 1: Feature Coverage (25 tests)**: Invariant creation, offline CRUD persistence, lifecycle state machines, $T_{base}$ calculations, actionable notifications.
- **Tier 2: Boundary & Adversarial Cases (25 tests)**: Overdue time thresholds, 18:30 evening cutoff, midnight rollovers, storage fault injections, hostile Unicode/RTL strings.
- **Tier 3: Cross-Feature Interactions (12 tests)**: Pairwise permutations (Snooze x Cold Boot x Notification cancel, Bulk operations x Cache consistency).
- **Tier 4: Real-World Workload Scenarios (5 tests)**:
  - *Scenario 1*: "The Morning Executive Rush" (15 tasks created, shade-snoozed, completed, reboot-reconciled).
  - *Scenario 2*: "The Chronic Snoozer Journey" (8 consecutive snoozes across 3 simulated days).
  - *Scenario 3*: "Month-End & Leap-Day Calendar Crossing" (transition across calendar boundaries).
  - *Scenario 4*: "The Offline Commuter Flight Mode" (30 rapid offline mutations with reboot consistency).
  - *Scenario 5*: "Adversarial Chaos & Resource Stress" (25 hostile records under concurrent pressure).

*Total: 67 / 67 E2E tests passing (100% pass rate).*

---

### 4. Expo Configuration Validation
Validate that the Expo app manifest is syntactically sound and correctly configured:

```bash
npx expo config
```

---

## 8. License

This project is open source and available under the terms of the **[MIT License](./LICENSE)**.

Copyright (c) 2026 Remy Reminders Contributors.
