/**
 * Remy Reminders - Challenger M2-2 Empirical Adversarial Verification Suite
 *
 * Exhaustive independent verification of:
 * 1. ACTION_COMPLETE: status transitions, alert cancellation, idempotency, no spurious alerts.
 * 2. ACTION_SNOOZE_15M: T_base = max(now, due) + 15m, 00s normalization, alert cancellation & rescheduling.
 * 3. ACTION_SNOOZE_1H: T_base = max(now, due) + 60m, 00s normalization, alert rescheduling.
 * 4. ACTION_SNOOZE_TOMORROW: next calendar day at local 09:00:00.000 across leap-year, month-end, and year-end boundaries.
 * 5. Overdue reminders: strict enforcement of T_base = max(now, due) across delta ranges (-1ms, -1h, -30d, -10y).
 */

import { Platform } from 'react-native';
import {
  NotificationService,
  REMINDER_CHANNEL_ID,
  NOTIFICATION_CATEGORY,
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  ACTION_SNOOZE_TOMORROW,
} from '../src/services/notificationService';
import { StorageService } from '../src/services/storageService';
import {
  getBaseTime,
  normalizeSeconds,
  calculate15Minutes,
  calculate1Hour,
  calculateTomorrowMorning,
  calculateSnoozeTime,
} from '../src/utils/snoozeCalculator';
import { mockNotifications, mockTaskManager } from './mocks/mockNotifications';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

// Setup mocks
jest.mock('expo-notifications', () => {
  const { mockNotifications } = require('./mocks/mockNotifications');
  return mockNotifications;
});

