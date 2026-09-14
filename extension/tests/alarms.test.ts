import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ONE_HOUR_MS,
  evaluateStartupGate,
  scheduleAlarm,
  clearAlarm,
  clearAllAlarms,
  updateOverdueBadge,
  handleAlarmEvent,
  handleStartupGate,
} from '../src/services/alarmService';
import { storageService } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';

describe('Alarm Service & Startup Overdue Gate (R4)', () => {
  beforeEach(() => {
    storageService.clearCache();
    vi.clearAllMocks();
  });

  it('defines ONE_HOUR_MS as exactly 3,600,000 ms', () => {
    expect(ONE_HOUR_MS).toBe(3600000);
  });

  describe('scheduleAlarm', () => {
    it('creates persistent chrome.alarm for armed pending reminder', async () => {
      const reminder: Reminder = {
        id: 'rem-1',
        title: 'Meeting in 15m',
        dueDate: '2026-09-14T10:15:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
        armed: true,
      };

      await scheduleAlarm(reminder);

      expect(chrome.alarms.create).toHaveBeenCalledWith('rem-1', {
        when: new Date('2026-09-14T10:15:00.000Z').getTime(),
      });
    });

    it('suppresses alarm creation for unarmed (inbox) reminder', async () => {
      const reminder: Reminder = {
        id: 'rem-inbox',
        title: 'Random idea',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
        armed: false,
      };

      await scheduleAlarm(reminder);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });

    it('suppresses alarm creation for completed or deleted reminders', async () => {
      const completed: Reminder = {
        id: 'rem-done',
        title: 'Done task',
        dueDate: '2026-09-14T10:15:00.000Z',
        status: 'completed',
        snoozeCount: 0,
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
        armed: true,
      };
      await scheduleAlarm(completed);
      expect(chrome.alarms.create).not.toHaveBeenCalled();

      const deleted: Reminder = {
        ...completed,
        status: 'pending',
        isDeleted: true,
      };
      await scheduleAlarm(deleted);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });
  });

  describe('clearAlarm and clearAllAlarms', () => {
    it('clears specific alarm by ID', async () => {
      await clearAlarm('rem-123');
      expect(chrome.alarms.clear).toHaveBeenCalledWith('rem-123');
    });

    it('clears all alarms', async () => {
      await clearAllAlarms();
      expect(chrome.alarms.clearAll).toHaveBeenCalled();
    });
  });

  describe('Startup Overdue Gate Evaluation', () => {
    const nowMs = 1700000000000;

    it('suppresses notifications for reminders overdue by > 1 hour', () => {
      const overdueBy61m: Reminder = {
        id: 'overdue-1',
        title: 'Old alert',
        dueDate: new Date(nowMs - (61 * 60 * 1000)).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(nowMs - 120000).toISOString(),
        updatedAt: new Date(nowMs - 120000).toISOString(),
        armed: true,
      };

      const result = evaluateStartupGate(overdueBy61m, nowMs);
      expect(result).toBe('suppress');
    });

    it('allows notifications for reminders overdue by <= 1 hour', () => {
      const overdueBy15m: Reminder = {
        id: 'recent-1',
        title: 'Recent alert',
        dueDate: new Date(nowMs - (15 * 60 * 1000)).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(nowMs - 120000).toISOString(),
        updatedAt: new Date(nowMs - 120000).toISOString(),
        armed: true,
      };

      const result = evaluateStartupGate(overdueBy15m, nowMs);
      expect(result).toBe('notify');
    });

    it('handles exact 1 hour boundary (3,600,000 ms)', () => {
      const exactly1h: Reminder = {
        id: 'exact-1h',
        title: 'Boundary alert',
        dueDate: new Date(nowMs - ONE_HOUR_MS).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(nowMs - ONE_HOUR_MS).toISOString(),
        updatedAt: new Date(nowMs - ONE_HOUR_MS).toISOString(),
        armed: true,
      };

      expect(evaluateStartupGate(exactly1h, nowMs)).toBe('notify');

      const oneMsPast1h: Reminder = {
        ...exactly1h,
        dueDate: new Date(nowMs - ONE_HOUR_MS - 1).toISOString(),
      };
      expect(evaluateStartupGate(oneMsPast1h, nowMs)).toBe('suppress');
    });
  });

  describe('handleAlarmEvent & Badge Updates', () => {
    it('suppresses notification popup when alarm is overdue by >1h and updates badge with #FF4500', async () => {
      const now = Date.now();
      const oldReminder: Reminder = {
        id: 'old-alarm',
        title: 'Stale task',
        dueDate: new Date(now - (90 * 60 * 1000)).toISOString(), // 90 min overdue
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 100000).toISOString(),
        updatedAt: new Date(now - 100000).toISOString(),
        armed: true,
      };

      await storageService.saveReminder(oldReminder);
      const notifier = vi.fn();

      const outcome = await handleAlarmEvent('old-alarm', notifier);

      expect(outcome).toBe('suppressed');
      expect(notifier).not.toHaveBeenCalled();
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF4500' });
    });

    it('fires notification when alarm is within 1 hour', async () => {
      const now = Date.now();
      const recentReminder: Reminder = {
        id: 'recent-alarm',
        title: 'Current task',
        dueDate: new Date(now - (5 * 60 * 1000)).toISOString(), // 5 min overdue
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 10000).toISOString(),
        updatedAt: new Date(now - 10000).toISOString(),
        armed: true,
      };

      await storageService.saveReminder(recentReminder);
      const notifier = vi.fn();

      const outcome = await handleAlarmEvent('recent-alarm', notifier);

      expect(outcome).toBe('notified');
      expect(notifier).toHaveBeenCalledWith(recentReminder);
    });
  });

  describe('handleStartupGate on cold start', () => {
    it('evaluates all active reminders, suppressing stale alerts and updating badge', async () => {
      const now = Date.now();
      const stale: Reminder = {
        id: 'stale-1',
        title: 'From yesterday',
        dueDate: new Date(now - (24 * 60 * 60 * 1000)).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 86400000).toISOString(),
        updatedAt: new Date(now - 86400000).toISOString(),
        armed: true,
      };
      const recent: Reminder = {
        id: 'recent-1',
        title: 'From 10m ago',
        dueDate: new Date(now - (10 * 60 * 1000)).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 600000).toISOString(),
        updatedAt: new Date(now - 600000).toISOString(),
        armed: true,
      };

      await storageService.saveReminders([stale, recent]);
      const notifier = vi.fn();

      const { overdueCount, suppressedCount, notifiedCount } = await handleStartupGate(notifier);

      expect(overdueCount).toBe(2);
      expect(suppressedCount).toBe(1);
      expect(notifiedCount).toBe(1);
      expect(notifier).toHaveBeenCalledTimes(1);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '2' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF4500' });
    });
  });
});
