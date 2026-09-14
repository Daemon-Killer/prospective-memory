/**
 * Omnibox Ingress (r <tab> <thought>)
 * Formats live autocomplete previews with XML escaping and <match>/<dim> tags.
 * Commits to storage ledger (<3ms) and schedules alarms.
 */

import { compileCapture, CaptureDraft } from '@core/captureCompilerCore';
import { Reminder } from '../types/reminder';
import { escapeXml } from '../utils/xmlEscape';
import { storageService } from '../services/storageService';
import { scheduleAlarm } from '../services/alarmService';
import { syncService } from '../services/syncService';

export function formatOmniboxSuggestion(draft: CaptureDraft, rawText: string): { description: string } {
  const safeTitle = escapeXml(draft.title || rawText);
  let safeCue: string;

  if (draft.armed) {
    const timeStr = draft.dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    safeCue = `⏰ Armed (${escapeXml(timeStr)})`;
  } else {
    safeCue = '📥 Unarmed (Inbox)';
  }

  const description = `<match>${safeTitle}</match> <dim> | ${safeCue}</dim>`;
  return { description };
}

export function createOmniboxReminder(
  rawText: string,
  now: Date = new Date(),
  customLingo?: string
): Reminder {
  const draft = compileCapture(rawText, 'inbox', now, customLingo || undefined);
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `remy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    title: draft.title || rawText.trim(),
    dueDate: draft.dueDate.toISOString(),
    status: 'pending',
    snoozeCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    armed: draft.armed,
  };
}

export async function commitOmniboxReminder(
  rawText: string,
  now: Date = new Date(),
  customLingo?: string
): Promise<Reminder> {
  const reminder = createOmniboxReminder(rawText, now, customLingo);
  await storageService.saveReminder(reminder);

  if (reminder.armed) {
    await scheduleAlarm(reminder);
  }

  syncService.triggerDebouncedSync(300).catch((err) => {
    console.warn('[Omnibox] Sync trigger failed:', err);
  });

  return reminder;
}

export function setupOmnibox() {
  if (typeof chrome === 'undefined' || !chrome.omnibox) return;

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const trimmed = text.trim();
    if (!trimmed) {
      chrome.omnibox.setDefaultSuggestion({
        description: '<match>Remy</match> <dim>| Type a reminder thought...</dim>',
      });
      return;
    }

    const config = storageService.getConfig();
    const draft = compileCapture(trimmed, 'inbox', new Date(), config.customLingo || undefined);
    const { description } = formatOmniboxSuggestion(draft, trimmed);

    chrome.omnibox.setDefaultSuggestion({ description });
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const config = storageService.getConfig();
    await commitOmniboxReminder(trimmed, new Date(), config.customLingo);
  });
}
