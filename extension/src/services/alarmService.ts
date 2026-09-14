/**
 * Alarm Service - Background Reminders & Startup Overdue Gate
 * Schedules reminders using persistent chrome.alarms.
 * Suppresses notifications for alarms overdue by > 1 hour on startup to prevent alert storms.
 */

import { Reminder, isReminderArmed } from '../types/reminder';
import { storageService } from './storageService';

export const ONE_HOUR_MS = 3600000; // 1 hour in milliseconds (3,600,000)

export function evaluateStartupGate(
  reminder: Reminder,
  nowMs: number = Date.now()
): 'suppress' | 'notify' {
  const dueMs = new Date(reminder.dueDate).getTime();
  const overdueMs = nowMs - dueMs;

  if (overdueMs > ONE_HOUR_MS) {
    return 'suppress';
  }
  return 'notify';
}

export async function updateOverdueBadge(count?: number): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.action) return;

  const overdue =
    typeof count === 'number'
      ? count
      : calculateOverdueCount();

  if (overdue > 0) {
    await chrome.action.setBadgeText({ text: String(overdue) });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF4500' });
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}

export function calculateOverdueCount(nowMs: number = Date.now()): number {
  const all = storageService.getActive();
  return all.filter((r) => {
    if (!isReminderArmed(r)) return false;
    const dueMs = new Date(r.dueDate).getTime();
    return dueMs <= nowMs;
  }).length;
}

export async function scheduleAlarm(reminder: Reminder): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  if (!isReminderArmed(reminder) || reminder.isDeleted || reminder.status === 'completed') {
    return;
  }

  const when = new Date(reminder.dueDate).getTime();
  // If the due time is in the past, chrome.alarms.create with `when` will fire promptly
  await chrome.alarms.create(reminder.id, { when });
}

export async function clearAlarm(reminderId: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return false;
  return await chrome.alarms.clear(reminderId);
}

export async function clearAllAlarms(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return false;
  return await chrome.alarms.clearAll();
}

/**
 * Handle alarm triggering from chrome.alarms.onAlarm
 */
export async function handleAlarmEvent(
  alarmName: string,
  notifier?: (reminder: Reminder) => Promise<any>
): Promise<'suppressed' | 'notified' | 'ignored'> {
  await storageService.init();
  const reminder = storageService.getById(alarmName);

  if (!reminder || reminder.isDeleted || reminder.status === 'completed' || !isReminderArmed(reminder)) {
    return 'ignored';
  }

  const gateResult = evaluateStartupGate(reminder);

  if (gateResult === 'suppress') {
    // Suppress notification popup quietly and update badge count with #FF4500
    await updateOverdueBadge();
    return 'suppressed';
  }

  // Under the threshold (<= 1 hour overdue or due now): fire notification
  if (notifier) {
    await notifier(reminder);
  }
  await updateOverdueBadge();
  return 'notified';
}

/**
 * Startup hook: processes active reminders and avoids alert storms
 */
export async function handleStartupGate(
  notifier?: (reminder: Reminder) => Promise<any>
): Promise<{ overdueCount: number; suppressedCount: number; notifiedCount: number }> {
  await storageService.init();
  const now = Date.now();
  const activeReminders = storageService.getActive().filter((r) => isReminderArmed(r));

  let suppressedCount = 0;
  let notifiedCount = 0;

  for (const reminder of activeReminders) {
    const dueMs = new Date(reminder.dueDate).getTime();
    if (dueMs <= now) {
      const gate = evaluateStartupGate(reminder, now);
      if (gate === 'suppress') {
        suppressedCount++;
      } else {
        notifiedCount++;
        if (notifier) {
          await notifier(reminder);
        }
      }
    } else {
      // Re-arm future alarms
      await scheduleAlarm(reminder);
    }
  }

  const overdueCount = calculateOverdueCount(now);
  await updateOverdueBadge(overdueCount);

  return { overdueCount, suppressedCount, notifiedCount };
}