jest.mock('expo-task-manager', () => {
  const { mockTaskManager } = require('./mocks/mockNotifications');
  return mockTaskManager;
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

describe('Challenger M2-2 Empirical Verification: Temporal Boundaries & Snooze Actions', () => {
  let storage: StorageService;
  let service: NotificationService;
  const originalPlatformOS = Platform.OS;

  beforeEach(async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockAsyncStorage.__reset();
    mockNotifications.__reset();
    mockTaskManager.__reset();
    storage = new StorageService();
    await storage.init();
    service = new NotificationService(storage);
    await service.init();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // =========================================================================
  // 1. ACTION_COMPLETE Verification
  // =========================================================================
  describe('1. ACTION_COMPLETE Empirical Invariants', () => {
    it('marks pending reminder completed, sets completedAt, cancels scheduled alert, and clears notificationId', async () => {
      const reminder = await storage.create({
        title: 'Submit quarterly report',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeTruthy();

      const scheduledBefore = mockNotifications.__getScheduled();
      expect(scheduledBefore.some((s) => s.identifier === notifId)).toBe(true);

      mockNotifications.scheduleNotificationAsync.mockClear();

      // Trigger ACTION_COMPLETE
      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);

      const after = storage.getById(reminder.id)!;
      expect(after.status).toBe('completed');
      expect(after.completedAt).toBeTruthy();
      expect(after.notificationId).toBeNull();

      // Verify old alert cancelled
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(notifId);
      expect(mockNotifications.__getScheduled().some((s) => s.identifier === notifId)).toBe(false);

      // Verify NO new alert was scheduled
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('marks snoozed reminder completed, preserves snooze count, and cancels scheduled alert', async () => {
      const reminder = await storage.create({
        title: 'Snoozed task to complete',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      await service.scheduleReminderNotification(reminder);

      // First snooze +15m
      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);
      const snoozed = storage.getById(reminder.id)!;
      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozeCount).toBe(1);
      const snoozedNotifId = snoozed.notificationId!;
      expect(snoozedNotifId).toBeTruthy();

      // Complete snoozed task
      mockNotifications.scheduleNotificationAsync.mockClear();
      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);

      const completed = storage.getById(reminder.id)!;
      expect(completed.status).toBe('completed');
      expect(completed.snoozeCount).toBe(1); // Preserves audit count
      expect(completed.completedAt).toBeTruthy();
      expect(completed.notificationId).toBeNull();
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(snoozedNotifId);
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('idempotency: multiple ACTION_COMPLETE calls do not throw, duplicate, or alter completedAt', async () => {
      const reminder = await storage.create({
        title: 'Idempotent completion task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      await service.scheduleReminderNotification(reminder);

      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);
      const firstCompleted = storage.getById(reminder.id)!;
      const initialCompletedAt = firstCompleted.completedAt;

      // Second call
      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);
      const secondCompleted = storage.getById(reminder.id)!;

      expect(secondCompleted.status).toBe('completed');
      expect(secondCompleted.completedAt).toBe(initialCompletedAt);
    });
  });

  // =========================================================================
  // 2. ACTION_SNOOZE_15M Verification
  // =========================================================================
  describe('2. ACTION_SNOOZE_15M Empirical Invariants', () => {
    it('adds 15 minutes to T_base = max(now, due), normalizes seconds to 00, cancels old alert, and schedules new alert', async () => {
      const futureDue = new Date(Date.now() + 3600000); // 1 hour in future
      const reminder = await storage.create({
        title: 'Future snooze task',
        dueDate: futureDue.toISOString(),
      });
      const initialNotifId = await service.scheduleReminderNotification(reminder);
      expect(initialNotifId).toBeTruthy();

      mockNotifications.scheduleNotificationAsync.mockClear();

      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);
      expect(updated.lastSnoozedAt).toBeTruthy();

      // Validate due date: futureDue + 15 minutes, seconds = 00
      const updatedDue = new Date(updated.dueDate);
      expect(updatedDue.getSeconds()).toBe(0);
      expect(updatedDue.getMilliseconds()).toBe(0);

      const expectedDue = calculate15Minutes(new Date(), futureDue);
      expect(updatedDue.toISOString()).toBe(expectedDue.toISOString());

      // Validate alert cancellation and rescheduling
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(initialNotifId);
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      expect(updated.notificationId).toBeTruthy();
      expect(updated.notificationId).not.toBe(initialNotifId);
    });

    it('truncates clock seconds to 00 across fractional and mid-minute timestamps', () => {
      const arbitraryTimes = [
        new Date('2026-09-10T14:22:59.999Z'),
        new Date('2026-09-10T14:00:01.001Z'),
        new Date('2026-09-10T23:59:30.500Z'),
      ];

      for (const time of arbitraryTimes) {
        const target = calculate15Minutes(time, time);
        expect(target.getSeconds()).toBe(0);
        expect(target.getMilliseconds()).toBe(0);
        // Ensure strictly 15 minutes added to minute floor
        expect(target.getMinutes()).toBe((time.getMinutes() + 15) % 60);
      }
    });
  });

  // =========================================================================
  // 3. ACTION_SNOOZE_1H Verification
  // =========================================================================
  describe('3. ACTION_SNOOZE_1H Empirical Invariants', () => {
    it('adds 60 minutes to T_base = max(now, due), normalizes seconds to 00, cancels old alert, and schedules new alert', async () => {
      const futureDue = new Date(Date.now() + 1800000); // 30 minutes in future
      const reminder = await storage.create({
        title: 'Snooze 1h alert task',
        dueDate: futureDue.toISOString(),
      });
      const initialNotifId = await service.scheduleReminderNotification(reminder);
      expect(initialNotifId).toBeTruthy();

      mockNotifications.scheduleNotificationAsync.mockClear();

      await service.handleNotificationResponse(ACTION_SNOOZE_1H, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);

      const updatedDue = new Date(updated.dueDate);
      expect(updatedDue.getSeconds()).toBe(0);
      expect(updatedDue.getMilliseconds()).toBe(0);

      const expectedDue = calculate1Hour(new Date(), futureDue);
      expect(updatedDue.toISOString()).toBe(expectedDue.toISOString());

      // Validate alert lifecycle
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(initialNotifId);
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      expect(updated.notificationId).toBeTruthy();
    });

    it('accurately rolls over midnight (+1h at 23:30 -> 00:30 next day)', () => {
      const lateNight = new Date('2026-09-10T23:30:45.000Z');
      const target = calculate1Hour(lateNight, lateNight);
      expect(target.toISOString()).toBe('2026-09-11T00:30:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });
  });

  // =========================================================================
  // 4. ACTION_SNOOZE_TOMORROW Verification
  // =========================================================================
  describe('4. ACTION_SNOOZE_TOMORROW Empirical Invariants', () => {
    it('reschedules reminder to next calendar day at 09:00:00 local time and updates alert', async () => {
      const reminder = await storage.create({
        title: 'Tomorrow morning task',
        dueDate: new Date().toISOString(),
      });
      const initialNotifId = await service.scheduleReminderNotification(reminder);

      mockNotifications.scheduleNotificationAsync.mockClear();

      await service.handleNotificationResponse(ACTION_SNOOZE_TOMORROW, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);

      const target = new Date(updated.dueDate);
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);

      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(initialNotifId);
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      expect(updated.notificationId).toBeTruthy();
    });

    it('calendar boundary stress test: calculates tomorrow morning 09:00 correctly across leap year, month-ends, and year-ends', () => {
      const cases = [
        // Standard month day
        { input: new Date(2026, 8, 10, 14, 0, 0), expY: 2026, expM: 8, expD: 11 },
        // Month end (31 days): Jan 31 -> Feb 1
        { input: new Date(2026, 0, 31, 22, 15, 0), expY: 2026, expM: 1, expD: 1 },
        // Month end (30 days): Apr 30 -> May 1
        { input: new Date(2026, 3, 30, 18, 0, 0), expY: 2026, expM: 4, expD: 1 },
        // Leap year: Feb 28, 2024 -> Feb 29, 2024 (Leap Day)
        { input: new Date(2024, 1, 28, 10, 0, 0), expY: 2024, expM: 1, expD: 29 },
        // Leap day: Feb 29, 2024 -> Mar 1, 2024
        { input: new Date(2024, 1, 29, 12, 0, 0), expY: 2024, expM: 2, expD: 1 },
        // Non-leap year: Feb 28, 2023 -> Mar 1, 2023
        { input: new Date(2023, 1, 28, 23, 0, 0), expY: 2023, expM: 2, expD: 1 },
        // Year end: Dec 31, 2026 -> Jan 1, 2027
        { input: new Date(2026, 11, 31, 23, 59, 0), expY: 2027, expM: 0, expD: 1 },
      ];

      for (const { input, expY, expM, expD } of cases) {
        const target = calculateTomorrowMorning(input);
        expect(target.getFullYear()).toBe(expY);
        expect(target.getMonth()).toBe(expM);
        expect(target.getDate()).toBe(expD);
        expect(target.getHours()).toBe(9);
        expect(target.getMinutes()).toBe(0);
        expect(target.getSeconds()).toBe(0);
        expect(target.getMilliseconds()).toBe(0);
      }
    });
  });

  // =========================================================================
  // 5. Overdue Reminders (T_base = max(now, due)) Verification
  // =========================================================================
  describe('5. Overdue Reminders (T_base = max(now, due)) Empirical Verification', () => {
    const fixedNow = new Date('2026-09-10T14:30:25.123Z');

    it('proves T_base uses now when dueDate is in the past (overdue ranges)', () => {
      const overdueDeltas = [
        1,                     // 1 ms overdue
        1000,                  // 1 second overdue
        60 * 1000,             // 1 minute overdue
        3600 * 1000,           // 1 hour overdue
        86400 * 1000,          // 1 day overdue
        30 * 86400 * 1000,     // 30 days overdue
        3650 * 86400 * 1000,   // 10 years overdue
      ];

      for (const delta of overdueDeltas) {
        const pastDue = new Date(fixedNow.getTime() - delta);
        const base = getBaseTime(fixedNow, pastDue);

        // Strict assertion: T_base MUST equal now, NEVER past due date
        expect(base.getTime()).toBe(fixedNow.getTime());

        // Assert +15m calculates from now
        const target15m = calculate15Minutes(fixedNow, pastDue);
        expect(target15m.toISOString()).toBe('2026-09-10T14:45:00.000Z');

        // Assert +1h calculates from now
        const target1h = calculate1Hour(fixedNow, pastDue);
        expect(target1h.toISOString()).toBe('2026-09-10T15:30:00.000Z');
      }
    });

    it('proves T_base uses dueDate when dueDate is strictly in the future', () => {
      const futureDeltas = [
        1,                     // 1 ms future
        1000,                  // 1 second future
        30 * 60 * 1000,        // 30 minutes future
        2 * 3600 * 1000,       // 2 hours future
      ];

      for (const delta of futureDeltas) {
        const futureDue = new Date(fixedNow.getTime() + delta);
        const base = getBaseTime(fixedNow, futureDue);

        // Strict assertion: T_base MUST equal futureDue
        expect(base.getTime()).toBe(futureDue.getTime());
      }
    });

    it('end-to-end: notification response on 5-hour overdue reminder reschedules into the future from now', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      const overdueReminder = await storage.create({
        title: 'Severely overdue task',
        dueDate: fiveHoursAgo,
      });

      // User triggers +15m action from notification shade on overdue reminder
      await service.handleNotificationResponse(ACTION_SNOOZE_15M, overdueReminder.id);

      const snoozed = storage.getById(overdueReminder.id)!;
      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozeCount).toBe(1);

      // Verify new due date is strictly in the future (relative to wall clock)
      const newDueMs = new Date(snoozed.dueDate).getTime();
      expect(newDueMs).toBeGreaterThan(Date.now());
      // Specifically within [now + 14m, now + 16m]
      expect(newDueMs).toBeGreaterThanOrEqual(Date.now() + 14 * 60 * 1000);
      expect(newDueMs).toBeLessThanOrEqual(Date.now() + 16 * 60 * 1000);
    });

    it('reconciliation safety: active overdue reminders in storage are NOT rescheduled into the past by reconciliation', async () => {
      // 1 overdue reminder (3 hours ago)
      const pastReminder = await storage.create({
        title: 'Unreconciled overdue task',
        dueDate: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      });

      // 1 future reminder (1 hour future)
      const futureReminder = await storage.create({
        title: 'Legitimate future task',
        dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
      });

      mockNotifications.scheduleNotificationAsync.mockClear();

      const report = await service.reconcileActiveReminders();
      expect(report.activeCount).toBe(2);
      expect(report.rescheduledCount).toBe(1); // ONLY the future task is rescheduled

      // Past reminder did not receive an alert scheduled into the past
      expect(storage.getById(pastReminder.id)?.notificationId).toBeNull();
      // Future reminder was rescheduled
      expect(storage.getById(futureReminder.id)?.notificationId).toBeTruthy();
    });
  });
});
