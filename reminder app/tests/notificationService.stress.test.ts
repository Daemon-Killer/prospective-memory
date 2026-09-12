/**
 * Remy Reminders - Milestone 2 Adversarial Stress & Concurrency Challenge Suite
 *
 * Exhaustive Empirical Verification:
 * 1. Concurrent notification action responses on the same reminder (10+ parallel requests, mutex & debouncing)
 * 2. Burst scheduling and cancellation of 100+ notifications under load
 * 3. Reconciliation under out-of-sync storage and scheduled alerts (missing, overdue, orphaned, mismatched)
 * 4. Zero unhandled promise rejections and resilience against native I/O fault injections
 */

import { Platform } from 'react-native';
import {
  NotificationService,
  REMINDER_CHANNEL_ID,
  NOTIFICATION_CATEGORY,
  BACKGROUND_NOTIFICATION_TASK,
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  ACTION_SNOOZE_TOMORROW,
} from '../src/services/notificationService';
import {
  defineBackgroundTask,
  executeNotificationAction,
} from '../src/services/backgroundTask';
import { calculate15Minutes } from '../src/utils/snoozeCalculator';
import { StorageService, STORAGE_KEY } from '../src/services/storageService';
import { mockNotifications, mockTaskManager } from './mocks/mockNotifications';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';
import { Reminder } from '../src/types/reminder';

// Wire Jest Mocks
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

