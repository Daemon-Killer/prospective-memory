/**
 * Context Menus Ingress
 * Supports right-click capture for text selections, pages, and links.
 * Applies sanitizeTrackers to URLs before saving.
 */

import { sanitizeTrackers } from '../utils/urlSanitizer';
import { Reminder } from '../types/reminder';
import { storageService } from '../services/storageService';
import { scheduleAlarm } from '../services/alarmService';
import { syncService } from '../services/syncService';

export const CONTEXT_MENU_IDS = {
  SELECTION: 'remy-capture-selection',
  LINK: 'remy-capture-link',
  PAGE: 'remy-capture-page',
};

export function setupContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.SELECTION,
        title: 'Capture "%s" in Remy',
        contexts: ['selection'],
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.LINK,
        title: 'Capture link in Remy',
        contexts: ['link'],
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.PAGE,
        title: 'Capture current page in Remy',
        contexts: ['page'],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const now = new Date();
    let title = '';
    let notes = '';

    if (info.menuItemId === CONTEXT_MENU_IDS.SELECTION && info.selectionText) {
      title = info.selectionText.trim();
      if (tab?.url) {
        notes = `From: ${sanitizeTrackers(tab.url)}`;
      }
    } else if (info.menuItemId === CONTEXT_MENU_IDS.LINK && info.linkUrl) {
      const cleanUrl = sanitizeTrackers(info.linkUrl);
      title = `Review link: ${cleanUrl}`;
      notes = cleanUrl;
    } else if (info.menuItemId === CONTEXT_MENU_IDS.PAGE) {
      const pageUrl = tab?.url || info.pageUrl || '';
      const cleanUrl = sanitizeTrackers(pageUrl);
      const pageTitle = tab?.title ? tab.title.trim() : 'Page';
      title = pageTitle;
      notes = cleanUrl;
    }

    if (!title) return;

    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `remy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const reminder: Reminder = {
      id,
      title,
      notes: notes || null,
      dueDate: now.toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      armed: false, // Default context menu captures to inbox unless parsed
    };

    await storageService.saveReminder(reminder);
    if (reminder.armed) {
      await scheduleAlarm(reminder);
    }
    syncService.triggerDebouncedSync(300).catch((e) => {
      console.warn('[ContextMenu] Sync trigger error:', e);
    });
  });
}
