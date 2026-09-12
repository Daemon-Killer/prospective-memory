# Project: Remy Reminders Mobile Application

## Architecture
Offline-first React Native (Expo) architecture engineered for zero-latency local operations, actionable notification shade interaction, and a Swiss editorial design aesthetic.

### System Architecture
```
+-------------------------------------------------------------------------+
|                        User Interface (Swiss Style)                     |
|  +---------------------+  +--------------------+  +------------------+  |
|  | Editorial Masthead  |  |  QuickCaptureBar   |  |   ReminderList   |  |
|  +---------------------+  +--------------------+  +------------------+  |
|  +---------------------+  +--------------------+  +------------------+  |
|  |  Granular Snooze    |  |    ThemeEngine     |  |    EmptyState    |  |
|  |    Modal Sheet      |  | (Light/Dark/Void)  |  |    Manifesto     |  |
|  +---------------------+  +--------------------+  +------------------+  |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                       Application State & Hooks                         |
|      useReminders ─── useTheme ─── useNotificationSetup                 |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
|                       Domain Engine & Business Logic                    |
|  +───────────────────────────────────+  +────────────────────────────+  |
|  |     Reminder State Machine        |  |  Snooze Calculators        |  |
|  | (Pending, Snoozed, Completed)     |  | (T_base = max(now, due))   |  |
|  +───────────────────────────────────+  +────────────────────────────+  |
+-------------------------------------------------------------------------+
                  │                                         │
                  ▼                                         ▼
+-----------------------------------+     +-------------------------------+
|     Offline Storage Repository    |     |   Actionable Notifications    |
|   (AsyncStorage + Hydrated Cache  |     |   (expo-notifications +       |
|    for 0ms Sync Reads & Writes)   |     |    expo-task-manager shade)   |
+-----------------------------------+     +-------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Local Reminder CRUD Engine | Zero-latency local persistent repository with hydrated cache | M1 (DONE) | Survey |
| F02 | Schema & Invariant Validation | Strict schema validation (`id`, `title`, `dueDate`, etc.) | M1 (DONE) | Survey |
| F03 | Reminder Lifecycle State Machine | Deterministic state transitions (Pending, Snoozed, Completed) | M1 (DONE) | Survey |
| F04 | Snooze Counter & Audit Metric | Tracks `snoozeCount` and `lastSnoozedAt` | M1 (DONE) | Survey |
| F05 | Actionable Notification Category | Registers `remy_reminder_actions` with Complete, +15m, +1h, Tomorrow | M2 | Survey |
| F06 | Headless Notification Shade Handler | Background action execution (`opensAppToForeground: false`) | M2 | Survey |
| F07 | Notification Body Tap Routing | Tapping notification body opens app to target reminder & snooze sheet | M2 | Survey |
| F08 | Android High Priority Channel | Configures channel with MAX importance, heads-up banner, vibration | M2 | Survey |
| F09 | Alarm & Notification Reconciliation | Cold boot sweep re-registering missing alerts | M2 | Survey |
| F10 | `+15m` Snooze Calculation | Adds 15m to $\max(T_{now}, T_{due})$ with seconds normalized to 00 | M1 (DONE) | Survey |
| F11 | `+1h` Snooze Calculation | Adds 60m to $\max(T_{now}, T_{due})$ with seconds normalized to 00 | M1 (DONE) | Survey |
| F12 | `This Evening` Snooze Calculation | Sets to 19:00 today (or tomorrow if past 18:30) | M1 (DONE) | Survey |
| F13 | `Tomorrow Morning` Snooze Calculation | Sets to next day 09:00 local time handling leap/month boundaries | M1 (DONE) | Survey |
| F14 | `Weekend` Snooze Calculation | Advances calendar to upcoming Saturday at 09:00 | M1 (DONE) | Survey |
| F15 | Custom Interval & Date Picker | Granular custom time picker and numeric offset selector | M1 (DONE), M3 | Survey |
| F16 | Quick-Capture Bar | Anchored input bar for frictionless single-line task creation | M3 | Survey |
| F17 | Quick-Capture Time Chips | Horizontal preset chips (`+15m`, `+1h`, `Tonight`, `Tomorrow 9am`) | M3 | Survey |
| F18 | Granular Rescheduling Sheet | Bottom sheet modal with 6 preset pills & custom picker | M3 | Survey |
| F19 | Swiss Minimalist Typography & Layout | High-contrast editorial aesthetic, asymmetric grid, tabular numbers | M3 | Survey |
| F20 | Theme Engine (Light/Dark/Void) | Light (broadsheet), Dark (slate), Void (pure OLED #000000 + orange) | M3 | Survey |
| F21 | Overdue Task Indication | High-contrast visual marker and elapsed time indicator | M3 | Survey |
| F22 | Swipe Actions on Task Cards | Swipe right to Snooze, swipe left to Complete | M3 | Survey |
| F23 | Notification Permission Handling | Detects denied permissions, non-blocking warning, settings link | M2 | Survey |
| F24 | TypeScript Full-Coverage Type Safety | Complete types exported throughout codebase (`npx tsc --noEmit` clean) | M1 (DONE), M4 | Survey |
| F25 | Automated Unit Test Suite | 100% automated test pass rate for domain logic and storage | M1 (DONE), M4 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Foundation, Core Domain Engine, Storage & Snooze Math | Expo SDK project setup, TypeScript configuration, Jest harness, domain types, state machine, snooze calculation algorithms ($T_{base}$), AsyncStorage repository with in-memory cache, 100% unit tests | none | **DONE** |
| M2 | Actionable Notifications & Background Rescheduling Service | Android MAX channel, `remy_reminder_actions` category, background TaskManager handler, foreground listener, alarm scheduling, cold-boot reconciliation, Web safety fallback | M1 | IN_PROGRESS |
| M3 | Swiss Minimalist UI, Theme Triad & Quick-Capture / Snooze Sheet | Typography tokens, tabular nums, baseline grid, Theme Triad (Light, Dark, Void), Masthead, QuickCaptureBar with chips, ReminderCard ledger rows, Granular SnoozeModal, EmptyState manifesto | M1, M2 | PLANNED |
| M4 | Open-Source Documentation, Final Verification & Hardening | Production README.md with architecture diagrams & setup guide, MIT LICENSE, `npx tsc --noEmit` verification, `npx expo start` verification, 100% automated test run | M1, M2, M3 | PLANNED |

## Interface Contracts

### Domain Types (`src/types/reminder.ts`)
```typescript
export type ReminderStatus = 'pending' | 'snoozed' | 'completed';
export type SnoozePreset = '15m' | '1h' | 'evening' | 'tomorrow_morning' | 'weekend' | 'custom';

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  dueDate: string; // ISO 8601 string
  status: ReminderStatus;
  snoozeCount: number;
  lastSnoozedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  notificationId?: string | null;
}