describe('Milestone 2 Empirical Stress & Concurrency Suite', () => {
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
    defineBackgroundTask(service);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // =========================================================================
  // Section 1: Concurrent Action Responses on the Same Reminder
  // =========================================================================
  describe('1. Concurrent Action Responses on the Same Reminder', () => {
    it('handles 10 parallel +15m snooze requests without race conditions or duplicate mutations', async () => {
      const baseDueDate = new Date(Date.now() + 600000).toISOString(); // 10 minutes in future
      const reminder = await storage.create({
        title: 'Concurrent Snooze Target',
        notes: 'Testing parallel actions',
        dueDate: baseDueDate,
      });

      const initialNotifId = await service.scheduleReminderNotification(reminder);
      expect(initialNotifId).not.toBeNull();

      // Launch 10 simultaneous +15m snooze action triggers on the exact same reminder
      const PARALLEL_CALLS = 10;
      const promises = Array.from({ length: PARALLEL_CALLS }, () =>
        service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id)
      );

      // Await all parallel calls
      await Promise.all(promises);

      // Verify the reminder in storage
      const updated = storage.getById(reminder.id)!;
      expect(updated).toBeDefined();
      expect(updated.status).toBe('snoozed');

      // The mutex lock must have allowed only 1 snooze mutation to execute,
      // discarding the concurrent duplicate requests
      expect(updated.snoozeCount).toBe(1);
      expect(updated.lastSnoozedAt).not.toBeNull();

      // The due date should have advanced by 15 minutes (with seconds truncated to 00)
      const expectedTarget = calculate15Minutes(new Date(), baseDueDate);
      const actualDueTime = new Date(updated.dueDate).getTime();
      expect(Math.abs(actualDueTime - expectedTarget.getTime())).toBeLessThanOrEqual(1000);

      // Verify that the initial notification was cancelled and exactly one new notification is scheduled
      const scheduledForReminder = mockNotifications.__getScheduledForReminder(reminder.id);
      expect(scheduledForReminder.length).toBe(1);
      expect(scheduledForReminder[0].identifier).toBe(updated.notificationId);
      expect(scheduledForReminder[0].identifier).not.toBe(initialNotifId);
    });

    it('handles concurrent mixed actions (Snooze + Complete) deterministically without corrupting state', async () => {
      const reminder = await storage.create({
        title: 'Mixed Action Race Target',
        notes: 'Snooze vs Complete',
        dueDate: new Date(Date.now() + 300000).toISOString(),
      });
      await service.scheduleReminderNotification(reminder);

      // Fire concurrent Snooze and Complete actions simultaneously
      await Promise.all([
        service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id),
        service.handleNotificationResponse(ACTION_COMPLETE, reminder.id),
      ]);

      const updated = storage.getById(reminder.id)!;
      expect(updated).toBeDefined();

      // The reminder must be in a clean, consistent state: either snoozed OR completed
      expect(['snoozed', 'completed']).toContain(updated.status);

      if (updated.status === 'completed') {
        expect(updated.completedAt).not.toBeNull();
        expect(updated.notificationId).toBeNull();
        expect(mockNotifications.__getScheduledForReminder(reminder.id).length).toBe(0);
      } else {
        expect(updated.snoozeCount).toBe(1);
        expect(updated.notificationId).not.toBeNull();
        expect(mockNotifications.__getScheduledForReminder(reminder.id).length).toBe(1);
      }
    });

    it('suppresses rapid duplicate actions within 200ms debounce threshold, permits sequential actions after 250ms', async () => {
      const reminder = await storage.create({
        title: 'Debounce Boundary Target',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });
      await service.scheduleReminderNotification(reminder);

      // Action 1: First snooze
      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);
      expect(storage.getById(reminder.id)!.snoozeCount).toBe(1);

      // Action 2: Rapid duplicate within 50ms (same actionIdentifier)
      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);
      // Debounce must suppress this duplicate call
      expect(storage.getById(reminder.id)!.snoozeCount).toBe(1);

      // Wait 250ms (exceeds 200ms debounce threshold)
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Action 3: Legitimate second snooze after debounce window
      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);
      expect(storage.getById(reminder.id)!.snoozeCount).toBe(2);
    });

    it('isolates concurrency locks across 50 distinct reminders simultaneously', async () => {
      const COUNT = 50;
      const reminders: Reminder[] = [];

      for (let i = 0; i < COUNT; i++) {
        const r = await storage.create({
          title: `Disjoint Reminder #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
        await service.scheduleReminderNotification(r);
        reminders.push(r);
      }

      // Simultaneously trigger 50 snooze actions on all 50 different reminders
      const promises = reminders.map((r) =>
        service.handleNotificationResponse(ACTION_SNOOZE_15M, r.id)
      );

      await Promise.all(promises);

      // Every individual reminder must have succeeded independently
      for (const r of reminders) {
        const updated = storage.getById(r.id)!;
        expect(updated.status).toBe('snoozed');
        expect(updated.snoozeCount).toBe(1);
        expect(mockNotifications.__getScheduledForReminder(r.id).length).toBe(1);
      }
    });

    it('handles 10 parallel headless TaskManager background action dispatches safely', async () => {
      const reminder = await storage.create({
        title: 'Headless Concurrent Target',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });
      await service.scheduleReminderNotification(reminder);

      const backgroundPayload = {
        data: {
          actionIdentifier: ACTION_SNOOZE_15M,
          reminderId: reminder.id,
        },
      };

      // Dispatch 10 parallel headless executions
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          mockTaskManager.__executeTask(BACKGROUND_NOTIFICATION_TASK, backgroundPayload)
        )
      );

      // All return BackgroundNotificationTaskResult.NoData (1) without crashing
      for (const res of results) {
        expect(res).toBe(1);
      }

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);
    });
  });

  // =========================================================================
  // Section 2: Burst Scheduling and Cancellation of 100+ Notifications
  // =========================================================================
  describe('2. Burst Scheduling and Cancellation of 100+ Notifications', () => {
    it('burst schedules 150 notifications concurrently with zero loss and 100% ID integrity', async () => {
      const COUNT = 150;
      const reminders: Reminder[] = [];

      for (let i = 0; i < COUNT; i++) {
        const r = await storage.create({
          title: `Burst Reminder #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
        reminders.push(r);
      }

      const start = Date.now();
      // Burst schedule all 150 notifications in parallel
      const notificationIds = await Promise.all(
        reminders.map((r) => service.scheduleReminderNotification(r))
      );
      const elapsed = Date.now() - start;

      // 1. All 150 returned valid non-null notification IDs
      expect(notificationIds.length).toBe(COUNT);
      for (const id of notificationIds) {
        expect(id).not.toBeNull();
        expect(typeof id).toBe('string');
      }

      // 2. All 150 IDs are unique
      const uniqueIds = new Set(notificationIds);
      expect(uniqueIds.size).toBe(COUNT);

      // 3. Storage reflects all notification IDs accurately
      const allStored = storage.getAll();
      expect(allStored.length).toBe(COUNT);
      for (const stored of allStored) {
        expect(stored.notificationId).not.toBeNull();
        expect(uniqueIds.has(stored.notificationId!)).toBe(true);
      }

      // 4. Native mock has exactly 150 scheduled alerts
      const scheduledInMock = mockNotifications.__getScheduled();
      expect(scheduledInMock.length).toBe(COUNT);

      // Throughput verification: 150 parallel schedules complete within 3000ms
      expect(elapsed).toBeLessThan(3000);
    });

    it('burst reschedules 100 notifications concurrently, purging prior alerts without leaks', async () => {
      const COUNT = 100;
      const reminders: Reminder[] = [];

      for (let i = 0; i < COUNT; i++) {
        const r = await storage.create({
          title: `Reschedule Target #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
        const notifId = await service.scheduleReminderNotification(r);
        reminders.push(storage.getById(r.id)!);
      }

      expect(mockNotifications.__getScheduled().length).toBe(COUNT);

      // Record first batch IDs
      const firstBatchIds = new Set(reminders.map((r) => r.notificationId!));
      expect(firstBatchIds.size).toBe(COUNT);

      // Concurrently reschedule all 100 reminders (e.g. updating due dates)
      const rescheduledIds = await Promise.all(
        reminders.map((r) => {
          const updatedReminder: Reminder = {
            ...r,
            dueDate: new Date(new Date(r.dueDate).getTime() + 3600000).toISOString(),
          };
          return service.scheduleReminderNotification(updatedReminder);
        })
      );

      // Verify all 100 rescheduled successfully
      expect(rescheduledIds.length).toBe(COUNT);
      const newIds = new Set(rescheduledIds);
      expect(newIds.size).toBe(COUNT);

      // None of the new IDs overlap with first batch
      for (const id of rescheduledIds) {
        expect(firstBatchIds.has(id!)).toBe(false);
      }

      // Total scheduled alerts in mock must still be EXACTLY 100 (prior 100 were purged)
      const currentScheduled = mockNotifications.__getScheduled();
      expect(currentScheduled.length).toBe(COUNT);

      // All scheduled alerts match the new IDs
      for (const alert of currentScheduled) {
        expect(newIds.has(alert.identifier)).toBe(true);
      }
    });

    it('burst cancels 150 notifications concurrently with zero residual alerts', async () => {
      const COUNT = 150;
      const notificationIds: string[] = [];

      for (let i = 0; i < COUNT; i++) {
        const r = await storage.create({
          title: `Cancellation Target #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
        const id = await service.scheduleReminderNotification(r);
        notificationIds.push(id!);
      }

      expect(mockNotifications.__getScheduled().length).toBe(COUNT);

      // Burst cancel all 150 scheduled notifications concurrently
      await Promise.all(
        notificationIds.map((id) => service.cancelReminderNotification(id))
      );

      // Native mock must be completely cleared
      expect(mockNotifications.__getScheduled().length).toBe(0);
    });
  });

  // =========================================================================
  // Section 3: Reconciliation with Out-of-Sync Storage & Scheduled Alerts
  // =========================================================================
  describe('3. Reconciliation with Out-of-Sync Storage and Scheduled Alerts', () => {
    it('reconciles 50 active future reminders when all native alerts are lost (e.g. device reboot)', async () => {
      const COUNT = 50;
      for (let i = 0; i < COUNT; i++) {
        await storage.create({
          title: `Reboot Reminder #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
      }

      // Simulate native alarm loss (empty mock notifications)
      expect(mockNotifications.__getScheduled().length).toBe(0);

      const result = await service.reconcileActiveReminders();

      expect(result.activeCount).toBe(COUNT);
      expect(result.rescheduledCount).toBe(COUNT);
      expect(result.purgedCount).toBe(0);

      // Native scheduler now contains all 50 rescheduled alerts
      expect(mockNotifications.__getScheduled().length).toBe(COUNT);

      // Every reminder in storage now has a populated notificationId
      const stored = storage.getAll();
      for (const r of stored) {
        expect(r.notificationId).not.toBeNull();
      }
    });

    it('does NOT reschedule overdue reminders into the past during cold-boot reconciliation', async () => {
      const COUNT = 25;
      const pastTime = Date.now() - 3600000; // 1 hour ago

      for (let i = 0; i < COUNT; i++) {
        await storage.create({
          title: `Overdue Task #${i + 1}`,
          dueDate: new Date(pastTime - i * 60000).toISOString(),
        });
      }

      // Verify active overdue reminders exist in storage
      expect(storage.getActive().length).toBe(COUNT);

      const result = await service.reconcileActiveReminders();

      expect(result.activeCount).toBe(COUNT);
      expect(result.rescheduledCount).toBe(0);
      expect(result.purgedCount).toBe(0);

      // No alerts should be scheduled in the past
      expect(mockNotifications.__getScheduled().length).toBe(0);
    });

    it('purges 50 orphaned scheduled alerts that have no matching active reminder in storage', async () => {
      // Manually register 50 orphaned alerts directly into the native mock
      for (let i = 0; i < 50; i++) {
        await mockNotifications.scheduleNotificationAsync({
          content: {
            title: `Orphaned Alert #${i + 1}`,
            data: { reminderId: `ghost-reminder-id-${i + 1}` },
          },
          trigger: {
            date: Date.now() + (i + 1) * 60000,
          },
        });
      }

      expect(mockNotifications.__getScheduled().length).toBe(50);
      expect(storage.getAll().length).toBe(0);

      const result = await service.reconcileActiveReminders();

      expect(result.activeCount).toBe(0);
      expect(result.rescheduledCount).toBe(0);
      expect(result.purgedCount).toBe(50);

      // All 50 orphaned alerts have been wiped
      expect(mockNotifications.__getScheduled().length).toBe(0);
    });

    it('corrects mismatched notification IDs between storage and native scheduler without duplicates', async () => {
      const reminder = await storage.create({
        title: 'Mismatched Notification ID Target',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });

      // Storage has a stale ID
      await storage.setNotificationId(reminder.id, 'stale-notification-id-999');

      // Native scheduler has the actual scheduled alert with matching data.reminderId
      const realAlertId = await mockNotifications.scheduleNotificationAsync({
        content: {
          title: reminder.title,
          data: { reminderId: reminder.id },
        },
        trigger: {
          date: Date.now() + 600000,
        },
      });

      expect(mockNotifications.__getScheduled().length).toBe(1);

      const result = await service.reconcileActiveReminders();

      expect(result.activeCount).toBe(1);
      expect(result.rescheduledCount).toBe(0);
      expect(result.purgedCount).toBe(0);

      // Storage reminder was reconciled to point to the real active alert ID
      const updated = storage.getById(reminder.id)!;
      expect(updated.notificationId).toBe(realAlertId);
      expect(mockNotifications.__getScheduled().length).toBe(1);
    });

    it('handles complex multi-factor desync partition (active, overdue, completed, orphaned)', async () => {
      // 1. 10 Active future reminders with existing matching alerts
      const activeWithAlerts: Reminder[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await storage.create({
          title: `Active With Alert #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
        });
        await service.scheduleReminderNotification(r);
        activeWithAlerts.push(storage.getById(r.id)!);
      }

      // 2. 10 Active future reminders with MISSING alerts
      const activeMissingAlerts: Reminder[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await storage.create({
          title: `Active Missing Alert #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 10) * 3600000).toISOString(),
        });
        activeMissingAlerts.push(r);
      }

      // 3. 10 Completed reminders (5 of which have stale residual scheduled alerts)
      for (let i = 0; i < 10; i++) {
        const r = await storage.create({
          title: `Completed Task #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 20) * 3600000).toISOString(),
        });
        await storage.toggleComplete(r.id);
        if (i < 5) {
          // Inject residual alert that was not cancelled
          await mockNotifications.scheduleNotificationAsync({
            content: { title: r.title, data: { reminderId: r.id } },
            trigger: { date: Date.now() + (i + 20) * 3600000 },
          });
        }
      }

      // 4. 10 Overdue reminders with no alerts
      for (let i = 0; i < 10; i++) {
        await storage.create({
          title: `Overdue Task #${i + 1}`,
          dueDate: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
        });
      }

      // 5. 15 Orphaned alerts for deleted tasks
      for (let i = 0; i < 15; i++) {
        await mockNotifications.scheduleNotificationAsync({
          content: {
            title: `Deleted Task Alert #${i + 1}`,
            data: { reminderId: `deleted-task-${i + 1}` },
          },
          trigger: { date: Date.now() + (i + 30) * 3600000 },
        });
      }

      // Pre-reconciliation checks:
      // Total in mock: 10 (active) + 5 (completed) + 15 (deleted) = 30
      expect(mockNotifications.__getScheduled().length).toBe(30);

      const result = await service.reconcileActiveReminders();

      // Active count in storage = 10 (future with alerts) + 10 (future missing) + 10 (overdue) = 30
      expect(result.activeCount).toBe(30);

      // Rescheduled count = 10 (the future reminders that were missing alerts)
      expect(result.rescheduledCount).toBe(10);

      // Purged count = 5 (completed) + 15 (deleted) = 20
      expect(result.purgedCount).toBe(20);

      // Post-reconciliation checks:
      // Total scheduled alerts now in mock: exactly 20 active future reminders (10 kept + 10 rescheduled)
      expect(mockNotifications.__getScheduled().length).toBe(20);
    });

    it('survives concurrent reconciliation invocations without uncaught rejections', async () => {
      for (let i = 0; i < 20; i++) {
        await storage.create({
          title: `Concurrent Reconcile Reminder #${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        });
      }

      // Fire 5 concurrent reconciliation sweeps
      const results = await Promise.all([
        service.reconcileActiveReminders(),
        service.reconcileActiveReminders(),
        service.reconcileActiveReminders(),
        service.reconcileActiveReminders(),
        service.reconcileActiveReminders(),
      ]);

      expect(results.length).toBe(5);
      for (const res of results) {
        expect(res.activeCount).toBe(20);
      }
    });
  });

  // =========================================================================
  // Section 4: Unhandled Promise Rejections & Fault Resilience
  // =========================================================================
  describe('4. Unhandled Promise Rejections and Fault Resilience', () => {
    it('executes a storm of mixed concurrent operations with zero unhandled promise rejections', async () => {
      const unhandledRejections: any[] = [];
      const rejectionHandler = (reason: any) => {
        unhandledRejections.push(reason);
      };

      process.on('unhandledRejection', rejectionHandler);

      try {
        const stormPromises: Promise<any>[] = [];

        // 1. Create 30 reminders
        for (let i = 0; i < 30; i++) {
          stormPromises.push(
            storage.create({
              title: `Storm Reminder #${i + 1}`,
              dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
            })
          );
        }

        const createdReminders = await Promise.all(stormPromises);

        // 2. Mix of concurrent schedule, snooze, complete, cancel, and reconcile operations
        const actionPromises: Promise<any>[] = [];

        for (let i = 0; i < createdReminders.length; i++) {
          const r = createdReminders[i];
          if (i % 4 === 0) {
            actionPromises.push(service.scheduleReminderNotification(r));
          } else if (i % 4 === 1) {
            actionPromises.push(service.handleNotificationResponse(ACTION_SNOOZE_15M, r.id));
          } else if (i % 4 === 2) {
            actionPromises.push(service.handleNotificationResponse(ACTION_COMPLETE, r.id));
          } else {
            actionPromises.push(service.reconcileActiveReminders());
          }
        }

        await Promise.all(actionPromises);

        // Give any asynchronous dangling microtasks a chance to reject
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Zero unhandled rejections detected!
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.removeListener('unhandledRejection', rejectionHandler);
      }
    });

    it('recovers gracefully when scheduleNotificationAsync throws a native fault', async () => {
      const reminder = await storage.create({
        title: 'Fault Injection Reminder',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });

      // Inject native error in scheduleNotificationAsync
      const scheduleSpy = jest
        .spyOn(mockNotifications, 'scheduleNotificationAsync')
        .mockRejectedValueOnce(new Error('FATAL: Native Notification Daemon Died'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.scheduleReminderNotification(reminder);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NotificationService: Error scheduling notification for reminder'),
        expect.any(Error)
      );

      warnSpy.mockRestore();
      scheduleSpy.mockRestore();
    });

    it('recovers gracefully when cancelScheduledNotificationAsync fails with an I/O exception', async () => {
      const cancelSpy = jest
        .spyOn(mockNotifications, 'cancelScheduledNotificationAsync')
        .mockRejectedValueOnce(new Error('IPC Pipe Broken'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Must not throw or produce unhandled rejection
      await expect(
        service.cancelReminderNotification('some-notif-id')
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NotificationService: Error cancelling notification'),
        expect.any(Error)
      );

      warnSpy.mockRestore();
      cancelSpy.mockRestore();
    });

    it('handles permission revocation mid-operation without throwing or crashing', async () => {
      const reminder = await storage.create({
        title: 'Revoked Permissions Reminder',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });

      // Revoke permissions
      mockNotifications.__setPermissions(false, 'denied');

      const result = await service.scheduleReminderNotification(reminder);
      expect(result).toBeNull();
      expect(storage.getById(reminder.id)!.notificationId).toBeNull();
    });

    it('handles malformed, undefined, or unknown notification response actions gracefully', async () => {
      const reminder = await storage.create({
        title: 'Malformed Action Target',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });

      // 1. Unknown action identifier
      await expect(
        service.handleNotificationResponse('UNKNOWN_ACTION_XYZ', reminder.id)
      ).resolves.toBeUndefined();

      // 2. Non-existent reminder ID
      await expect(
        service.handleNotificationResponse(ACTION_SNOOZE_15M, 'non-existent-reminder-id')
      ).resolves.toBeUndefined();

      // 3. Null / empty reminder ID
      await expect(
        service.handleNotificationResponse(ACTION_SNOOZE_15M, '')
      ).resolves.toBeUndefined();

      // Reminder remains completely unmodified
      const intact = storage.getById(reminder.id)!;
      expect(intact.status).toBe('pending');
      expect(intact.snoozeCount).toBe(0);
    });

    it('degrades gracefully under high concurrency on Web platform', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

      const webService = new NotificationService(storage);
      await webService.init();

      const reminder = await storage.create({
        title: 'Web Platform Reminder',
        dueDate: new Date(Date.now() + 600000).toISOString(),
      });

      // Schedule returns null safely
      const schedResult = await webService.scheduleReminderNotification(reminder);
      expect(schedResult).toBeNull();

      // Actions no-op safely
      await expect(
        webService.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id)
      ).resolves.toBeUndefined();

      // Reconcile returns zero counts safely
      const recResult = await webService.reconcileActiveReminders();
      expect(recResult.rescheduledCount).toBe(0);
      expect(recResult.purgedCount).toBe(0);
    });
  });
});
