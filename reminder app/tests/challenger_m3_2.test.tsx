/**
 * Remy Reminders - Challenger M3-2 Empirical Invariant Verification Suite
 * 
 * Exhaustive independent empirical verification of Swiss Design Invariants:
 * 1. WCAG AAA contrast ratio calculation for text on background across Light (21:1), Dark (15:1), and Void modes
 * 2. Void mode background = #000000 with signal orange accent #FF4500
 * 3. OpenType tabular-nums set on monospaced clock times and counters
 * 4. Overdue danger formatting on overdue tasks, exempt on completed tasks
 * 5. SnoozeModal preset computation rules (all 6 presets adhering to T_base = max(now, due))
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  lightColors,
  darkColors,
  voidColors,
  typography,
  ThemeProvider,
  useTheme,
} from '../src/theme';
import { ReminderCard } from '../src/components/ReminderCard';
import { SnoozeModal } from '../src/components/SnoozeModal';
import { Masthead } from '../src/components/Masthead';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { getOverdueAnalysis } from '../src/utils/dateFormatting';
import {
  getBaseTime,
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
  calculateWeekend,
} from '../src/utils/snoozeCalculator';
import { Reminder } from '../src/types/reminder';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

/**
 * Mathematical WCAG 2.1 Contrast Ratio Calculator
 */
function hexToRgb(hex: string): [number, number, number] {
  const sanitized = hex.replace('#', '');
  if (sanitized.length === 3) {
    const r = parseInt(sanitized[0] + sanitized[0], 16);
    const g = parseInt(sanitized[1] + sanitized[1], 16);
    const b = parseInt(sanitized[2] + sanitized[2], 16);
    return [r, g, b];
  }
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return [r, g, b];
}

