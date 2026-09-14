/**
 * Remy Web Browser Extension - Background Service Worker
 * Manifest V3 entry point coordinating alarms, notifications, omnibox, context menus, and sync.
 */

import { storageService } from '../services/storageService';
import { handleAlarmEvent, handleStartupGate, scheduleAlarm, updateOverdueBadge } from '../services/alarmService';
import {
  showNotification,
  handleNotificationButtonClick,
  handleNotificationClick,
} from '../services/notificationService';
import { setupOmnibox } from './omnibox';
import { setupContextMenus } from './contextMenus';
import { syncService } from '../services/syncService';
import { Reminder } from '../types/reminder';

// 1. Initialize Storage & Ingress
storageService.init().then(() => {
  updateOverdueBadge();
});
setupOmnibox();
setupContextMenus();

// 2. Lifecycle: onInstalled
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Remy SW] Installed reason:', details.reason);

  // Set side panel behavior: open side panel on action icon click
  if (chrome.sidePanel && 'setPanelBehavior' in chrome.sidePanel) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('[Remy SW] Could not set panel behavior:', err);
    }
  }

  await updateOverdueBadge();
});

// 3. Lifecycle: onStartup (Startup Overdue Gate)
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Remy SW] Browser startup event triggered');
  try {
    await handleStartupGate(async (reminder) => {
      await showNotification(reminder);
    });
  } catch (err) {
    console.warn('[Remy SW] Startup gate error:', err);
  }
});

// 4. Background Alarm Event Dispatcher
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[Remy SW] Alarm triggered:', alarm.name);
  try {
    await handleAlarmEvent(alarm.name, async (reminder) => {
      await showNotification(reminder);
    });
  } catch (err) {
    console.warn('[Remy SW] Alarm processing error:', err);
  }
});

// 5. Actionable Notification Button & Card Body Handlers
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  console.log('[Remy SW] Notification button clicked:', notificationId, buttonIndex);
  try {
    await handleNotificationButtonClick(notificationId, buttonIndex);
  } catch (err) {
    console.warn('[Remy SW] Notification button error:', err);
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log('[Remy SW] Notification body clicked:', notificationId);
  try {
    await handleNotificationClick(notificationId);
  } catch (err) {
    console.warn('[Remy SW] Notification click error:', err);
  }
});

// 6. Global Shortcut Command Handler (Ctrl+Shift+K / Cmd+Shift+K)
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[Remy SW] Command received:', command);
  if (command === 'toggle-hud') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_HUD' });
      } catch {
        // Fallback for restricted pages (chrome://, WebStore): Open side panel
        if (chrome.sidePanel && 'open' in chrome.sidePanel) {
          try {
            await (chrome.sidePanel as any).open({ tabId: activeTab.id });
          } catch {
            // Ignore
          }
        }
      }
    }
  }
});

// 7. Runtime Message Dispatcher
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CAPTURE_REMINDER' && message.reminder) {
    const reminder = message.reminder as Reminder;
    (async () => {
      await storageService.saveReminder(reminder);
      if (reminder.armed) {
        await scheduleAlarm(reminder);
      }
      await updateOverdueBadge();
      syncService.triggerDebouncedSync(300).catch(() => {});
      sendResponse({ success: true, id: reminder.id });
    })();
    return true; // Keep channel open for async response
  }

  if (message?.type === 'TRIGGER_SYNC') {
    (async () => {
      const res = await syncService.sync();
      sendResponse(res);
    })();
    return true;
  }

  if (message?.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return false;
  }

  return false;
});
