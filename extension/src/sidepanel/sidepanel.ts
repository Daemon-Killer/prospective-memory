/**
 * Remy Web Browser Extension - Side Panel Agenda
 * Swiss Void agenda column displaying Overdue, Today, Upcoming, Inbox, and Completed.
 * Reacts in real-time to chrome.storage.onChanged.
 */

import '../theme/swissVoid.css';
import { Reminder, isReminderArmed } from '../types/reminder';
import { storageService } from '../services/storageService';
import { scheduleAlarm, clearAlarm, updateOverdueBadge } from '../services/alarmService';
import { syncService } from '../services/syncService';
import { compileCapture, CaptureChip } from '@core/captureCompilerCore';

let activeChip: CaptureChip = 'inbox';

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return isoStr;
  }
}

export function categorizeReminders(reminders: Reminder[], now: Date = new Date()) {
  const overdue: Reminder[] = [];
  const today: Reminder[] = [];
  const upcoming: Reminder[] = [];
  const inbox: Reminder[] = [];
  const completed: Reminder[] = [];

  const nowMs = now.getTime();

  for (const r of reminders) {
    if (r.isDeleted) continue;

    if (r.status === 'completed') {
      completed.push(r);
      continue;
    }

    if (!isReminderArmed(r)) {
      inbox.push(r);
      continue;
    }

    const due = new Date(r.dueDate);
    const dueMs = due.getTime();

    if (dueMs < nowMs) {
      overdue.push(r);
    } else if (isSameDay(due, now)) {
      today.push(r);
    } else {
      upcoming.push(r);
    }
  }

  // Sort sections
  overdue.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  today.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  upcoming.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  inbox.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  completed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return { overdue, today, upcoming, inbox, completed };
}

function renderSection(
  title: string,
  items: Reminder[],
  isOverdue = false,
  isCompleted = false
): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'agenda-section';

  const header = document.createElement('div');
  header.className = `section-header ${isOverdue ? 'overdue' : ''}`;
  header.innerHTML = `<span>${title}</span><span>${items.length}</span>`;
  sec.appendChild(header);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'None';
    sec.appendChild(empty);
    return sec;
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = `reminder-card ${isOverdue ? 'overdue' : ''}`;

    const info = document.createElement('div');
    info.className = 'card-info';

    const titleEl = document.createElement('div');
    titleEl.className = `card-title ${isCompleted ? 'completed' : ''}`;
    titleEl.textContent = item.title;
    info.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = `card-meta ${isOverdue ? 'overdue' : ''}`;

    if (isReminderArmed(item)) {
      const timeStr = formatTime(item.dueDate);
      const dateStr = formatDate(item.dueDate);
      meta.textContent = `${dateStr} ${timeStr}`;
    } else {
      meta.textContent = '📥 Inbox';
    }
    info.appendChild(meta);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (!isCompleted) {
      // +15m Snooze
      const snoozeBtn = document.createElement('button');
      snoozeBtn.className = 'action-btn snooze';
      snoozeBtn.textContent = '+15m';
      snoozeBtn.title = 'Snooze 15 minutes';
      snoozeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const updated: Reminder = {
          ...item,
          dueDate: newDate,
          status: 'snoozed',
          snoozeCount: (item.snoozeCount || 0) + 1,
          lastSnoozedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storageService.saveReminder(updated);
        await scheduleAlarm(updated);
        await updateOverdueBadge();
        syncService.triggerDebouncedSync(300).catch(() => {});
        renderAgenda();
      });
      actions.appendChild(snoozeBtn);

      // Complete button
      const completeBtn = document.createElement('button');
      completeBtn.className = 'action-btn complete';
      completeBtn.textContent = '✓';
      completeBtn.title = 'Mark complete';
      completeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const updated: Reminder = {
          ...item,
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storageService.saveReminder(updated);
        await clearAlarm(item.id);
        await updateOverdueBadge();
        syncService.triggerDebouncedSync(300).catch(() => {});
        renderAgenda();
      });
      actions.appendChild(completeBtn);
    }

    card.appendChild(actions);
    sec.appendChild(card);
  }

  return sec;
}

export function renderAgenda() {
  const container = document.getElementById('agenda-scroll');
  if (!container) return;
  container.innerHTML = '';

  const all = storageService.getAll();
  const { overdue, today, upcoming, inbox, completed } = categorizeReminders(all);

  if (overdue.length > 0) {
    container.appendChild(renderSection('Overdue', overdue, true));
  }
  container.appendChild(renderSection('Today', today));
  container.appendChild(renderSection('Upcoming', upcoming));
  container.appendChild(renderSection('Inbox', inbox));
  if (completed.length > 0) {
    container.appendChild(renderSection('Completed', completed, false, true));
  }
}

async function handleCapture() {
  const input = document.getElementById('capture-input') as HTMLInputElement | null;
  if (!input) return;

  const raw = input.value.trim();
  if (!raw) return;

  const config = storageService.getConfig();
  const draft = compileCapture(raw, activeChip, new Date(), config.customLingo || undefined);

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `remy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const reminder: Reminder = {
    id,
    title: draft.title || raw,
    dueDate: draft.dueDate.toISOString(),
    status: 'pending',
    snoozeCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    armed: draft.armed,
  };

  await storageService.saveReminder(reminder);
  if (reminder.armed) {
    await scheduleAlarm(reminder);
  }
  await updateOverdueBadge();
  syncService.triggerDebouncedSync(300).catch(() => {});

  input.value = '';
  renderAgenda();
}

document.addEventListener('DOMContentLoaded', async () => {
  await storageService.init();
  renderAgenda();

  // Quick Capture Input Enter & Button
  const input = document.getElementById('capture-input') as HTMLInputElement | null;
  const addBtn = document.getElementById('capture-btn');

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCapture();
      }
    });
  }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      handleCapture();
    });
  }

  // Quick Capture Chip selectors
  const chips = document.querySelectorAll('.capture-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.setAttribute('data-active', 'false'));
      chip.setAttribute('data-active', 'true');
      activeChip = (chip.getAttribute('data-chip') as CaptureChip) || 'inbox';
    });
  });

  // Sync status click triggers sync
  const syncEl = document.getElementById('sync-status');
  if (syncEl) {
    syncEl.addEventListener('click', async () => {
      syncEl.textContent = 'Syncing...';
      const res = await syncService.sync();
      syncEl.textContent = res.success ? 'Synced' : 'Sync Error';
      renderAgenda();
    });
  }

  // React in real-time to storage changes from other contexts
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.reminders) {
        renderAgenda();
      }
    });
  }
});