export interface CreateReminderInput {
  title: string;
  notes?: string | null;
  dueDate: string;
}

export interface UpdateReminderInput {
  title?: string;
  notes?: string | null;
  dueDate?: string;
  status?: ReminderStatus;
}
```

### Storage Repository Interface (`src/services/storageService.ts`)
```typescript
export interface IReminderRepository {
  init(): Promise<void>;
  getAll(): Reminder[];
  getById(id: string): Reminder | undefined;
  create(input: CreateReminderInput): Promise<Reminder>;
  update(id: string, updates: UpdateReminderInput): Promise<Reminder>;
  snooze(id: string, targetDate: Date, preset?: SnoozePreset): Promise<Reminder>;
  toggleComplete(id: string): Promise<Reminder>;
  delete(id: string): Promise<boolean>;
  reconcileActiveReminders(): Promise<Reminder[]>;
}
```

### Notification Service Interface (`src/services/notificationService.ts`)
```typescript
export interface INotificationService {
  init(): Promise<void>;
  requestPermissions(): Promise<boolean>;
  scheduleReminderNotification(reminder: Reminder): Promise<string | null>;
  cancelReminderNotification(notificationId: string): Promise<void>;
  handleNotificationResponse(actionIdentifier: string, reminderId: string): Promise<void>;
}
```

### Theme Contract (`src/theme/types.ts`)
```typescript
export type ThemeMode = 'light' | 'dark' | 'void';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSubtle: string;
  danger: string;
  warning: string;
  success: string;
}
```

## Code Layout
```
├── app.json                     # Expo configuration
├── package.json                 # Dependencies & scripts
├── tsconfig.json                # TypeScript configuration
├── babel.config.js              # Babel presets
├── jest.config.js               # Jest configuration
├── App.tsx                      # Root application entry
├── src/
│   ├── types/                   # TypeScript interfaces and domain types
│   │   ├── reminder.ts
│   │   ├── theme.ts
│   │   └── index.ts
│   ├── theme/                   # Swiss Design tokens and theme engine
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   ├── spacing.ts
│   │   ├── ThemeContext.tsx
│   │   └── index.ts
│   ├── utils/                   # Business logic and algorithms
│   │   ├── snoozeCalculator.ts  # T_base math and presets
│   │   ├── dateFormatting.ts    # Tabular date and time formatters
│   │   └── idGenerator.ts       # UUID v4 generator
│   ├── services/                # Infrastructure & persistence
│   │   ├── storageService.ts    # AsyncStorage + in-memory cache
│   │   ├── notificationService.ts # Expo notifications & background task
│   │   └── backgroundTask.ts    # TaskManager background action handler
│   ├── hooks/                   # React hooks
│   │   ├── useReminders.ts      # Reactive reminder state & mutations
│   │   └── useNotifications.ts  # Setup, listeners & permissions
│   ├── components/              # Swiss UI Components
│   │   ├── Masthead.tsx         # Editorial date masthead & counters
│   │   ├── QuickCaptureBar.tsx  # Frictionless task entry with chips
│   │   ├── ReminderCard.tsx     # Ledger row with tabular time & snooze badge
│   │   ├── ReminderList.tsx     # Scrollable task ledger
│   │   ├── SnoozeModal.tsx      # Granular rescheduling sheet
│   │   ├── ThemeToggle.tsx      # Triad theme switcher
│   │   └── EmptyState.tsx       # "MEMORY STACK CLEAR" manifesto
│   └── screens/
│       └── HomeScreen.tsx       # Master Swiss screen layout
├── tests/                       # Automated test suite
│   ├── snoozeCalculator.test.ts # Snooze calculation unit tests
│   ├── storageService.test.ts   # Repository CRUD & caching tests
│   ├── stateMachine.test.ts     # Lifecycle transition tests
│   └── mocks/                   # Test mocks for storage & notifications
├── README.md                    # System architecture & setup documentation
└── LICENSE                      # MIT License
```
