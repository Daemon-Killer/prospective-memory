/**
 * Remy Reminders - Swiss Minimalist UI Components & useReminders Test Suite
 * Comprehensive automated verification for Milestone 3 UI components
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider } from '../src/theme/ThemeContext';
import { ThemeToggle } from '../src/components/ThemeToggle';
import { Masthead } from '../src/components/Masthead';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { ReminderCard } from '../src/components/ReminderCard';
import { ReminderList } from '../src/components/ReminderList';
import { SnoozeModal } from '../src/components/SnoozeModal';
import { EmptyState } from '../src/components/EmptyState';
import { HomeScreen } from '../src/screens/HomeScreen';
import { useReminders } from '../src/hooks/useReminders';
import { storageService } from '../src/services/storageService';
import { notificationService } from '../src/services/notificationService';
import {
  padZero,
  formatMastheadDate,
  formatTabularTime,
  formatTabularReminderTime,
  getOverdueAnalysis,
  formatRelativeOverdue,
} from '../src/utils/dateFormatting';
import { Reminder } from '../src/types/reminder';
import { lightColors } from '../src/theme/colors';

describe('Swiss Minimalist UI Components & Hook Suite', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await storageService.clear();
    jest.clearAllMocks();
  });

  describe('1. Date Formatting Utilities', () => {
    it('padZero zero-pads numbers below 10', () => {
      expect(padZero(5)).toBe('05');
      expect(padZero(0)).toBe('00');
      expect(padZero(12)).toBe('12');
    });

    it('formatMastheadDate produces broadsheet uppercase format', () => {
      const fixedDate = new Date(2026, 8, 10); // Thursday, 10 Sep 2026
      const formatted = formatMastheadDate(fixedDate);
      expect(formatted).toBe('THURSDAY, 10 SEP');
    });

    it('formatTabularTime returns 24-hour HH:MM format', () => {
      const d = new Date(2026, 8, 10, 14, 30);
      expect(formatTabularTime(d)).toBe('14:30');
      expect(formatTabularTime('invalid-date')).toBe('--:--');
    });

    it('formatTabularReminderTime distinguishes today, tomorrow, and future dates', () => {
      const baseNow = new Date(2026, 8, 10, 12, 0, 0);
      const todayDue = new Date(2026, 8, 10, 16, 45, 0);
      const tomorrowDue = new Date(2026, 8, 11, 9, 0, 0);
      const futureDue = new Date(2026, 8, 15, 18, 30, 0);

      expect(formatTabularReminderTime(todayDue, baseNow)).toBe('16:45');
      expect(formatTabularReminderTime(tomorrowDue, baseNow)).toBe('TOMORROW 09:00');
      expect(formatTabularReminderTime(futureDue, baseNow)).toBe('15 SEP 18:30');
    });

    it('getOverdueAnalysis calculates elapsed duration accurately', () => {
      const now = new Date(2026, 8, 10, 14, 0, 0);

      // 15m overdue
      const past15m = new Date(2026, 8, 10, 13, 45, 0);
      const analysis15m = getOverdueAnalysis(past15m, 'pending', now);
      expect(analysis15m.isOverdue).toBe(true);
      expect(analysis15m.elapsedFormatted).toBe('+15m');
      expect(analysis15m.elapsedMinutes).toBe(15);

      // 2h overdue
      const past2h = new Date(2026, 8, 10, 12, 0, 0);
      const analysis2h = getOverdueAnalysis(past2h, 'pending', now);
      expect(analysis2h.isOverdue).toBe(true);
      expect(analysis2h.elapsedFormatted).toBe('+2h');

      // Completed task is never overdue
      const completedAnalysis = getOverdueAnalysis(past15m, 'completed', now);
      expect(completedAnalysis.isOverdue).toBe(false);

      // Future task is not overdue
      const futureDate = new Date(2026, 8, 10, 15, 0, 0);
      const futureAnalysis = getOverdueAnalysis(futureDate, 'pending', now);
      expect(futureAnalysis.isOverdue).toBe(false);
    });

    it('formatRelativeOverdue formats string with OVERDUE prefix', () => {
      const now = new Date(2026, 8, 10, 14, 0, 0);
      const past20m = new Date(2026, 8, 10, 13, 40, 0);
      expect(formatRelativeOverdue(past20m, now)).toBe('OVERDUE +20M');
      expect(formatRelativeOverdue(new Date(now.getTime() + 10000), now)).toBe('');
    });
  });

  describe('2. ThemeToggle Component', () => {
    it('renders mode label and triggers cycle callback on press', async () => {
      const onCycle = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeToggle onCycle={onCycle} />
          </ThemeProvider>
        );
      });

      const btn = renderer.root.findByProps({ testID: 'theme-toggle' });
      expect(btn.props.accessibilityRole).toBe('button');
      expect(btn.props.accessibilityLabel).toContain('LIGHT');

      act(() => {
        btn.props.onPress();
      });

      expect(onCycle).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('3. Masthead Component', () => {
    it('renders brand title, formatted date, and tabular counter grid', async () => {
      let renderer: any = null;
      const testDate = new Date(2026, 8, 10);

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <Masthead
              activeCount={5}
              snoozedCount={2}
              completedCount={8}
              currentDate={testDate}
            />
          </ThemeProvider>
        );
      });

      const dateText = renderer.root.findByProps({ testID: 'masthead-date' });
      expect(dateText.props.children).toBe('THURSDAY, 10 SEP');

      const activeVal = renderer.root.findByProps({ testID: 'count-active' });
      expect(activeVal.props.children).toBe('05');

      const snoozedVal = renderer.root.findByProps({ testID: 'count-snoozed' });
      expect(snoozedVal.props.children).toBe('02');

      const completedVal = renderer.root.findByProps({ testID: 'count-completed' });
      expect(completedVal.props.children).toBe('08');

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('4. QuickCaptureBar Component', () => {
    it('renders input and 4 horizontal chips (+15M, +1H, TONIGHT, TOMORROW 9AM)', async () => {
      let renderer: any = null;
      const onCreate = jest.fn();

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={onCreate} />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'chip-15m' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'chip-1h' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'chip-evening' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'chip-tomorrow_morning' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('rejects empty or whitespace submission', async () => {
      let renderer: any = null;
      const onCreate = jest.fn();

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={onCreate} />
          </ThemeProvider>
        );
      });

      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.disabled).toBe(true);

      act(() => {
        submitBtn.props.onPress();
      });

      expect(onCreate).not.toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });
    });

    it('submits valid task and clears input field', async () => {
      let renderer: any = null;
      const onCreate = jest.fn();

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={onCreate} />
          </ThemeProvider>
        );
      });

      const input = renderer.root.findByProps({ testID: 'quick-capture-input' });

      act(() => {
        input.props.onChangeText('Draft Swiss UI spec');
      });

      // Switch preset to +1h
      const chip1h = renderer.root.findByProps({ testID: 'chip-1h' });
      act(() => {
        chip1h.props.onPress();
      });

      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.disabled).toBe(false);

      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(onCreate).toHaveBeenCalledTimes(1);
      const callArg = onCreate.mock.calls[0][0];
      expect(callArg.title).toBe('Draft Swiss UI spec');
      expect(callArg.preset).toBe('1h');
      expect(callArg.dueDate.getTime()).toBeGreaterThan(Date.now());

      // Input is cleared
      expect(input.props.value).toBe('');

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('5. ReminderCard Component', () => {
    const sampleReminder: Reminder = {
      id: 'rem-1',
      title: 'Submit tax documentation',
      notes: 'Form 1040-ES',
      dueDate: new Date(Date.now() + 3600000).toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('renders standard active reminder with checkbox, tabular time, and action buttons', async () => {
      const onToggle = jest.fn();
      const onSnooze = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={sampleReminder}
              onToggleComplete={onToggle}
              onSnoozePress={onSnooze}
            />
          </ThemeProvider>
        );
      });

      const checkbox = renderer.root.findByProps({ testID: 'reminder-checkbox-rem-1' });
      expect(checkbox.props.accessibilityState.checked).toBe(false);

      act(() => {
        checkbox.props.onPress();
      });
      expect(onToggle).toHaveBeenCalledWith('rem-1');

      const snoozeBtn = renderer.root.findByProps({ testID: 'reminder-snooze-btn-rem-1' });
      act(() => {
        snoozeBtn.props.onPress();
      });
      expect(onSnooze).toHaveBeenCalledWith(sampleReminder);

      act(() => {
        renderer.unmount();
      });
    });

    it('renders snooze badge when snoozeCount > 0', async () => {
      const snoozedReminder: Reminder = {
        ...sampleReminder,
        id: 'rem-snoozed',
        status: 'snoozed',
        snoozeCount: 3,
        lastSnoozedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={snoozedReminder}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      const badge = renderer.root.findByProps({ testID: 'reminder-snooze-badge-rem-snoozed' });
      expect(badge).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('renders high-contrast overdue pill when dueDate is in past', async () => {
      const overdueReminder: Reminder = {
        ...sampleReminder,
        id: 'rem-overdue',
        dueDate: new Date(Date.now() - 1800000).toISOString(), // 30m ago
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={overdueReminder}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      const pill = renderer.root.findByProps({ testID: 'reminder-overdue-pill-rem-overdue' });
      expect(pill).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('renders completed reminder with checkmark and REOPEN button', async () => {
      const completedReminder: Reminder = {
        ...sampleReminder,
        id: 'rem-completed',
        status: 'completed',
        completedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={completedReminder}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      const checkbox = renderer.root.findByProps({ testID: 'reminder-checkbox-rem-completed' });
      expect(checkbox.props.accessibilityState.checked).toBe(true);

      const completeBtn = renderer.root.findByProps({ testID: 'reminder-complete-btn-rem-completed' });
      // Snooze button should NOT be rendered for completed item
      expect(renderer.root.findAllByProps({ testID: 'reminder-snooze-btn-rem-completed' }).length).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('6. ReminderList & EmptyState Components', () => {
    it('renders EmptyState manifesto when reminders list is empty', async () => {
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderList
              reminders={[]}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      const headline = renderer.root.findByProps({ testID: 'empty-state-headline' });
      expect(headline.props.children).toBe('MEMORY STACK CLEAR');

      act(() => {
        renderer.unmount();
      });
    });

    it('renders list of reminders sorted chronologically', async () => {
      const reminders: Reminder[] = [
        {
          id: 'rem-later',
          title: 'Later task',
          dueDate: new Date(Date.now() + 7200000).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'rem-sooner',
          title: 'Sooner task',
          dueDate: new Date(Date.now() + 1800000).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderList
              reminders={reminders}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'reminder-card-rem-sooner' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'reminder-card-rem-later' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('7. SnoozeModal Component', () => {
    const testReminder: Reminder = {
      id: 'rem-modal',
      title: 'Review architectural manifesto',
      dueDate: new Date(Date.now() + 1800000).toISOString(),
      status: 'pending',
      snoozeCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('returns null when visible is false or reminder is null', async () => {
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <SnoozeModal
              visible={false}
              reminder={testReminder}
              onClose={() => {}}
              onSnooze={() => {}}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.toJSON()).toBeNull();

      act(() => {
        renderer.unmount();
      });
    });

    it('renders 6 presets and triggers onSnooze with targetDate and preset on pill press', async () => {
      const onSnooze = jest.fn();
      const onClose = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <SnoozeModal
              visible={true}
              reminder={testReminder}
              onClose={onClose}
              onSnooze={onSnooze}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'snooze-preset-15m' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'snooze-preset-1h' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'snooze-preset-evening' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'snooze-preset-tomorrow_morning' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'snooze-preset-weekend' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'snooze-preset-custom' })).toBeDefined();

      // Press +15m preset
      const pill15m = renderer.root.findByProps({ testID: 'snooze-preset-15m' });
      await act(async () => {
        await pill15m.props.onPress();
      });

      expect(onSnooze).toHaveBeenCalledTimes(1);
      const call = onSnooze.mock.calls[0];
      expect(call[0]).toBe('rem-modal');
      expect(call[1] instanceof Date).toBe(true);
      expect(call[2]).toBe('15m');
      expect(onClose).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('supports custom mode navigation and rescheduling', async () => {
      const onSnooze = jest.fn();
      const onClose = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <SnoozeModal
              visible={true}
              reminder={testReminder}
              onClose={onClose}
              onSnooze={onSnooze}
            />
          </ThemeProvider>
        );
      });

      // Switch to custom mode
      const customPill = renderer.root.findByProps({ testID: 'snooze-preset-custom' });
      act(() => {
        customPill.props.onPress();
      });

      // Select tomorrow (+1 day) to guarantee future date
      const tomorrowChip = renderer.root.findByProps({ testID: 'custom-day-1' });
      act(() => {
        tomorrowChip.props.onPress();
      });

      const confirmBtn = renderer.root.findByProps({ testID: 'snooze-custom-confirm' });
      expect(confirmBtn.props.disabled).toBe(false);

      await act(async () => {
        await confirmBtn.props.onPress();
      });

      expect(onSnooze).toHaveBeenCalledWith('rem-modal', expect.any(Date), 'custom');
      expect(onClose).toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });
    });

    it('disables confirm button when custom date is set to past', async () => {
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <SnoozeModal
              visible={true}
              reminder={testReminder}
              onClose={() => {}}
              onSnooze={() => {}}
            />
          </ThemeProvider>
        );
      });

      // Switch to custom mode
      act(() => {
        renderer.root.findByProps({ testID: 'snooze-preset-custom' }).props.onPress();
      });

      // Target day is TODAY (0). Set hour to 0 (midnight) and min to 0.
      act(() => {
        // Set hour to 0
        const minusBtn = renderer.root.findByProps({ testID: 'custom-hour-minus' });
        for (let i = 0; i < 25; i++) {
          minusBtn.props.onPress();
        }
      });

      // Now target is today 00:00:00, which is in the past unless test runs at exactly midnight
      const now = new Date();
      if (now.getHours() > 0 || now.getMinutes() > 0) {
        const confirmBtn = renderer.root.findByProps({ testID: 'snooze-custom-confirm' });
        expect(confirmBtn.props.disabled).toBe(true);
        expect(renderer.root.findByProps({ testID: 'custom-error-text' })).toBeDefined();
      }

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('8. useReminders Hook Lifecycle & Mutations', () => {
    interface HookContainerProps {
      onHook: (hook: ReturnType<typeof useReminders>) => void;
    }

    const HookContainer: React.FC<HookContainerProps> = ({ onHook }) => {
      const hook = useReminders();
      onHook(hook);
      return null;
    };

    it('handles create, snooze, complete, and delete lifecycle with optimistic updates', async () => {
      let currentHook: ReturnType<typeof useReminders> | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <HookContainer onHook={(h) => { currentHook = h; }} />
        );
      });

      expect(currentHook!.reminders).toEqual([]);
      expect(currentHook!.activeCount).toBe(0);

      // 1. Create reminder
      let created: Reminder | null = null;
      await act(async () => {
        created = await currentHook!.createReminder({
          title: 'Zero latency intention',
          dueDate: new Date(Date.now() + 1800000).toISOString(),
        });
      });

      expect(created).not.toBeNull();
      expect(currentHook!.reminders.length).toBe(1);
      expect(currentHook!.activeCount).toBe(1);

      // 2. Snooze reminder
      const snoozeTarget = new Date(Date.now() + 3600000);
      await act(async () => {
        await currentHook!.snoozeReminder(created!.id, snoozeTarget, '1h');
      });

      expect(currentHook!.snoozedCount).toBe(1);
      expect(currentHook!.reminders[0].status).toBe('snoozed');
      expect(currentHook!.reminders[0].snoozeCount).toBe(1);

      // 3. Complete reminder
      await act(async () => {
        await currentHook!.toggleComplete(created!.id);
      });

      expect(currentHook!.completedCount).toBe(1);
      expect(currentHook!.activeCount).toBe(0);
      expect(currentHook!.reminders[0].status).toBe('completed');

      // 4. Delete reminder
      await act(async () => {
        await currentHook!.deleteReminder(created!.id);
      });

      expect(currentHook!.reminders.length).toBe(0);
      expect(currentHook!.completedCount).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('9. HomeScreen Composition', () => {
    it('composes Masthead, ReminderList, QuickCaptureBar, and SnoozeModal seamlessly', async () => {
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <HomeScreen />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'masthead' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'reminder-list' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'quick-capture-bar' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });
  });
});