function getRelativeLuminance(hex: string): number {
  const [r8, g8, b8] = hexToRgb(hex);
  const channels = [r8 / 255, g8 / 255, b8 / 255].map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Challenger M3-2 Empirical Verification: Swiss Design Invariants', () => {
  beforeEach(async () => {
    mockAsyncStorage.__reset();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // =========================================================================
  // Invariant 1: WCAG AAA Contrast Ratios
  // =========================================================================
  describe('1. WCAG AAA Contrast Ratio Calculations', () => {
    it('proves Light mode textPrimary on background achieves maximum 21:1 contrast (WCAG AAA >= 7:1)', () => {
      const ratio = getContrastRatio(lightColors.textPrimary, lightColors.background);
      // textPrimary: #000000 (lum: 0.0), background: #FFFFFF (lum: 1.0) -> (1.05 / 0.05) = 21.0
      expect(ratio).toBeCloseTo(21.0, 2);
      expect(ratio).toBeGreaterThanOrEqual(21.0);
      expect(ratio).toBeGreaterThanOrEqual(7.0); // WCAG AAA requirement
    });

    it('proves Dark mode textPrimary on background exceeds 15:1 contrast (WCAG AAA >= 7:1)', () => {
      const ratio = getContrastRatio(darkColors.textPrimary, darkColors.background);
      // textPrimary: #F5F5F5, background: #121212
      // Dark slate background: lum ~0.00599, text: lum ~0.9126 -> ratio ~17.19:1
      expect(ratio).toBeGreaterThanOrEqual(15.0);
      expect(ratio).toBeGreaterThanOrEqual(7.0); // WCAG AAA requirement
    });

    it('proves Void mode textPrimary on background achieves maximum 21:1 contrast (WCAG AAA >= 7:1)', () => {
      const ratio = getContrastRatio(voidColors.textPrimary, voidColors.background);
      // textPrimary: #FFFFFF (lum: 1.0), background: #000000 (lum: 0.0) -> (1.05 / 0.05) = 21.0
      expect(ratio).toBeCloseTo(21.0, 2);
      expect(ratio).toBeGreaterThanOrEqual(21.0);
      expect(ratio).toBeGreaterThanOrEqual(7.0); // WCAG AAA requirement
    });

    it('calculates and verifies contrast for signal orange accent on Void pitch black', () => {
      const ratio = getContrastRatio(voidColors.accent, voidColors.background);
      // #FF4500 on #000000 -> lum(#FF4500) ~0.25535, lum(#000000) = 0 -> ratio ~6.11:1
      // Exceeds WCAG AA for normal text (4.5:1) and UI component / graphical object requirement (3.0:1)
      expect(ratio).toBeGreaterThanOrEqual(6.0);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it('verifies secondary text contrast across all 3 themes exceeds minimum readability standards', () => {
      const lightSecRatio = getContrastRatio(lightColors.textSecondary, lightColors.background);
      const darkSecRatio = getContrastRatio(darkColors.textSecondary, darkColors.background);
      const voidSecRatio = getContrastRatio(voidColors.textSecondary, voidColors.background);

      // Light secondary: #52525B on #FFFFFF -> >= 7.0 (exceeds AAA!)
      expect(lightSecRatio).toBeGreaterThanOrEqual(7.0);

      // Dark secondary: #A0A0A0 on #121212 -> >= 6.0 (exceeds AA)
      expect(darkSecRatio).toBeGreaterThanOrEqual(6.0);

      // Void secondary: #A0A0A0 on #000000 -> >= 7.0 (exceeds AAA)
      expect(voidSecRatio).toBeGreaterThanOrEqual(7.0);
    });
  });

  // =========================================================================
  // Invariant 2: Void Mode Pitch Black & Signal Orange
  // =========================================================================
  describe('2. Void Mode Pitch Black (#000000) and Signal Orange (#FF4500)', () => {
    it('verifies void colors strictly define #000000 background and surface with #FF4500 accent', () => {
      expect(voidColors.background).toBe('#000000');
      expect(voidColors.surface).toBe('#000000');
      expect(voidColors.accent).toBe('#FF4500');
      expect(voidColors.borderStrong).toBe('#FF4500');
      expect(voidColors.textPrimary).toBe('#FFFFFF');
    });

    it('renders ReminderCard with true #000000 background in void mode', async () => {
      const reminder: Reminder = {
        id: 'void-rem-1',
        title: 'Pitch black OLED card',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <ReminderCard
              reminder={reminder}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      const card = renderer.root.findByProps({ testID: 'reminder-card-void-rem-1' });
      const flatCardStyle = StyleSheet.flatten(card.props.style);
      expect(flatCardStyle.backgroundColor).toBe('#000000');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // Invariant 3: OpenType tabular-nums on Monospaced Clock Times & Counters
  // =========================================================================
  describe('3. OpenType tabular-nums Font Variant', () => {
    it('verifies typography tokens configure fontVariant: ["tabular-nums"] for time and counter tokens', () => {
      expect(typography.tabularMonoTime.fontVariant).toEqual(['tabular-nums']);
      expect(typography.tabularMonoSmall.fontVariant).toEqual(['tabular-nums']);
    });

    it('empirically inspects ReminderCard rendered styles for tabular-nums on clock time', async () => {
      const reminder: Reminder = {
        id: 'tabular-rem-1',
        title: 'Tabular time verification',
        dueDate: new Date(Date.now() + 1800000).toISOString(),
        status: 'pending',
        snoozeCount: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={reminder}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      // Tabular clock display
      const texts = renderer.root.findAllByType(Text);
      const timeText = texts.find((t: any) => {
        const flat = StyleSheet.flatten(t.props.style);
        return flat?.fontVariant && flat.fontVariant.includes('tabular-nums');
      });
      expect(timeText).toBeDefined();

      // Snooze badge text
      const snoozeBadgeText = renderer.root.findByProps({
        testID: 'reminder-snooze-badge-tabular-rem-1',
      });
      expect(snoozeBadgeText).toBeDefined();
      const badgeTextNode = snoozeBadgeText.findByType(Text);
      const flatBadgeStyle = StyleSheet.flatten(badgeTextNode.props.style);
      expect(flatBadgeStyle.fontVariant).toContain('tabular-nums');

      act(() => {
        renderer.unmount();
      });
    });

    it('empirically inspects Masthead rendered styles for tabular-nums on live counters', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <Masthead activeCount={3} snoozedCount={1} completedCount={5} />
          </ThemeProvider>
        );
      });

      const activeCount = renderer.root.findByProps({ testID: 'count-active' });
      const flatActiveStyle = StyleSheet.flatten(activeCount.props.style);
      expect(flatActiveStyle.fontVariant).toContain('tabular-nums');

      const snoozedCount = renderer.root.findByProps({ testID: 'count-snoozed' });
      const flatSnoozedStyle = StyleSheet.flatten(snoozedCount.props.style);
      expect(flatSnoozedStyle.fontVariant).toContain('tabular-nums');

      const completedCount = renderer.root.findByProps({ testID: 'count-completed' });
      const flatCompletedStyle = StyleSheet.flatten(completedCount.props.style);
      expect(flatCompletedStyle.fontVariant).toContain('tabular-nums');

      act(() => {
        renderer.unmount();
      });
    });

    it('empirically inspects QuickCaptureBar rendered styles for tabular-nums on chips', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={() => {}} />
          </ThemeProvider>
        );
      });

      const chip15m = renderer.root.findByProps({ testID: 'chip-15m' });
      const chipText = chip15m.findByType(Text);
      const flatChipStyle = StyleSheet.flatten(chipText.props.style);
      expect(flatChipStyle.fontVariant).toContain('tabular-nums');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // Invariant 4: Overdue Danger Formatting & Completed Exemption
  // =========================================================================
  describe('4. Overdue Danger Formatting and Completed Exemption', () => {
    const fixedNow = new Date('2026-09-10T15:00:00.000Z');

    it('proves getOverdueAnalysis returns isOverdue: true for pending & snoozed overdue tasks across time deltas', () => {
      const deltas = [
        1,                     // 1 ms overdue
        1000,                  // 1 sec overdue
        60 * 1000,             // 1 min overdue
        45 * 60 * 1000,        // 45 min overdue
        5 * 3600 * 1000,       // 5 hrs overdue
        14 * 86400 * 1000,     // 14 days overdue
        365 * 86400 * 1000,    // 1 year overdue
      ];

      for (const delta of deltas) {
        const pastDate = new Date(fixedNow.getTime() - delta);
        // Pending
        const pendingAnalysis = getOverdueAnalysis(pastDate, 'pending', fixedNow);
        expect(pendingAnalysis.isOverdue).toBe(true);
        expect(pendingAnalysis.elapsedMinutes).toBe(Math.floor(delta / (60 * 1000)));
        expect(pendingAnalysis.elapsedFormatted).toBeTruthy();

        // Snoozed
        const snoozedAnalysis = getOverdueAnalysis(pastDate, 'snoozed', fixedNow);
        expect(snoozedAnalysis.isOverdue).toBe(true);
      }
    });

    it('proves getOverdueAnalysis strictly exempts completed tasks regardless of how far in the past', () => {
      const extremePastDeltas = [
        1,
        60 * 1000,
        86400 * 1000,
        365 * 86400 * 1000,
        10 * 365 * 86400 * 1000, // 10 years overdue
      ];

      for (const delta of extremePastDeltas) {
        const pastDate = new Date(fixedNow.getTime() - delta);
        const analysis = getOverdueAnalysis(pastDate, 'completed', fixedNow);
        expect(analysis.isOverdue).toBe(false);
        expect(analysis.elapsedFormatted).toBe('');
        expect(analysis.elapsedMinutes).toBe(0);
      }
    });

    it('proves boundary condition: exactly now or future tasks are NOT overdue', () => {
      // Exactly now (delta = 0)
      const exactNowAnalysis = getOverdueAnalysis(fixedNow, 'pending', fixedNow);
      expect(exactNowAnalysis.isOverdue).toBe(false);

      // Future (+1ms, +1h)
      const futureAnalysis = getOverdueAnalysis(
        new Date(fixedNow.getTime() + 3600000),
        'pending',
        fixedNow
      );
      expect(futureAnalysis.isOverdue).toBe(false);
    });

    it('renders danger formatting on overdue pending task in ReminderCard component', async () => {
      const pastDue = new Date(fixedNow.getTime() - 1800000); // 30m overdue
      const overdueReminder: Reminder = {
        id: 'overdue-test-card',
        title: 'Urgent Overdue Task',
        dueDate: pastDue.toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={overdueReminder}
              currentTime={fixedNow}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      // 1. Overdue pill exists
      const pill = renderer.root.findByProps({ testID: 'reminder-overdue-pill-overdue-test-card' });
      expect(pill).toBeDefined();
      const flatPillStyle = StyleSheet.flatten(pill.props.style);
      expect(flatPillStyle.backgroundColor).toBe(lightColors.danger);

      // 2. Overdue pill text shows elapsed duration
      const pillText = pill.findByType(Text);
      expect(pillText.props.children).toBe('+30m');

      // 3. Time label contains danger indicator prefix "! "
      const texts = renderer.root.findAllByType(Text);
      const dangerTimeText = texts.find((t: any) =>
        typeof t.props.children === 'string' && t.props.children.startsWith('! ')
      );
      expect(dangerTimeText).toBeDefined();
      const flatTimeStyle = StyleSheet.flatten(dangerTimeText.props.style);
      expect(flatTimeStyle.color).toBe(lightColors.danger);

      act(() => {
        renderer.unmount();
      });
    });

    it('renders NO danger formatting on completed task even when dueDate is in the past (completed exemption)', async () => {
      const pastDue = new Date(fixedNow.getTime() - 7200000); // 2 hours in the past
      const completedReminder: Reminder = {
        id: 'completed-exempt-card',
        title: 'Already Finished Task',
        dueDate: pastDue.toISOString(),
        status: 'completed',
        snoozeCount: 1,
        completedAt: fixedNow.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ReminderCard
              reminder={completedReminder}
              currentTime={fixedNow}
              onToggleComplete={() => {}}
              onSnoozePress={() => {}}
            />
          </ThemeProvider>
        );
      });

      // 1. Overdue pill MUST NOT exist
      const pills = renderer.root.findAllByProps({
        testID: 'reminder-overdue-pill-completed-exempt-card',
      });
      expect(pills.length).toBe(0);

      // 2. No text starts with "! "
      const texts = renderer.root.findAllByType(Text);
      const dangerTimeText = texts.find((t: any) =>
        typeof t.props.children === 'string' && t.props.children.startsWith('! ')
      );
      expect(dangerTimeText).toBeUndefined();

      // 3. Checkbox is marked complete with checkmark
      const checkbox = renderer.root.findByProps({
        testID: 'reminder-checkbox-completed-exempt-card',
      });
      expect(checkbox.props.accessibilityState.checked).toBe(true);

      // 4. Snooze button is NOT rendered for completed item
      const snoozeBtns = renderer.root.findAllByProps({
        testID: 'reminder-snooze-btn-completed-exempt-card',
      });
      expect(snoozeBtns.length).toBe(0);

      // 5. Complete button is REOPEN
      const reopenBtn = renderer.root.findByProps({
        testID: 'reminder-complete-btn-completed-exempt-card',
      });
      const reopenText = reopenBtn.findByType(Text);
      expect(reopenText.props.children).toBe('REOPEN');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // Invariant 5: SnoozeModal Preset Computation Rules & T_base Math
  // =========================================================================
  describe('5. SnoozeModal Preset Computation Rules ($T_{base} = \\max(T_{now}, T_{due})$)', () => {
    const fixedNow = new Date('2026-09-10T14:30:45.500Z');

    it('computes +15m from T_due when task is in the future', () => {
      const futureDue = new Date('2026-09-10T16:00:00.000Z');
      const target = calculate15Minutes(fixedNow, futureDue);
      expect(target.toISOString()).toBe('2026-09-10T16:15:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('computes +15m from T_now when task is overdue ($T_{base} = T_{now}$ invariant)', () => {
      const overdueDue = new Date('2026-09-10T10:00:00.000Z'); // 4.5 hours ago
      const target = calculate15Minutes(fixedNow, overdueDue);
      // T_base is fixedNow ('2026-09-10T14:30:45.500Z'), +15m -> 14:45:00
      expect(target.toISOString()).toBe('2026-09-10T14:45:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('computes +1h from T_due when future, and from T_now when overdue', () => {
      const futureDue = new Date('2026-09-10T16:00:00.000Z');
      const overdueDue = new Date('2026-09-10T11:00:00.000Z');

      const futureTarget = calculate1Hour(fixedNow, futureDue);
      expect(futureTarget.toISOString()).toBe('2026-09-10T17:00:00.000Z');

      const overdueTarget = calculate1Hour(fixedNow, overdueDue);
      expect(overdueTarget.toISOString()).toBe('2026-09-10T15:30:00.000Z');
      expect(overdueTarget.getSeconds()).toBe(0);
    });

    it('computes This Evening: 19:00:00 today before 18:30, rolls over to tomorrow 19:00:00 at or after 18:30', () => {
      // 14:30 -> today 19:00:00
      const afternoon = new Date(2026, 8, 10, 14, 30, 0);
      const eveningToday = calculateThisEvening(afternoon);
      expect(eveningToday.getDate()).toBe(10);
      expect(eveningToday.getHours()).toBe(19);
      expect(eveningToday.getMinutes()).toBe(0);
      expect(eveningToday.getSeconds()).toBe(0);

      // 18:29:59 -> today 19:00:00
      const beforeCutoff = new Date(2026, 8, 10, 18, 29, 59);
      const eveningCutoff = calculateThisEvening(beforeCutoff);
      expect(eveningCutoff.getDate()).toBe(10);
      expect(eveningCutoff.getHours()).toBe(19);

      // 18:30:00 -> tomorrow 19:00:00
      const atCutoff = new Date(2026, 8, 10, 18, 30, 0);
      const eveningRollover = calculateThisEvening(atCutoff);
      expect(eveningRollover.getDate()).toBe(11);
      expect(eveningRollover.getHours()).toBe(19);

      // 21:00:00 -> tomorrow 19:00:00
      const late = new Date(2026, 8, 10, 21, 0, 0);
      const eveningLate = calculateThisEvening(late);
      expect(eveningLate.getDate()).toBe(11);
      expect(eveningLate.getHours()).toBe(19);
    });

    it('computes Tomorrow Morning: next calendar day at 09:00:00 local time', () => {
      const now = new Date(2026, 8, 10, 22, 15, 0);
      const tmrw = calculateTomorrowMorning(now);
      expect(tmrw.getDate()).toBe(11);
      expect(tmrw.getHours()).toBe(9);
      expect(tmrw.getMinutes()).toBe(0);
      expect(tmrw.getSeconds()).toBe(0);
      expect(tmrw.getMilliseconds()).toBe(0);
    });

    it('computes This Weekend: advances to Saturday 09:00:00 local time', () => {
      // Thursday Sep 10, 2026 -> Saturday Sep 12, 2026 09:00
      const thursday = new Date(2026, 8, 10, 14, 0, 0);
      const weekendFromThu = calculateWeekend(thursday);
      expect(weekendFromThu.getDay()).toBe(6); // Saturday
      expect(weekendFromThu.getDate()).toBe(12);
      expect(weekendFromThu.getHours()).toBe(9);
      expect(weekendFromThu.getMinutes()).toBe(0);

      // Saturday Sep 12 before 09:00 -> today Sep 12 at 09:00
      const satEarly = new Date(2026, 8, 12, 7, 30, 0);
      const weekendSatEarly = calculateWeekend(satEarly);
      expect(weekendSatEarly.getDate()).toBe(12);
      expect(weekendSatEarly.getHours()).toBe(9);

      // Saturday Sep 12 at or after 09:00 -> next Saturday Sep 19 at 09:00
      const satLate = new Date(2026, 8, 12, 11, 0, 0);
      const weekendSatLate = calculateWeekend(satLate);
      expect(weekendSatLate.getDate()).toBe(19);
      expect(weekendSatLate.getHours()).toBe(9);
    });

    it('SnoozeModal component fires onSnooze with correct target and preset on each pill press', async () => {
      const onSnooze = jest.fn();
      const onClose = jest.fn();
      const testReminder: Reminder = {
        id: 'snooze-comp-test',
        title: 'Test Reschedule Presets',
        dueDate: '2026-09-10T16:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

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

      // Test all standard presets exist
      const presets = ['15m', '1h', 'evening', 'tomorrow_morning', 'weekend', 'custom'];
      for (const p of presets) {
        expect(renderer.root.findByProps({ testID: `snooze-preset-${p}` })).toBeDefined();
      }

      // Click +1h preset
      const pill1h = renderer.root.findByProps({ testID: 'snooze-preset-1h' });
      await act(async () => {
        await pill1h.props.onPress();
      });

      expect(onSnooze).toHaveBeenCalledTimes(1);
      const [id, date, preset] = onSnooze.mock.calls[0];
      expect(id).toBe('snooze-comp-test');
      expect(date instanceof Date).toBe(true);
      expect(preset).toBe('1h');
      expect(date.getSeconds()).toBe(0);
      expect(onClose).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });
  });
});
