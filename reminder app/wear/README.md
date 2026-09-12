# Remy Reminders - Wear OS 5 Companion Engine

An open-source, offline-first native Wear OS companion application engineered specifically for modern circular smartwatches (optimized for **Samsung Galaxy Watch 7** and **Wear OS 5** / API 34+).

Built around the neuroscience of **Prospective Memory**, the Swiss Void design philosophy, and standalone offline sovereignty.

---

## Architectural Highlights

```
                          ┌─────────────────────────────┐
                          │   Mobile Host (React Native)│
                          └──────────────┬──────────────┘
                                         │  Bluetooth P2P Sync
                                         │  (Wearable DataClient / MessageClient)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Wear OS Standalone Engine                             │
│                                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        Local SQLite Room 2.6.1 DB                       │   │
│   │   • ReminderEntity (UUID v4, 64-bit UTC epoch millis, syncStatus)       │   │
│   │   • ReminderDao (Reactive Flow queries, LWW batch reconciliation)       │   │
│   │   • SnoozeEngine (Strict T_base = max(T_now, T_due) calculation)        │   │
│   └──────────────────────┬───────────────────────────┬──────────────────────┘   │
│                          │                           │                          │
│                          ▼                           ▼                          │
│   ┌──────────────────────────────┐       ┌──────────────────────────────┐       │
│   │  ProtoLayout 1.2 Swipe Tile  │       │ Watch Face Format (WFF v2)   │       │
│   │  • 1-swipe glanceable card   │       │ • Declarative XML watch face │       │
│   │  • Inline +15m / +1h buttons │       │ • Sub-1% Ambient OPR proven  │       │
│   │  • Instant DB re-renders     │       │ • SHORT_TEXT Complication    │       │
│   └──────────────────────────────┘       └──────────────────────────────┘       │
│                          │                           │                          │
│                          ▼                           ▼                          │
│   ┌──────────────────────────────┐       ┌──────────────────────────────┐       │
│   │  Polymorphic Haptic Engine   │       │   Rotary Bezel Controller    │       │
│   │  • Dual-band Meissner (35Hz) │       │   • 28dp detent threshold    │       │
│   │    & Pacinian (220Hz) hopping│       │   • 5-minute quantization    │       │
│   │  • Stochastic temporal jitter│       │   • Tactile detent tick      │       │
│   └──────────────────────────────┘       └──────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Capabilities & Features

### 1. Declarative Swiss Void Watch Face (WFF v2)
- **Watch Face Format v2 XML**: Native co-processor execution conforming to Wear OS 5 standards (`res/raw/watchface.xml`).
- **Sub-1% Ambient OPR**: Pure `#000000` AMOLED canvas with hairline tabular numerals yielding an ambient On-Pixel Ratio of **0.35% to 0.58%** across Galaxy Watch 7 40mm and 44mm displays (mathematically validated in `AmbientOprValidationTest.kt`).
- **Complication Slot 0**: Integrates with `RemyComplicationService` supporting both `SHORT_TEXT` countdowns and `RANGED_VALUE` elapsed progress rings.

### 2. ProtoLayout 1.2 Interactive Swipe Tile
- **1-Swipe Glance**: Accessible directly from the Wear OS carousel.
- **Zero-Foreground Inline Actions**: Users can tap `+15m`, `+1h`, or `Complete` directly on the tile via `ActionBuilders.LoadAction` without opening the app to the foreground.
- **Push-Driven Refresh**: Real-time tile reload triggered on Room mutations.

### 3. Standalone Room Database & Snooze Engine
- **100% Offline Autonomy**: Full Room SQLite engine running on the watch with zero cloud or network dependencies (`com.google.android.wearable.standalone = true`).
- **Strict Baseline Reference Time**: Enforces $T_{base} = \max(T_{now}, T_{due})$ across all snoozes, preventing overdue task drift.
- **Minute-Truncation**: Automatically zeros seconds and milliseconds (`:00.000`) for precision clock alignment.

