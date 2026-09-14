/**
 * Notification Service - Chromium Compliant Actionable Notifications
 * Enforces strict 2-button layout: [{ title: '+15m' }, { title: 'Complete' }].
 * Chromium strictly caps notification buttons at 2 (maxItems: 2).
 */

import { Reminder } from '../types/reminder';
import { storageService } from './storageService';
import { scheduleAlarm, clearAlarm, updateOverdueBadge } from './alarmService';

export const NOTIFICATION_BUTTONS: chrome.notifications.ButtonOptions[] = [
  { title: '+15m' },    // Button 0: Snooze 15 minutes
  { title: 'Complete' }, // Button 1: Complete and archive
];

// Re-export or hook for triggering sync
type SyncTrigger = () => Promise<any>;
let onSyncTrigger: SyncTrigger | null = null;

export function registerSyncTrigger(fn: SyncTrigger) {
  onSyncTrigger = fn;
}

export function createNotificationOptions(
  reminder: Reminder
): chrome.notifications.NotificationOptions<true> {
  const iconUrl =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('icons/icon-128.png')
      : 'icons/icon-128.png';

  const notesText = reminder.notes ? `\n${reminder.notes}` : '';

  return {
    type: 'basic',
    iconUrl,
    title: reminder.title,
    message: `Due now${notesText}`,
    contextMessage: 'Remy Prospective Memory',
    buttons: NOTIFICATION_BUTTONS,
    requireInteraction: true,
    priority: 2,
  };
}

export async function showNotification(reminder: Reminder): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.notifications) {
    return reminder.id;
  }

  const options = createNotificationOptions(reminder);
  return new Promise<string>((resolve) => {
    chrome.notifications.create(reminder.id, options, (id) => {
      resolve(id || reminder.id);
    });
  });
}

export async function handleNotificationButtonClick(
  notificationId: string,
  buttonIndex: number
): Promise<{ action: 'snoozed' | 'completed' | 'unknown'; reminder?: Reminder }> {
  await storageService.init();
  const reminder = storageService.getById(notificationId);
  if (!reminder) {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      await chrome.notifications.clear(notificationId);
    }
    return { action: 'unknown' };
  }

  const now = new Date();

  if (buttonIndex === 0) {
    // Button 0: Snooze +15m
    const snoozeDueDate = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const updated: Reminder = {
      ...reminder,
      dueDate: snoozeDueDate,
      status: 'snoozed',
      snoozeCount: (reminder.snoozeCount || 0) + 1,
      lastSnoozedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await storageService.saveReminder(updated);
    await scheduleAlarm(updated);
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      await chrome.notifications.clear(notificationId);
    }
    await updateOverdueBadge();
    if (onSyncTrigger) {
      onSyncTrigger().catch((e) => console.warn('[Notification] Sync trigger failed:', e));
    }
    return { action: 'snoozed', reminder: updated };
  }

  if (buttonIndex === 1) {
    // Button 1: Complete
    const updated: Reminder = {
      ...reminder,
      status: 'completed',
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await storageService.saveReminder(updated);
    await clearAlarm(reminder.id);
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      await chrome.notifications.clear(notificationId);
    }
    await updateOverdueBadge();
    if (onSyncTrigger) {
      onSyncTrigger().catch((e) => console.warn('[Notification] Sync trigger failed:', e));
    }
    return { action: 'completed', reminder: updated };
  }

  return { action: 'unknown', reminder };
}

export async function handleNotificationClick(
  notificationId: string
): Promise<void> {
  // Clear notification
  if (typeof chrome !== 'undefined' && chrome.notifications) {
    await chrome.notifications.clear(notificationId);
  }

  // Open Quick Action HUD in active tab, or open Side Panel / Tab as fallback
  if (typeof chrome !== 'undefined') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_HUD' });
        return;
      }
    } catch {
      // Content script may not be available on restricted pages; open side panel or tab
    }

    if (chrome.sidePanel && 'open' in chrome.sidePanel) {
      try {
        const [window] = await chrome.windows?.getCurrent ? [await chrome.windows.getCurrent()] : [{ id: 1 }];
        if (window?.id) {
          await (chrome.sidePanel as any).open({ windowId: window.id });
          return;
        }
      } catch {
        // Fallback
      }
    }

    // Fallback for Firefox/Zen or restricted pages: Open Swiss Void Agenda in tab
    try {
      if (chrome.tabs?.create && chrome.runtime?.getURL) {
        const url = chrome.runtime.getURL('src/sidepanel/sidepanel.html');
        await chrome.tabs.create({ url });
      }
    } catch {
      // Ignore
    }
  }
}
