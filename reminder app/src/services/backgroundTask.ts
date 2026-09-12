/**
 * Remy Reminders - Headless Background Notification Task
 * Milestone 2 Implementation
 *
 * Runs headless in background/terminated state when the user interacts
 * with actionable notification buttons from the system shade.
 */

import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import {
  notificationService,
  INotificationService,
  BACKGROUND_NOTIFICATION_TASK,
  NOTIFICATION_CATEGORY,
  REMINDER_CHANNEL_ID,
  ANDROID_CHANNEL_ID,
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  ACTION_SNOOZE_TOMORROW,
} from './notificationService';

export {
  BACKGROUND_NOTIFICATION_TASK,
  NOTIFICATION_CATEGORY,
  REMINDER_CHANNEL_ID,
  ANDROID_CHANNEL_ID,
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  ACTION_SNOOZE_TOMORROW,
};

/**
 * Executes a notification action button (Complete, +15m, +1h, Tomorrow).
 * Shared between headless background task and foreground response listener.
 */
export async function executeNotificationAction(
  actionIdentifier: string,
  reminderId: string,
  service: INotificationService = notificationService
): Promise<number> {
  if (!reminderId || typeof reminderId !== 'string') {
    return Notifications.BackgroundNotificationTaskResult?.NoData ?? 1;
  }

  try {
    await service.handleNotificationResponse(actionIdentifier, reminderId);
    return Notifications.BackgroundNotificationTaskResult?.NoData ?? 1;
  } catch (error) {
    console.error('executeNotificationAction error:', error);
    return Notifications.BackgroundNotificationTaskResult?.Failed ?? 2;
  }
}

/**
 * Registers the background notification task with expo-notifications
 */
export async function registerBackgroundTaskAsync(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  try {
    if (typeof Notifications.registerTaskAsync === 'function') {
      await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    }
    return true;
  } catch (error) {
    console.warn('registerBackgroundTaskAsync failed:', error);
    return false;
  }
}

// Module-level Task Definition (mandatory for headless JS execution)
export function defineBackgroundTask(service: INotificationService = notificationService): void {
  if (Platform.OS !== 'web' && typeof TaskManager.defineTask === 'function') {
    TaskManager.defineTask(
      BACKGROUND_NOTIFICATION_TASK,
      async ({ data, error }: { data?: any; error?: any } = {}) => {
        if (error) {
          console.error('Background notification task error:', error);
          return Notifications.BackgroundNotificationTaskResult?.Failed ?? 2;
        }

        if (!data) {
          return Notifications.BackgroundNotificationTaskResult?.NoData ?? 1;
        }

        const actionIdentifier =
          data.actionIdentifier ||
          data.notification?.actionIdentifier;

        const reminderId =
          data.reminderId ||
          data.notification?.request?.content?.data?.reminderId ||
          data.notification?.data?.reminderId;

        if (actionIdentifier && reminderId) {
          return executeNotificationAction(actionIdentifier, reminderId, service);
        }

        return Notifications.BackgroundNotificationTaskResult?.NoData ?? 1;
      }
    );
  }
}

defineBackgroundTask();

export default registerBackgroundTaskAsync;