### 4. Somatosensory Anti-Habituation Haptics
- **Neurobiological Grounding**: Overcomes neural adaptation in primary somatosensory cortex ($S1$) by alternating between low-frequency **Meissner flutter** (35–50 Hz) and high-frequency **Pacinian bursts** (200–300 Hz).
- **Stochastic Temporal Jitter**: Injects $\pm 15$–25ms non-periodic jitter between alert pulses to prevent habituation.
- **Escalation Levels**: Progressively escalates vibration intensity for overdue tasks.

### 5. Digital Rotary Bezel & Crown Dialing
- **Hardware Detent Simulation**: Accumulates capacitive touch bezel or rotary crown movement against a 28dp threshold.
- **Discrete 5-Minute Steps**: Seamlessly increments or decrements snooze intervals eyes-free.
- **Detent Haptic Feedback**: Emits an ultra-subtle 8ms micro-tick on each detent step.

### 6. Bluetooth P2P Synchronization
- **Play Services Wearable Integration**: Ingests reminder batches via `Wearable.DataClient` (`/remy/reminders`) and actionable commands via `MessageClient` (`/remy/action/*`).
- **Last-Write-Wins (LWW)**: Automatic conflict reconciliation based on UTC epoch timestamps with completed-status priority tie-breaking.

---

## Directory Structure

```
wear/
├── src/main/
│   ├── AndroidManifest.xml
│   ├── java/com/remy/wear/
│   │   ├── data/local/
│   │   │   ├── ReminderEntity.kt          # Room SQLite entity
│   │   │   ├── ReminderDao.kt             # Reactive queries & LWW logic
│   │   │   └── RemyDatabase.kt            # Room database singleton
│   │   ├── domain/
│   │   │   ├── SnoozeEngine.kt            # Core temporal snooze math
│   │   │   └── model/                     # Presets & status enums
│   │   ├── haptics/
│   │   │   └── RemyHapticEngine.kt        # Dual-band anti-habituation haptics
│   │   ├── rotary/
│   │   │   └── RotaryBezelController.kt   # Rotary crown / touch bezel controller
│   │   ├── surfaces/
│   │   │   ├── complication/              # Complication service & factory
│   │   │   └── tile/                      # ProtoLayout 1.2 Tile service & layout
│   │   └── sync/
│   │       ├── SyncContracts.kt           # DTOs & JSON serialization codecs
│   │       └── RemyWearableListenerService.kt # Background P2P listener
│   └── res/
│       ├── raw/watchface.xml              # Declarative WFF v2 XML Watch Face
│       ├── xml/watch_face_info.xml        # Declarative wallpaper configuration
│       └── values/                        # Strings and Swiss Void color tokens
└── src/test/java/com/remy/wear/
    ├── data/local/                        # Room DAO & stress tests
    ├── domain/                            # SnoozeEngine & adversarial tests
    ├── haptics/                           # Haptic waveform & jitter tests
    ├── rotary/                            # Rotary detent & quantization tests
    ├── surfaces/                          # ProtoLayout Tile & Complication tests
    ├── sync/                              # P2P serialization & contract tests
    └── wff/                               # Sub-1% Ambient OPR mathematical proofs
```

---

## Building and Verification

### Prerequisites
- JDK 17+
- Android SDK 35 (Platform 34 / 35, Build-Tools 35.0.0)

### Running Automated Tests
```bash
./gradlew test
```
*Current test suite: **11 test classes, 284 automated test executions, 100% pass rate**.*

### Assembling Debug APK
```bash
./gradlew assembleDebug
```
*Generated binary: `build/outputs/apk/debug/remy-wear-debug.apk`.*

### Sideloading to Watch via ADB
```bash
adb connect <WATCH_IP>:5555
adb -s <WATCH_IP>:5555 install build/outputs/apk/debug/remy-wear-debug.apk
```

---

## License
MIT License. Open source and free forever.
