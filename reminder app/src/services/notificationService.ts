/**
 * Remy Reminders - Actionable Notification Service
 * Milestone 2 Implementation
 *
 * Provides:
 * 1. Android MAX channel ('remy_reminders_high_priority') configuration
 * 2. Actionable Category ('remy_reminder_actions') with Complete, +15m, +1h, Tomorrow
 * 3. Foreground Notification Presentation Handler (SDK 57 compliant)
 * 4. Local Notification Scheduling with Reminder payload
 * 5. Notification Response handling with snooze math (T_base = max(now, due))
 * 6. Cold-boot alarm reconciliation (reconcileActiveReminders)
 * 7. Web platform safety guards (Platform.OS !== 'web')
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Reminder } from '../types/reminder';
import { storageService, IReminderRepository } from './storageService';
import {
  calculate15Minutes,
  calculate1Hour,
  calculateTomorrowMorning,
} from '../utils/snoozeCalculator';

export const REMINDER_CHANNEL_ID = 'remy_reminders_high_priority';
export const ANDROID_CHANNEL_ID = REMINDER_CHANNEL_ID; // alias for backwards compatibility
export const NOTIFICATION_CATEGORY = 'remy_reminder_actions';
export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

// Action Identifiers (canonical prefixed and accepted short forms)
export const ACTION_COMPLETE = 'remy_action_complete';
export const ACTION_SNOOZE_15M = 'remy_action_snooze_15m';
export const ACTION_SNOOZE_1H = 'remy_action_snooze_1h';
export const ACTION_SNOOZE_TOMORROW = 'remy_action_snooze_tomorrow';

export interface INotificationService {
  init(): Promise<void>;
  requestPermissions(): Promise<boolean>;
  scheduleReminderNotification(reminder: Reminder): Promise<string | null>;
  cancelReminderNotification(notificationId: string): Promise<void>;
  handleNotificationResponse(actionIdentifier: string, reminderId: string): Promise<void>;
  reconcileActiveReminders(): Promise<{ activeCount: number; rescheduledCount: number; purgedCount: number }>;
}

export class NotificationService implements INotificationService {
  private repository: IReminderRepository;
  private initialized: boolean = false;
  private activeActionLocks: Set<string> = new Set();
  private lastActionTimestamps: Map<string, { action: string; timestamp: number }> = new Map();

  constructor(repository: IReminderRepository = storageService) {
    this.repository = repository;
  }

  /**
   * Initializes notification channel, category, and handlers.
   * Safe to call on all platforms; no-ops native-only APIs on Web.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (Platform.OS === 'web') {
      this.initialized = true;
      return;
    }

    try {
      // 1. Foreground Presentation Handler (SDK 57 compliant)
      if (typeof Notifications.setNotificationHandler === 'function') {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            priority: Notifications.AndroidNotificationPriority?.MAX,
          }),
        });
      }

      // 2. Android Channel Setup (MAX importance, vibration pattern, sound, heads-up)
      if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
        await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
          name: 'Reminders',
          description: 'High-priority prospective memory reminders and snoozes',
          importance: Notifications.AndroidImportance?.MAX ?? 7,
          sound: 'default',
          vibrationPattern: [0, 250, 250, 250],
          enableVibrate: true,
          enableLights: true,
          lightColor: '#FF4500', // Swiss accent orange
          lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
          showBadge: true,
          bypassDnd: true,
        });
      }

      // 3. Actionable Category Setup (4 actions with opensAppToForeground: false)
      if (typeof Notifications.setNotificationCategoryAsync === 'function') {
        await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY, [
          {
            identifier: ACTION_COMPLETE,
            buttonTitle: 'Complete',
            options: { opensAppToForeground: false },
          },
          {
            identifier: ACTION_SNOOZE_15M,
            buttonTitle: '+15m',
            options: { opensAppToForeground: false },
          },
          {
            identifier: ACTION_SNOOZE_1H,
            buttonTitle: '+1h',
            options: { opensAppToForeground: false },
          },
          {
            identifier: ACTION_SNOOZE_TOMORROW,
            buttonTitle: 'Tomorrow',
            options: { opensAppToForeground: false },
          },
        ]);
      }

      // 4. Register headless background task if available
      try {
        if (typeof Notifications.registerTaskAsync === 'function') {
          await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
        }
      } catch (e) {
        // Safe fallback
      }

      this.initialized = true;
    } catch (error) {
      console.warn('NotificationService: Failed to complete full native init:', error);
      this.initialized = true;
    }
  }

  /**
   * Non-blocking permission check and request
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') {
      return false;
    }

    try {
      if (typeof Notifications.getPermissionsAsync !== 'function') {
        return false;
      }

      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        return true;
      }

      if (canAskAgain || status === 'undetermined') {
        if (typeof Notifications.requestPermissionsAsync === 'function') {
          const result = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          });
          return result.status === 'granted';
        }
      }

      return false;
    } catch (error) {
      console.warn('NotificationService: Error requesting permissions:', error);
      return false;
    }
  }

  /**
   * Schedules a local notification for an active reminder
   */
  async scheduleReminderNotification(reminder: Reminder): Promise<string | null> {
    if (Platform.OS === 'web' || reminder.status === 'completed') {
      return null;
    }

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return null;
      }

      // Cancel any prior notification
      if (reminder.notificationId) {
        await this.cancelReminderNotification(reminder.notificationId);
      }

      const targetDate = new Date(reminder.dueDate);
      if (isNaN(targetDate.getTime())) {
        return null;
      }

      if (typeof Notifications.scheduleNotificationAsync !== 'function') {
        return null;
      }

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title,
          body: reminder.notes || undefined,
          categoryIdentifier: NOTIFICATION_CATEGORY,
          data: { reminderId: reminder.id },
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority?.MAX,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes?.DATE ?? 'date',
          date: targetDate,
          channelId: REMINDER_CHANNEL_ID,
        } as any,
      });

      await this.repository.setNotificationId(reminder.id, notificationId);
      return notificationId;
    } catch (error) {
      console.warn(`NotificationService: Error scheduling notification for reminder "${reminder.id}":`, error);
      return null;
    }
  }

  /**
   * Cancels a scheduled notification safely
   */
  async cancelReminderNotification(notificationId: string): Promise<void> {
    if (Platform.OS === 'web' || !notificationId) {
      return;
    }

    try {
      if (typeof Notifications.cancelScheduledNotificationAsync === 'function') {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      }
    } catch (error) {
      console.warn(`NotificationService: Error cancelling notification "${notificationId}":`, error);
    }
  }

  /**
   * Handles user interaction with actionable category buttons (Complete, +15m, +1h, Tomorrow).
   * Supports double-tap debouncing and mutex protection against race conditions.
   */
  async handleNotificationResponse(actionIdentifier: string, reminderId: string): Promise<void> {
    if (!reminderId || typeof reminderId !== 'string') {
      return;
    }

    // Debounce / Concurrency Mutex Check
    const now = Date.now();
    const last = this.lastActionTimestamps.get(reminderId);
    if (
      this.activeActionLocks.has(reminderId) ||
      (last && last.action === actionIdentifier && now - last.timestamp < 200)
    ) {
      return;
    }

    this.activeActionLocks.add(reminderId);
    this.lastActionTimestamps.set(reminderId, { action: actionIdentifier, timestamp: now });

    try {
      await this.repository.init();

      const reminder = this.repository.getById(reminderId);
      if (!reminder) {
        return;
      }

      const isComplete =
        actionIdentifier === ACTION_COMPLETE || actionIdentifier === 'complete';
      const isSnooze15m =
        actionIdentifier === ACTION_SNOOZE_15M || actionIdentifier === 'snooze_15m';
      const isSnooze1h =
        actionIdentifier === ACTION_SNOOZE_1H || actionIdentifier === 'snooze_1h';
      const isSnoozeTomorrow =
        actionIdentifier === ACTION_SNOOZE_TOMORROW || actionIdentifier === 'snooze_tomorrow';

      if (isComplete) {
        if (reminder.status !== 'completed') {
          await this.repository.toggleComplete(reminderId);
        }
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
          await this.repository.setNotificationId(reminderId, null);
        }
        return;
      }

      if (isSnooze15m) {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculate15Minutes(new Date(), reminder.dueDate);
        const updated = await this.repository.snooze(reminderId, target, '15m');
        await this.scheduleReminderNotification(updated);
        return;
      }

      if (isSnooze1h) {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculate1Hour(new Date(), reminder.dueDate);
        const updated = await this.repository.snooze(reminderId, target, '1h');
        await this.scheduleReminderNotification(updated);
        return;
      }

      if (isSnoozeTomorrow) {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculateTomorrowMorning(new Date());
        const updated = await this.repository.snooze(reminderId, target, 'tomorrow_morning');
        await this.scheduleReminderNotification(updated);
        return;
      }

      // Default / unknown action: safely ignored without mutating state
    } finally {
      this.activeActionLocks.delete(reminderId);
    }
  }

  /**
   * Cold boot sweep: repairs missing alarms for active reminders and cancels orphaned notifications.
   */
  async reconcileActiveReminders(): Promise<{ activeCount: number; rescheduledCount: number; purgedCount: number }> {
    await this.repository.init();
    const activeReminders = await this.repository.reconcileActiveReminders();

    if (Platform.OS === 'web') {
      return { activeCount: activeReminders.length, rescheduledCount: 0, purgedCount: 0 };
    }

    if (typeof Notifications.getAllScheduledNotificationsAsync !== 'function') {
      return { activeCount: activeReminders.length, rescheduledCount: 0, purgedCount: 0 };
    }

    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    const scheduledById = new Map<string, any>();
    const scheduledByReminderId = new Map<string, any>();

    for (const notif of scheduledNotifications) {
      scheduledById.set(notif.identifier, notif);
      const rId = notif.content?.data?.reminderId as string | undefined;
      if (rId && typeof rId === 'string') {
        scheduledByReminderId.set(rId, notif);
      }
    }

    let rescheduledCount = 0;
    let purgedCount = 0;
    const now = Date.now();

    // 1. Repair missing future alerts for active reminders
    for (const reminder of activeReminders) {
      try {
        const hasScheduled =
          (reminder.notificationId && scheduledById.has(reminder.notificationId)) ||
          scheduledByReminderId.has(reminder.id);

        if (!hasScheduled) {
          const dueTime = new Date(reminder.dueDate).getTime();
          if (dueTime > now) {
            const newId = await this.scheduleReminderNotification(reminder);
            if (newId) {
              rescheduledCount++;
            }
          }
        } else if (scheduledByReminderId.has(reminder.id)) {
          const existing = scheduledByReminderId.get(reminder.id);
          if (existing && reminder.notificationId !== existing.identifier) {
            await this.repository.setNotificationId(reminder.id, existing.identifier);
          }
        }
      } catch (err) {
        console.warn(`reconcileActiveReminders: Error checking reminder ${reminder.id}:`, err);
      }
    }

    // 2. Purge orphaned scheduled notifications
    const activeIdSet = new Set(activeReminders.map((r) => r.id));
    for (const notif of scheduledNotifications) {
      try {
        const rId = notif.content?.data?.reminderId as string | undefined;
        if (!rId || typeof rId !== 'string' || !activeIdSet.has(rId)) {
          await Notifications.cancelScheduledNotificationAsync(notif.identifier);
          purgedCount++;
        }
      } catch (err) {
        console.warn(`reconcileActiveReminders: Error cancelling orphaned alert ${notif.identifier}:`, err);
      }
    }

    return {
      activeCount: activeReminders.length,
      rescheduledCount,
      purgedCount,
    };
  }

  /**
   * Alias for reconcileActiveReminders
   */
  async reconcileNotifications(): Promise<{ activeCount: number; rescheduledCount: number; purgedCount: number }> {
    return this.reconcileActiveReminders();
  }
}

export const notificationService = new NotificationService();
export default notificationService;
