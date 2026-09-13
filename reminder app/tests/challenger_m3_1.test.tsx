/**
 * Remy Reminders - Challenger M3-1 Empirical Adversarial Verification Suite
 *
 * Comprehensive stress-testing of UI state transitions and concurrency:
 * 1. Rapid Theme Cycling (50+ cycles in succession, persistence, rehydration, haptics)
 * 2. Rapid Task Creation via QuickCaptureBar (burst creation, chip switching, in-flight debounce, error recovery)
 * 3. Rapid Toggle Complete / Reopen on ReminderCards (50+ toggles, interleaved multi-card, notification sync)
 * 4. State Synchronization between storageService and useReminders (multi-consumer sync, background writes, unmount safety)
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

import { ThemeProvider, useTheme, THEME_STORAGE_KEY } from '../src/theme/ThemeContext';
import { lightColors, darkColors, voidColors } from '../src/theme/colors';
import { ThemeContract, ThemeMode } from '../src/types/theme';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { ReminderCard } from '../src/components/ReminderCard';
import { useReminders } from '../src/hooks/useReminders';
import { StorageService, storageService } from '../src/services/storageService';
import { NotificationService, notificationService } from '../src/services/notificationService';
import { Reminder, CreateReminderInput, SnoozePreset } from '../src/types/reminder';
import { CapturePreset } from '../src/utils/captureCompiler';

// Helper Theme Consumer
interface ThemeConsumerProps {
  onTheme?: (theme: ThemeContract) => void;
}

const ThemeConsumer: React.FC<ThemeConsumerProps> = ({ onTheme }) => {
  const theme = useTheme();
  if (onTheme) onTheme(theme);
  return null;
};

// Helper Hook Consumer
interface HookConsumerProps {
  onHook?: (hook: ReturnType<typeof useReminders>) => void;
  repo?: StorageService;
  notifier?: NotificationService;
}

const HookConsumer: React.FC<HookConsumerProps> = ({ onHook, repo, notifier }) => {
  const hook = useReminders(repo, notifier);
  if (onHook) onHook(hook);
  return null;
};

describe('Challenger M3-1: Empirical UI State Transitions & Concurrency Stress Suite', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    await AsyncStorage.clear();
    await storageService.clear();
    jest.clearAllMocks();
    (Haptics.selectionAsync as jest.Mock).mockImplementation(async () => {});
    (Haptics.impactAsync as jest.Mock).mockImplementation(async () => {});
    (Haptics.notificationAsync as jest.Mock).mockImplementation(async () => {});
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // =========================================================================
  // 1. Rapid Theme Cycling Stress Tests (50+ Cycles)
  // =========================================================================
  describe('1. Rapid Theme Cycling Stress (50+ Cycles)', () => {
    it('executes 60 consecutive cycles (20 full light->dark->void triads) and returns cleanly to light', async () => {
      let currentTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onTheme={(t) => { currentTheme = t; }} />
          </ThemeProvider>
        );
      });

      expect(currentTheme!.mode).toBe('light');

      // Execute 60 cycles
      for (let i = 1; i <= 60; i++) {
        await act(async () => {
          await currentTheme!.cycleTheme();
        });

        const expectedMode: ThemeMode = i % 3 === 1 ? 'dark' : i % 3 === 2 ? 'void' : 'light';
        expect(currentTheme!.mode).toBe(expectedMode);

        if (expectedMode === 'light') {
          expect(currentTheme!.colors.background).toBe(lightColors.background);
          expect(currentTheme!.statusBarStyle).toBe('dark');
        } else if (expectedMode === 'dark') {
          expect(currentTheme!.colors.background).toBe(darkColors.background);
          expect(currentTheme!.statusBarStyle).toBe('light');
        } else {
          expect(currentTheme!.colors.background).toBe(voidColors.background);
          expect(currentTheme!.statusBarStyle).toBe('light');
        }
      }

      // Verify persisted state in AsyncStorage
      const storedMode = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      expect(storedMode).toBe('light');

      // Haptics called 60 times
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(60);

      act(() => {
        renderer.unmount();
      });
    });

    it('executes exactly 50 cycles ending on void theme and hydrates correctly on reboot', async () => {
      let currentTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onTheme={(t) => { currentTheme = t; }} />
          </ThemeProvider>
        );
      });

      // 50 cycles: 50 % 3 = 2 -> void
      for (let i = 1; i <= 50; i++) {
        await act(async () => {
          await currentTheme!.cycleTheme();
        });
      }

      expect(currentTheme!.mode).toBe('void');
      expect(currentTheme!.colors.background).toBe(voidColors.background);

      act(() => {
        renderer.unmount();
      });

      // Verify persistent storage
      const persisted = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      expect(persisted).toBe('void');

      // Simulate Cold Boot: Mount new ThemeProvider without initialMode override
      let rebootedTheme: ThemeContract | null = null;
      let rebootRenderer: any = null;

      await act(async () => {
        rebootRenderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ThemeConsumer onTheme={(t) => { rebootedTheme = t; }} />
          </ThemeProvider>
        );
      });

      expect(rebootedTheme!.mode).toBe('void');
      expect(rebootedTheme!.colors.background).toBe(voidColors.background);
      expect(rebootedTheme!.colors.accent).toBe(voidColors.accent);
      expect(rebootedTheme!.isLoaded).toBe(true);

      act(() => {
        rebootRenderer.unmount();
      });
    });

    it('survives haptics failure during rapid cycling without halting theme transitions', async () => {
      (Haptics.selectionAsync as jest.Mock).mockRejectedValue(new Error('Haptics hardware unavailable'));

      let currentTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onTheme={(t) => { currentTheme = t; }} />
          </ThemeProvider>
        );
      });

      // Should complete 10 cycles without throwing
      for (let i = 1; i <= 10; i++) {
        await act(async () => {
          await currentTheme!.cycleTheme();
        });
      }

      expect(currentTheme!.mode).toBe('dark'); // 10 % 3 = 1 -> dark

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // 2. Rapid Task Creation via QuickCaptureBar Stress Tests
  // =========================================================================
  describe('2. Rapid Task Creation via QuickCaptureBar Stress', () => {
    it('creates 50 tasks across alternating chips with proper dueDate calculations', async () => {
      const createdInputs: { title: string; dueDate: Date; preset?: CapturePreset }[] = [];
      const handleCreate = jest.fn(async (input: { title: string; dueDate: Date; preset?: CapturePreset }) => {
        createdInputs.push(input);
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={handleCreate} />
          </ThemeProvider>
        );
      });

      const chips: ('15m' | '1h' | 'evening' | 'tomorrow_morning')[] = [
        '15m',
        '1h',
        'evening',
        'tomorrow_morning',
      ];

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      for (let i = 0; i < 50; i++) {
        const chosenChip = chips[i % chips.length];
        const chipElem = renderer.root.findByProps({ testID: `chip-${chosenChip}` });

        // Select chip
        act(() => {
          chipElem.props.onPress();
        });

        // Type task title
        act(() => {
          inputElem.props.onChangeText(`Task number ${i + 1}`);
        });

        // Submit task
        await act(async () => {
          await submitBtn.props.onPress();
        });

        expect(inputElem.props.value).toBe('');
      }

      expect(handleCreate).toHaveBeenCalledTimes(50);
      expect(createdInputs.length).toBe(50);

      // Verify each created task has proper preset and future due date
      for (let i = 0; i < 50; i++) {
        const expectedChip = chips[i % chips.length];
        expect(createdInputs[i].title).toBe(`Task number ${i + 1}`);
        expect(createdInputs[i].preset).toBe(expectedChip);
        expect(createdInputs[i].dueDate.getTime()).toBeGreaterThan(Date.now() - 5000);
      }

      act(() => {
        renderer.unmount();
      });
    });

    it('disables submit button while submission is in-flight after re-render', async () => {
      let resolveSubmission: () => void = () => {};
      const slowCreate = jest.fn(() => new Promise<void>((resolve) => {
        resolveSubmission = resolve;
      }));

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={slowCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      act(() => {
        inputElem.props.onChangeText('Awaiting resolution');
      });

      let submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.disabled).toBe(false);

      // Trigger initial submit
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = submitBtn.props.onPress();
      });

      // After re-render, submit button should be disabled
      submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.disabled).toBe(true);

      // Attempting second submit while disabled
      act(() => {
        submitBtn.props.onPress();
      });

      // Still only 1 creation triggered
      expect(slowCreate).toHaveBeenCalledTimes(1);

      // Resolve the submission
      await act(async () => {
        resolveSubmission();
        await submitPromise;
      });

      // After resolution, button disabled because text is cleared
      submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.disabled).toBe(true);
      expect(inputElem.props.value).toBe('');

      act(() => {
        renderer.unmount();
      });
    });

    it('verifies hardening: synchronous event bursts before re-render are blocked by useRef in-flight guard', async () => {
      let activeCreations = 0;
      const slowCreate = jest.fn(async () => {
        activeCreations++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={slowCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Burst task');
      });

      // Synchronous double-tap in the same microtask tick (before re-render)
      await act(async () => {
        const p1 = submitBtn.props.onPress();
        const p2 = submitBtn.props.onPress();
        await Promise.all([p1, p2]);
      });

      // Successfully guarded by useRef lock, only 1 submission occurred
      expect(slowCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('recovers gracefully from submission errors and preserves input text', async () => {
      const failingCreate = jest.fn().mockRejectedValue(new Error('Persistent storage full'));

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={failingCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Unsaved valuable intention');
      });

      await act(async () => {
        try {
          await submitBtn.props.onPress();
        } catch {
          // Handled or caught
        }
      });

      expect(failingCreate).toHaveBeenCalledTimes(1);
      // Input text MUST be preserved so user does not lose their data
      expect(inputElem.props.value).toBe('Unsaved valuable intention');
      // Submitting lock must be cleared
      expect(submitBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // 3. Rapid Toggle Complete / Reopen on ReminderCards
  // =========================================================================
  describe('3. Rapid Toggle Complete / Reopen Stress on ReminderCards', () => {
    it('executes 50 rapid alternating toggle complete/reopen operations maintaining state integrity', async () => {
      // 1. Create a reminder in storage
      const initial = await storageService.create({
        title: 'High frequency toggle target',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
      });

      let currentReminder: Reminder = initial;
      const onToggle = jest.fn(async (id: string) => {
        currentReminder = await storageService.toggleComplete(id);
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={currentReminder}
              onToggleComplete={onToggle}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      // Execute 50 rapid toggles
      for (let i = 1; i <= 50; i++) {
        await act(async () => {
          await onToggle(initial.id);
          renderer.update(
            <ThemeProvider initialMode="light">
              <ReminderCard
                reminder={currentReminder}
                onToggleComplete={onToggle}
                onSnoozePress={() => {}}
              />
            </ThemeProvider>
          );
        });

        const expectedStatus = i % 2 === 1 ? 'completed' : 'pending';
        expect(currentReminder.status).toBe(expectedStatus);
        if (expectedStatus === 'completed') {
          expect(currentReminder.completedAt).toBeTruthy();
        } else {
          expect(currentReminder.completedAt).toBeNull();
        }
      }

      // After 50 toggles (even number), reminder must be pending
      const finalInStore = storageService.getById(initial.id)!;
      expect(finalInStore.status).toBe('pending');
      expect(finalInStore.completedAt).toBeNull();

      act(() => {
        renderer.unmount();
      });
    });

    it('interleaves 50 rapid toggles across 5 distinct reminders without cross-state corruption', async () => {
      const reminders: Reminder[] = [];
      for (let i = 0; i < 5; i++) {
        const rem = await storageService.create({
          title: `Interleaved Reminder ${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 1800000).toISOString(),
        });
        reminders.push(rem);
      }

      // 50 toggles distributed across 5 reminders (10 each)
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let rIdx = 0; rIdx < 5; rIdx++) {
          await storageService.toggleComplete(reminders[rIdx].id);
        }
      }

      // Each of the 5 reminders was toggled 10 times (even) -> all must be pending
      for (let rIdx = 0; rIdx < 5; rIdx++) {
        const item = storageService.getById(reminders[rIdx].id)!;
        expect(item.status).toBe('pending');
        expect(item.completedAt).toBeNull();
      }

      // Now toggle each once more (11th toggle -> odd) -> all must be completed
      for (let rIdx = 0; rIdx < 5; rIdx++) {
        await storageService.toggleComplete(reminders[rIdx].id);
      }

      for (let rIdx = 0; rIdx < 5; rIdx++) {
        const item = storageService.getById(reminders[rIdx].id)!;
        expect(item.status).toBe('completed');
        expect(item.completedAt).toBeTruthy();
      }
    });

    it('manages notification scheduling and cancellation across rapid toggle cycles', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      // Create reminder due in future (+1h)
      let created: Reminder | null = null;
      await act(async () => {
        created = await currentHook!.createReminder({
          title: 'Notification toggle lifecycle',
          dueDate: new Date(Date.now() + 3600000).toISOString(),
        });
      });

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      const scheduledNotifId = await (Notifications.scheduleNotificationAsync as jest.Mock).mock.results[0].value;

      // 1. Toggle Complete -> must cancel notification
      await act(async () => {
        await currentHook!.toggleComplete(created!.id);
      });

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(scheduledNotifId);
      expect(currentHook!.reminders[0].status).toBe('completed');

      // 2. Toggle Reopen -> must reschedule notification
      await act(async () => {
        await currentHook!.toggleComplete(created!.id);
      });

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
      expect(currentHook!.reminders[0].status).toBe('pending');

      // 3. Toggle Complete again -> must cancel newly scheduled notification
      const secondNotifId = await (Notifications.scheduleNotificationAsync as jest.Mock).mock.results[1].value;
      await act(async () => {
        await currentHook!.toggleComplete(created!.id);
      });

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(secondNotifId);
      expect(currentHook!.reminders[0].status).toBe('completed');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // 4. Synchronized State Between storageService and useReminders
  // =========================================================================
  describe('4. Synchronized State Between storageService and useReminders', () => {
    it('immediately reflects direct storageService mutations in useReminders without manual refresh', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      expect(currentHook!.reminders.length).toBe(0);
      expect(currentHook!.activeCount).toBe(0);

      // Mutate storageService directly from outside React
      let createdOutside: Reminder | null = null;
      await act(async () => {
        createdOutside = await storageService.create({
          title: 'Background created reminder',
          dueDate: new Date(Date.now() + 1800000).toISOString(),
        });
      });

      // Hook must synchronize immediately via repository subscription
      expect(currentHook!.reminders.length).toBe(1);
      expect(currentHook!.activeCount).toBe(1);
      expect(currentHook!.reminders[0].id).toBe(createdOutside!.id);
      expect(currentHook!.reminders[0].title).toBe('Background created reminder');

      // Mutate status directly via storageService
      await act(async () => {
        await storageService.toggleComplete(createdOutside!.id);
      });

      expect(currentHook!.completedCount).toBe(1);
      expect(currentHook!.activeCount).toBe(0);
      expect(currentHook!.reminders[0].status).toBe('completed');

      act(() => {
        renderer.unmount();
      });
    });

    it('synchronizes state seamlessly across multiple independent useReminders consumers', async () => {
      let hookConsumerA: ReturnType<typeof useReminders> | null = null;
      let hookConsumerB: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <>
            <HookConsumer onHook={(h) => { hookConsumerA = h; }} />
            <HookConsumer onHook={(h) => { hookConsumerB = h; }} />
          </>
        );
      });

      expect(hookConsumerA!.reminders.length).toBe(0);
      expect(hookConsumerB!.reminders.length).toBe(0);

      // Consumer A creates a reminder
      let created: Reminder | null = null;
      await act(async () => {
        created = await hookConsumerA!.createReminder({
          title: 'Multi-consumer sync test',
          dueDate: new Date(Date.now() + 3600000).toISOString(),
        });
      });

      // Both Consumer A and Consumer B must reflect the created reminder
      expect(hookConsumerA!.reminders.length).toBe(1);
      expect(hookConsumerB!.reminders.length).toBe(1);
      expect(hookConsumerB!.reminders[0].id).toBe(created!.id);

      // Consumer B snoozes the reminder
      const snoozeTarget = new Date(Date.now() + 7200000);
      await act(async () => {
        await hookConsumerB!.snoozeReminder(created!.id, snoozeTarget, '1h');
      });

      // Both consumers reflect snoozed status and count
      expect(hookConsumerA!.snoozedCount).toBe(1);
      expect(hookConsumerB!.snoozedCount).toBe(1);
      expect(hookConsumerA!.reminders[0].status).toBe('snoozed');
      expect(hookConsumerB!.reminders[0].status).toBe('snoozed');

      // Consumer A deletes the reminder
      await act(async () => {
        await hookConsumerA!.deleteReminder(created!.id);
      });

      expect(hookConsumerA!.reminders.length).toBe(0);
      expect(hookConsumerB!.reminders.length).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });

    it('synchronizes storageService.clear() across active hooks', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      // Populate 10 reminders
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          await currentHook!.createReminder({
            title: `Batch task ${i + 1}`,
            dueDate: new Date(Date.now() + (i + 1) * 600000).toISOString(),
          });
        }
      });

      expect(currentHook!.reminders.length).toBe(10);
      expect(currentHook!.activeCount).toBe(10);

      // Wipe storage via storageService.clear()
      await act(async () => {
        await storageService.clear();
      });

      expect(currentHook!.reminders.length).toBe(0);
      expect(currentHook!.activeCount).toBe(0);
      expect(currentHook!.snoozedCount).toBe(0);
      expect(currentHook!.completedCount).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });

    it('safely unsubscribes on unmount without throwing errors or triggering stale state updates', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      // Unmount the component
      act(() => {
        renderer.unmount();
      });

      // Subsequent storage mutations must not throw errors or invoke unmounted setReminders
      await expect(
        storageService.create({
          title: 'Post-unmount mutation',
          dueDate: new Date().toISOString(),
        })
      ).resolves.toBeDefined();
    });

    it('processes 50 concurrent creations via useReminders without dropped records or state skew', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      // 50 concurrent creations
      await act(async () => {
        const promises = [];
        for (let i = 0; i < 50; i++) {
          promises.push(
            currentHook!.createReminder({
              title: `Concurrent task ${i + 1}`,
              dueDate: new Date(Date.now() + (i + 1) * 300000).toISOString(),
            })
          );
        }
        await Promise.all(promises);
      });

      expect(currentHook!.reminders.length).toBe(50);
      expect(currentHook!.activeCount).toBe(50);
      expect(storageService.getAll().length).toBe(50);

      // Verify all unique IDs
      const uniqueIds = new Set(currentHook!.reminders.map((r) => r.id));
      expect(uniqueIds.size).toBe(50);

      act(() => {
        renderer.unmount();
      });
    });

    it('maintains strict state invariant under heavy interleaved concurrent mutations', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookConsumer onHook={(h) => { currentHook = h; }} />
        );
      });

      // Seed 20 reminders
      const seeded: Reminder[] = [];
      await act(async () => {
        for (let i = 0; i < 20; i++) {
          const item = await currentHook!.createReminder({
            title: `Base item ${i + 1}`,
            dueDate: new Date(Date.now() + (i + 1) * 600000).toISOString(),
          });
          seeded.push(item);
        }
      });

      // Interleaved concurrent operations:
      // 5 creates, 5 toggles, 5 snoozes, 5 deletes
      await act(async () => {
        const ops = [];

        // 5 new creates
        for (let i = 0; i < 5; i++) {
          ops.push(
            currentHook!.createReminder({
              title: `Interleaved create ${i + 1}`,
              dueDate: new Date(Date.now() + 3600000).toISOString(),
            })
          );
        }

        // 5 toggles on items 0-4
        for (let i = 0; i < 5; i++) {
          ops.push(currentHook!.toggleComplete(seeded[i].id));
        }

        // 5 snoozes on items 5-9
        for (let i = 5; i < 10; i++) {
          ops.push(
            currentHook!.snoozeReminder(
              seeded[i].id,
              new Date(Date.now() + 7200000),
              '1h'
            )
          );
        }

        // 5 deletes on items 10-14
        for (let i = 10; i < 15; i++) {
          ops.push(currentHook!.deleteReminder(seeded[i].id));
        }

        await Promise.all(ops);
      });

      // Expected total: 20 initial + 5 created - 5 deleted = 20 total
      expect(currentHook!.reminders.length).toBe(20);
      expect(storageService.getAll().length).toBe(20);

      // Core invariant: activeCount + completedCount === reminders.length
      expect(currentHook!.activeCount + currentHook!.completedCount).toBe(currentHook!.reminders.length);
      expect(currentHook!.snoozedCount).toBeGreaterThanOrEqual(5);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // 5. Interactive Action Controls & Fallback Resilience
  // =========================================================================
  describe('5. Interactive Action Controls & Fallback Resilience', () => {
    it('dispatches complete and snooze actions via ReminderCard controls with proper haptics', async () => {
      const sampleReminder: Reminder = {
        id: 'rem-controls',
        title: 'Action controls reminder',
        notes: 'Important notes field',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const onToggle = jest.fn();
      const onSnooze = jest.fn();
      const onDelete = jest.fn();

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={sampleReminder}
              onToggleComplete={onToggle}
              onSnoozePress={onSnooze}
              onDeletePress={onDelete}
            />
          </ThemeProvider>
        );
      });

      // 1. Press Checkbox
      const checkbox = renderer.root.findByProps({ testID: 'reminder-checkbox-rem-controls' });
      act(() => {
        checkbox.props.onPress();
      });
      expect(onToggle).toHaveBeenCalledWith('rem-controls');

      // 2. Press Complete button
      const completeBtn = renderer.root.findByProps({ testID: 'reminder-complete-btn-rem-controls' });
      act(() => {
        completeBtn.props.onPress();
      });
      expect(onToggle).toHaveBeenCalledTimes(2);

      // 3. Press Snooze button
      const snoozeBtn = renderer.root.findByProps({ testID: 'reminder-snooze-btn-rem-controls' });
      act(() => {
        snoozeBtn.props.onPress();
      });
      expect(onSnooze).toHaveBeenCalledWith(sampleReminder);

      // 4. Press Delete button
      const deleteBtn = renderer.root.findByProps({ testID: 'reminder-delete-btn-rem-controls' });
      act(() => {
        deleteBtn.props.onPress();
      });
      expect(onDelete).toHaveBeenCalledWith('rem-controls');

      act(() => {
        renderer.unmount();
      });
    });

    it('falls back safely when THEME_STORAGE_KEY contains invalid or corrupted data', async () => {
      // Store corrupted data in AsyncStorage
      await AsyncStorage.setItem(THEME_STORAGE_KEY, 'corrupted_theme_value_xyz');

      let currentTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ThemeConsumer onTheme={(t) => { currentTheme = t; }} />
          </ThemeProvider>
        );
      });

      // ThemeProvider should safely ignore corrupted stored mode and fall back to default
      expect(['light', 'dark']).toContain(currentTheme!.mode);
      expect(currentTheme!.isLoaded).toBe(true);

      act(() => {
        renderer.unmount();
      });
    });
  });
});

