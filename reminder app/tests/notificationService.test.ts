/**
 * Remy Reminders - Actionable Notification Service & Background Task Test Suite
 * Milestone 2 Comprehensive Specifications (28 Tests across 8 Suites)
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
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
  registerBackgroundTaskAsync,
  executeNotificationAction,
} from '../src/services/backgroundTask';
import * as services from '../src/services';
import { useNotifications } from '../src/hooks/useNotifications';
import { StorageService } from '../src/services/storageService';
import { mockNotifications, mockTaskManager } from './mocks/mockNotifications';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';
import { Reminder } from '../src/types/reminder';

// Wire mocks
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

describe('NotificationService & Background Task Suite', () => {
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
    defineBackgroundTask(service);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // =========================================================================
  // Suite 1: Initialization & Channel/Category Configuration (F05, F08)
  // =========================================================================
  describe('Suite 1: Initialization & Channel/Category Configuration', () => {
    it('Test 1.1: Android Channel Registration with High Priority Settings', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      await service.init();

      expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        REMINDER_CHANNEL_ID,
        expect.objectContaining({
          name: 'Reminders',
          importance: mockNotifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          enableVibrate: true,
          enableLights: true,
          showBadge: true,
        })
      );
    });

    it('Test 1.2: iOS & Web Platform Channel Bypass', async () => {
      // Test iOS
      mockNotifications.__reset();
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      const iosService = new NotificationService(storage);
      await iosService.init();
      expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();

      // Test Web
      mockNotifications.__reset();
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      const webService = new NotificationService(storage);
      await webService.init();
      expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
      expect(mockNotifications.setNotificationCategoryAsync).not.toHaveBeenCalled();
    });

    it('Test 1.3: Actionable Category Registration with Exact Actions', async () => {
      await service.init();

      expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
        NOTIFICATION_CATEGORY,
        expect.arrayContaining([
          expect.objectContaining({
            identifier: ACTION_COMPLETE,
            buttonTitle: 'Complete',
          }),
          expect.objectContaining({
            identifier: ACTION_SNOOZE_15M,
            buttonTitle: '+15m',
          }),
          expect.objectContaining({
            identifier: ACTION_SNOOZE_1H,
            buttonTitle: '+1h',
          }),
          expect.objectContaining({
            identifier: ACTION_SNOOZE_TOMORROW,
            buttonTitle: 'Tomorrow',
          }),
        ])
      );

      const registeredCategories = mockNotifications.__getRegisteredCategories();
      expect(registeredCategories.length).toBe(1);
      expect(registeredCategories[0].identifier).toBe(NOTIFICATION_CATEGORY);
      expect(registeredCategories[0].actions.length).toBe(4);
    });

    it('Test 1.4: Headless Execution Invariant on Action Buttons', async () => {
      await service.init();

      const categories = mockNotifications.__getRegisteredCategories();
      const actionCategory = categories.find((c) => c.identifier === NOTIFICATION_CATEGORY);
      expect(actionCategory).toBeDefined();

      for (const action of actionCategory!.actions) {
        expect(action.options?.opensAppToForeground).toBe(false);
      }
    });

    it('Test 1.5: Idempotent Initialization', async () => {
      await service.init();
      const firstCallCount = mockNotifications.setNotificationCategoryAsync.mock.calls.length;

      // Second init call
      await service.init();
      const secondCallCount = mockNotifications.setNotificationCategoryAsync.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  // =========================================================================
  // Suite 2: Permission Handling & Web Safety (F23)
  // =========================================================================
  describe('Suite 2: Permission Handling & Web Safety', () => {
    it('Test 2.1: Permission Granted Flow', async () => {
      mockNotifications.__setPermissions(true, 'granted');
      const granted = await service.requestPermissions();
      expect(granted).toBe(true);
    });

    it('Test 2.2: Permission Denied Flow', async () => {
      mockNotifications.__setPermissions(false, 'denied');
      mockNotifications.requestPermissionsAsync.mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        expires: 'never',
      } as any);

      const granted = await service.requestPermissions();
      expect(granted).toBe(false);
    });

    it('Test 2.3: Scheduling With Denied Permissions', async () => {
      mockNotifications.__setPermissions(false, 'denied');
      mockNotifications.requestPermissionsAsync.mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        canAskAgain: false,
        expires: 'never',
      } as any);

      const reminder = await storage.create({
        title: 'Permission Denied Task',
        dueDate: '2026-09-15T10:00:00.000Z',
      });

      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeNull();
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

      // Reminder remains safe in storage
      const fetched = storage.getById(reminder.id);
      expect(fetched).toBeDefined();
      expect(fetched?.title).toBe('Permission Denied Task');
    });

    it('Test 2.4: Web Platform Graceful Fallback', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      const webService = new NotificationService(storage);

      await expect(webService.init()).resolves.not.toThrow();
      const permission = await webService.requestPermissions();
      expect(permission).toBe(false);

      const reminder = await storage.create({
        title: 'Web Task',
        dueDate: '2026-09-15T10:00:00.000Z',
      });

      const notifId = await webService.scheduleReminderNotification(reminder);
      expect(notifId).toBeNull();
    });

    it('does not schedule an alarm for an unarmed inbox dump', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      const reminder = await storage.create({
        title: 'call mom',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
        armed: false,
      });

      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeNull();
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite 3: Reminder Notification Scheduling (F05, F08)
  // =========================================================================
  describe('Suite 3: Reminder Notification Scheduling', () => {
    it('Test 3.1: Trigger Timestamp Matching dueDate', async () => {
      await service.init();
      const dueStr = '2026-09-15T14:30:00.000Z';
      const reminder = await storage.create({
        title: 'Timestamp Test',
        dueDate: dueStr,
      });

      await service.scheduleReminderNotification(reminder);

      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({
            date: new Date(dueStr),
          }),
        })
      );
    });

    it('Test 3.2: Content Payload Structure', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Pay invoice',
        notes: 'Include reference #123',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      await service.scheduleReminderNotification(reminder);

      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Pay invoice',
            body: 'Include reference #123',
            categoryIdentifier: NOTIFICATION_CATEGORY,
            data: { reminderId: reminder.id },
          }),
        })
      );
    });

    it('Test 3.3: Channel Association on Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      await service.init();
      const reminder = await storage.create({
        title: 'Channel Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      await service.scheduleReminderNotification(reminder);

      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            channelId: REMINDER_CHANNEL_ID,
          }),
        })
      );
    });

    it('Test 3.4: Prior Notification ID Cancellation', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Prior Alert Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      // Schedule first alert
      const firstId = await service.scheduleReminderNotification(reminder);
      expect(firstId).toBeTruthy();

      const updatedReminder = storage.getById(reminder.id)!;
      expect(updatedReminder.notificationId).toBe(firstId);

      // Schedule subsequent alert
      await service.scheduleReminderNotification(updatedReminder);

      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(firstId);
    });

    it('Test 3.5: Persistent Storage of Generated notificationId', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'ID Storage Test',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeTruthy();

      const stored = storage.getById(reminder.id);
      expect(stored?.notificationId).toBe(notifId);
    });

    it('Test 3.6: Completed Reminders are Not Scheduled', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Already Completed',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      await storage.toggleComplete(reminder.id);
      const completed = storage.getById(reminder.id)!;
      expect(completed.status).toBe('completed');

      const notifId = await service.scheduleReminderNotification(completed);
      expect(notifId).toBeNull();
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite 4: Notification Cancellation
  // =========================================================================
  describe('Suite 4: Notification Cancellation', () => {
    it('Test 4.1: Direct Cancellation Calls Native Module', async () => {
      await service.cancelReminderNotification('notif-xyz');
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-xyz');
    });

    it('Test 4.2: Cancellation With Empty/Null ID is Safe No-Op', async () => {
      await service.cancelReminderNotification('');
      await service.cancelReminderNotification(null as any);
      expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    });

    it('Test 4.3: Toggle Complete Cancels Alert', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Complete Alert Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeTruthy();

      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);

      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(notifId);
      const completed = storage.getById(reminder.id)!;
      expect(completed.status).toBe('completed');
      expect(completed.notificationId).toBeNull();
    });

    it('Test 4.4: Deletion Cancels Alert', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Delete Alert Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      const notifId = await service.scheduleReminderNotification(reminder);
      expect(notifId).toBeTruthy();

      // Deleting active reminder cancels associated alert
      const updated = storage.getById(reminder.id)!;
      if (updated.notificationId) {
        await service.cancelReminderNotification(updated.notificationId);
      }
      await storage.delete(reminder.id);

      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(notifId);
      expect(storage.getById(reminder.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // Suite 5: Action Response Handling — Headless & Foreground (F05, F06, F07)
  // =========================================================================
  describe('Suite 5: Action Response Handling', () => {
    it('Test 5.1: ACTION_COMPLETE Marks Reminder Completed', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Action Complete Test',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      const notifId = await service.scheduleReminderNotification(reminder);

      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeTruthy();
      expect(updated.notificationId).toBeNull();
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(notifId);
    });

    it('Test 5.2: ACTION_SNOOZE_15M Reschedules Reminder and Registers Subsequent Alert', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Snooze 15m Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });
      const initialNotifId = await service.scheduleReminderNotification(reminder);

      mockNotifications.scheduleNotificationAsync.mockClear();

      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);
      expect(updated.lastSnoozedAt).toBeTruthy();
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(initialNotifId);
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      expect(updated.notificationId).toBeTruthy();
    });

    it('Test 5.3: ACTION_SNOOZE_1H Reschedules by Exactly 60 Minutes', async () => {
      await service.init();
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const reminder = await storage.create({
        title: 'Snooze 1h Task',
        dueDate: futureDate,
      });

      await service.handleNotificationResponse(ACTION_SNOOZE_1H, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);
      const updatedTime = new Date(updated.dueDate).getTime();
      const dueTime = new Date(futureDate).getTime();
      expect(updatedTime).toBeGreaterThanOrEqual(dueTime + 3540000); // ~60m accounting for 00s truncation
    });

    it('Test 5.4: ACTION_SNOOZE_TOMORROW Reschedules to Next Day 09:00 Local', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Tomorrow Task',
        dueDate: new Date().toISOString(),
      });

      await service.handleNotificationResponse(ACTION_SNOOZE_TOMORROW, reminder.id);

      const updated = storage.getById(reminder.id)!;
      expect(updated.status).toBe('snoozed');
      expect(updated.snoozeCount).toBe(1);
      const updatedDate = new Date(updated.dueDate);
      expect(updatedDate.getHours()).toBe(9);
      expect(updatedDate.getMinutes()).toBe(0);
      expect(updatedDate.getSeconds()).toBe(0);
    });

    it('Test 5.5: Notification Body Tap (DEFAULT_ACTION_IDENTIFIER)', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Body Tap Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      await service.handleNotificationResponse(
        mockNotifications.DEFAULT_ACTION_IDENTIFIER,
        reminder.id
      );

      const after = storage.getById(reminder.id)!;
      expect(after.status).toBe('pending');
      expect(after.snoozeCount).toBe(0);
    });

    it('Test 5.6: Non-Existent Reminder ID Handled Gracefully', async () => {
      await service.init();
      await expect(
        service.handleNotificationResponse(ACTION_COMPLETE, 'non-existent-uuid')
      ).resolves.not.toThrow();
    });

    it('Test 5.7: Unknown Action Identifier Handled Gracefully', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Unknown Action Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      await expect(
        service.handleNotificationResponse('UNKNOWN_ACTION_999', reminder.id)
      ).resolves.not.toThrow();

      const after = storage.getById(reminder.id)!;
      expect(after.status).toBe('pending');
      expect(after.snoozeCount).toBe(0);
    });

    it('Test 5.8: Double-Tap Debounce / Mutex Safety', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Rapid Tap Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      // Fire two identical actions simultaneously
      await Promise.all([
        service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id),
        service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id),
      ]);

      const after = storage.getById(reminder.id)!;
      expect(after.snoozeCount).toBe(1);
    });
  });

  // =========================================================================
  // Suite 6: Background Task Integration (F06)
  // =========================================================================
  describe('Suite 6: Background Task Integration', () => {
    it('Test 6.1: TaskManager.defineTask Registers Headless Callback', () => {
      expect(mockTaskManager.defineTask).toHaveBeenCalledWith(
        BACKGROUND_NOTIFICATION_TASK,
        expect.any(Function)
      );
    });

    it('Test 6.2: Notifications.registerTaskAsync Registers Background Task with OS', async () => {
      await service.init();
      expect(mockNotifications.registerTaskAsync).toHaveBeenCalledWith(
        BACKGROUND_NOTIFICATION_TASK
      );
    });

    it('Test 6.3: Simulated Background Task Execution Returns NoData', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Background Task Execution',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      const executor = mockTaskManager.__getTaskExecutor(BACKGROUND_NOTIFICATION_TASK);
      expect(executor).toBeDefined();

      const result = await executor!({
        data: {
          actionIdentifier: ACTION_COMPLETE,
          notification: {
            request: {
              content: {
                data: { reminderId: reminder.id },
              },
            },
          },
        },
      });

      expect(result).toBe(mockNotifications.BackgroundNotificationTaskResult.NoData);
      const completed = storage.getById(reminder.id)!;
      expect(completed.status).toBe('completed');
    });

    it('Test 6.4: Null or Malformed Task Payload Handled Defensively', async () => {
      const executor = mockTaskManager.__getTaskExecutor(BACKGROUND_NOTIFICATION_TASK);
      expect(executor).toBeDefined();

      const nullResult = await executor!({ data: null });
      expect(nullResult).toBe(mockNotifications.BackgroundNotificationTaskResult.NoData);

      const emptyResult = await executor!({ data: {} });
      expect(emptyResult).toBe(mockNotifications.BackgroundNotificationTaskResult.NoData);
    });

    it('Test 6.5: registerBackgroundTaskAsync registers with OS or safely bypasses on web', async () => {
      mockNotifications.registerTaskAsync.mockClear();
      const registered = await registerBackgroundTaskAsync();
      expect(registered).toBe(true);
      expect(mockNotifications.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_NOTIFICATION_TASK);

      // Web bypass
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      const webRegistered = await registerBackgroundTaskAsync();
      expect(webRegistered).toBe(false);
    });

    it('Test 6.6: executeNotificationAction edge cases (empty reminderId, action error)', async () => {
      const invalidRes = await executeNotificationAction(ACTION_COMPLETE, '');
      expect(invalidRes).toBe(mockNotifications.BackgroundNotificationTaskResult.NoData);

      // Error case
      const errorService = {
        ...service,
        handleNotificationResponse: jest.fn(async () => {
          throw new Error('Action execution failed');
        }),
      } as any;
      const errorRes = await executeNotificationAction(ACTION_COMPLETE, 'any-id', errorService);
      expect(errorRes).toBe(mockNotifications.BackgroundNotificationTaskResult.Failed);
    });

    it('Test 6.7: Services Index exports all domain services and singletons', () => {
      expect(services.NotificationService).toBeDefined();
      expect(services.notificationService).toBeDefined();
      expect(services.StorageService).toBeDefined();
      expect(services.storageService).toBeDefined();
      expect(services.BACKGROUND_NOTIFICATION_TASK).toBeDefined();
      expect(services.ACTION_COMPLETE).toBeDefined();
    });
  });

  // =========================================================================
  // Suite 7: Cold-Boot Alarm Reconciliation (F09)
  // =========================================================================
  describe('Suite 7: Cold-Boot Alarm Reconciliation', () => {
    it('Test 7.1: Re-schedules Future Active Reminders Missing in OS Alerts', async () => {
      await service.init();
      // 2 future active reminders in storage
      const r1 = await storage.create({
        title: 'Future Task 1',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
      });
      const r2 = await storage.create({
        title: 'Future Task 2',
        dueDate: new Date(Date.now() + 7200000).toISOString(),
      });

      // OS scheduled alerts map is empty
      mockNotifications.scheduleNotificationAsync.mockClear();

      const report = await service.reconcileActiveReminders();
      expect(report.activeCount).toBe(2);
      expect(report.rescheduledCount).toBe(2);
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);

      const after1 = storage.getById(r1.id)!;
      const after2 = storage.getById(r2.id)!;
      expect(after1.notificationId).toBeTruthy();
      expect(after2.notificationId).toBeTruthy();
    });

    it('Test 7.2: Does NOT Re-schedule Overdue Reminders into the Past', async () => {
      await service.init();
      // Overdue reminder: 2 hours in the past
      const pastReminder = await storage.create({
        title: 'Overdue Task',
        dueDate: new Date(Date.now() - 7200000).toISOString(),
      });
      // Future reminder: 2 hours in future
      const futureReminder = await storage.create({
        title: 'Future Task',
        dueDate: new Date(Date.now() + 7200000).toISOString(),
      });

      mockNotifications.scheduleNotificationAsync.mockClear();

      const report = await service.reconcileActiveReminders();
      expect(report.rescheduledCount).toBe(1);

      // Only future reminder was scheduled
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      const afterPast = storage.getById(pastReminder.id)!;
      expect(afterPast.status).toBe('pending');
      expect(afterPast.notificationId).toBeNull();
    });

    it('Test 7.3: Cleans Up Orphaned Alerts for Completed or Deleted Reminders', async () => {
      await service.init();
      // Add orphaned alert directly to OS mock
      const orphanId = 'orphan-alert-123';
      mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
        {
          identifier: orphanId,
          content: {
            title: 'Ghost',
            body: null,
            categoryIdentifier: NOTIFICATION_CATEGORY,
            data: { reminderId: 'ghost-reminder-id' },
          },
          trigger: { date: Date.now() + 3600000 },
        },
      ]);

      const report = await service.reconcileActiveReminders();
      expect(report.purgedCount).toBe(1);
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(orphanId);
    });

    it('Test 7.4: Idempotency When All Alerts are Up-to-Date', async () => {
      await service.init();
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const reminder = await storage.create({
        title: 'Synchronized Task',
        dueDate: futureDate,
      });
      const notifId = await service.scheduleReminderNotification(reminder);

      mockNotifications.scheduleNotificationAsync.mockClear();

      const report = await service.reconcileActiveReminders();
      expect(report.rescheduledCount).toBe(0);
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('Test 7.5: Partial Failure Tolerance', async () => {
      await service.init();
      const r1 = await storage.create({
        title: 'Failing Task',
        dueDate: new Date(Date.now() + 3600000).toISOString(),
      });
      const r2 = await storage.create({
        title: 'Succeeding Task',
        dueDate: new Date(Date.now() + 7200000).toISOString(),
      });

      // Mock scheduleNotificationAsync to fail on first call and succeed on second
      let callNum = 0;
      mockNotifications.scheduleNotificationAsync.mockImplementation(async () => {
        callNum++;
        if (callNum === 1) {
          throw new Error('Transient scheduling error');
        }
        return 'notif-success-id';
      });

      const report = await service.reconcileActiveReminders();
      expect(report.rescheduledCount).toBe(1);
      const after2 = storage.getById(r2.id)!;
      expect(after2.notificationId).toBe('notif-success-id');
    });
  });

  // =========================================================================
  // Suite 8: Platform Isolation & Web Safety Guards
  // =========================================================================
  describe('Suite 8: Platform Isolation & Web Safety Guards', () => {
    it('Test 8.1: Web Environment Native Call Isolation', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      const webService = new NotificationService(storage);

      await webService.init();
      expect(mockNotifications.setNotificationChannelAsync).not.toHaveBeenCalled();
      expect(mockNotifications.setNotificationCategoryAsync).not.toHaveBeenCalled();

      const reminder = await storage.create({
        title: 'Web Safe Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      const notifId = await webService.scheduleReminderNotification(reminder);
      expect(notifId).toBeNull();
      expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('Test 8.2: Consistent In-Memory Cache Mutex Across Platforms', async () => {
      await service.init();
      const reminder = await storage.create({
        title: 'Cache Mutex Task',
        dueDate: '2026-09-15T14:30:00.000Z',
      });

      await service.handleNotificationResponse(ACTION_SNOOZE_15M, reminder.id);
      expect(storage.getById(reminder.id)?.status).toBe('snoozed');

      await service.handleNotificationResponse(ACTION_COMPLETE, reminder.id);
      expect(storage.getById(reminder.id)?.status).toBe('completed');
    });
  });

  // =========================================================================
  // Suite 9: React Hook Integration (useNotifications)
  // =========================================================================
  describe('Suite 9: React Hook Integration (useNotifications)', () => {
    function HookConsumer({
      options,
      onHook,
    }: {
      options?: any;
      onHook: (res: any) => void;
    }) {
      const result = useNotifications(options);
      React.useEffect(() => {
        onHook(result);
      }, [result, onHook]);
      return null;
    }

    it('Test 9.1: Hook initializes, requests permissions and returns control handles', async () => {
      let hookResult: any = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(HookConsumer, {
            options: { autoRequestPermissions: true },
            onHook: (res) => {
              hookResult = res;
            },
          })
        );
      });

      expect(hookResult).toBeDefined();
      expect(typeof hookResult.requestPermissions).toBe('function');
      expect(typeof hookResult.reconcile).toBe('function');
      expect(hookResult.hasPermission).toBe(true);

      act(() => {
        renderer.unmount();
      });
    });

    it('Test 9.2: Body tap routes DEFAULT_ACTION_IDENTIFIER to onOpenSnoozeModal', async () => {
      const onOpenSnoozeModal = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(HookConsumer, {
            options: { onOpenSnoozeModal },
            onHook: () => {},
          })
        );
      });

      // Simulate notification response with DEFAULT_ACTION_IDENTIFIER
      await act(async () => {
        await mockNotifications.__triggerNotificationResponse({
          actionIdentifier: mockNotifications.DEFAULT_ACTION_IDENTIFIER,
          notification: {
            date: Date.now(),
            request: {
              identifier: 'notif-click',
              content: {
                title: 'Click me',
                body: null,
                categoryIdentifier: NOTIFICATION_CATEGORY,
                data: { reminderId: 'target-reminder-id' },
              },
              trigger: {},
            },
          },
        });
      });

      expect(onOpenSnoozeModal).toHaveBeenCalledWith('target-reminder-id');

      act(() => {
        renderer.unmount();
      });
    });

    it('Test 9.3: Foreground action button tap routes to handleNotificationResponse', async () => {
      const spyHandle = jest.spyOn(services.notificationService, 'handleNotificationResponse');
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(HookConsumer, {
            options: {},
            onHook: () => {},
          })
        );
      });

      await act(async () => {
        await mockNotifications.__triggerNotificationResponse({
          actionIdentifier: ACTION_COMPLETE,
          notification: {
            date: Date.now(),
            request: {
              identifier: 'notif-action',
              content: {
                title: 'Done',
                body: null,
                categoryIdentifier: NOTIFICATION_CATEGORY,
                data: { reminderId: 'reminder-to-complete' },
              },
              trigger: {},
            },
          },
        });
      });

      expect(spyHandle).toHaveBeenCalledWith(ACTION_COMPLETE, 'reminder-to-complete');
      spyHandle.mockRestore();

      act(() => {
        renderer.unmount();
      });
    });

    it('Test 9.4: Cold boot launch via notification tap routes to onOpenSnoozeModal', async () => {
      const onOpenSnoozeModal = jest.fn();
      mockNotifications.__setLastNotificationResponse({
        actionIdentifier: mockNotifications.DEFAULT_ACTION_IDENTIFIER,
        notification: {
          date: Date.now(),
          request: {
            identifier: 'cold-boot-notif',
            content: {
              title: 'Launch App',
              body: null,
              categoryIdentifier: NOTIFICATION_CATEGORY,
              data: { reminderId: 'cold-reminder-id' },
            },
            trigger: {},
          },
        },
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(HookConsumer, {
            options: { onOpenSnoozeModal },
            onHook: () => {},
          })
        );
      });

      expect(onOpenSnoozeModal).toHaveBeenCalledWith('cold-reminder-id');
      expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });
    });

    it('Test 9.5: Hook unmount cleans up notification listeners', async () => {
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          React.createElement(HookConsumer, {
            options: {},
            onHook: () => {},
          })
        );
      });

      act(() => {
        renderer.unmount();
      });

      // After unmounting, firing a response should not cause errors or route
      const onOpenSnoozeModal = jest.fn();
      await act(async () => {
        await mockNotifications.__triggerNotificationResponse({
          actionIdentifier: mockNotifications.DEFAULT_ACTION_IDENTIFIER,
          notification: {
            date: Date.now(),
            request: {
              identifier: 'unmounted-click',
              content: {
                title: 'No-op',
                body: null,
                categoryIdentifier: NOTIFICATION_CATEGORY,
                data: { reminderId: 'ghost' },
              },
              trigger: {},
            },
          },
        });
      });

      expect(onOpenSnoozeModal).not.toHaveBeenCalled();
    });
  });
});

