import { getCallTarget } from '@core/callTarget';
import { initPersonalAssistant } from './assistant';
declare const remyAPI: any;
initPersonalAssistant(remyAPI);

interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  dueDate: string;
  status: 'pending' | 'snoozed' | 'completed';
  snoozeCount: number;
  lastSnoozedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  armed?: boolean;
  context?: 'work' | 'home' | 'all';
  tags?: string[] | null;
}

interface RecollectionItem {
  id: string;
  title: string;
  category: 'call' | 'grocery' | 'chore' | 'general';
  dueDate: string;
  notes?: string | null;
  tags?: string[] | null;
  reminder: Reminder;
}

let allReminders: Reminder[] = [];
let currentTab: 'pending' | 'snoozed' | 'completed' | 'all' = 'pending';
let currentMode: 'all' | 'work' | 'home' = 'all';
let searchQuery: string = '';

const listContainer = document.getElementById('reminders-list') as HTMLElement;
const emptyState = document.getElementById('empty-state') as HTMLElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const btnSync = document.getElementById('btn-sync') as HTMLButtonElement;
const syncBadge = document.getElementById('sync-badge') as HTMLElement;
const syncText = document.getElementById('sync-text') as HTMLElement;

const countPending = document.getElementById('count-pending') as HTMLElement;
const countSnoozed = document.getElementById('count-snoozed') as HTMLElement;
const countCompleted = document.getElementById('count-completed') as HTMLElement;
const countAll = document.getElementById('count-all') as HTMLElement;

const recollectionHub = document.getElementById('recollection-hub') as HTMLElement;
const itemsCalls = document.getElementById('items-calls') as HTMLElement;
const itemsGroceries = document.getElementById('items-groceries') as HTMLElement;
const itemsChores = document.getElementById('items-chores') as HTMLElement;
const countCalls = document.getElementById('count-calls') as HTMLElement;
const countGroceries = document.getElementById('count-groceries') as HTMLElement;
const countChores = document.getElementById('count-chores') as HTMLElement;

const tabButtons = document.querySelectorAll('.tab-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const shortcutKbd = document.getElementById('shortcut-kbd');

// Show the shortcut actually registered, including any collision fallback.
if (shortcutKbd) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
  shortcutKbd.textContent = isMac ? 'Cmd+Shift+R' : 'Ctrl+Alt+R';
  if (typeof remyAPI !== 'undefined' && remyAPI.getCaptureShortcut) {
    remyAPI.getCaptureShortcut().then((shortcut: string) => {
      shortcutKbd.textContent = shortcut === 'None' ? 'Quick Capture in the tray menu' : shortcut;
    }).catch(() => {});
  }
}

function formatRelativeTime(dateString: string): { text: string; className: string } {
  const target = new Date(dateString).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const isPast = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const mins = Math.round(absDiff / (60 * 1000));
  const hours = Math.round(absDiff / (60 * 60 * 1000));
  const days = Math.round(absDiff / (24 * 60 * 60 * 1000));

  let text = '';
  if (mins < 1) {
    text = isPast ? 'Just now' : 'Right now';
  } else if (mins < 60) {
    text = isPast ? `${mins}m ago` : `in ${mins}m`;
  } else if (hours < 24) {
    text = isPast ? `${hours}h ago` : `in ${hours}h`;
  } else {
    text = isPast ? `${days}d ago` : `in ${days}d`;
  }

  let className = 'meta-due';
  if (isPast) {
    className += ' overdue';
  } else if (diffMs < 30 * 60 * 1000) {
    className += ' due-soon';
  }

  return { text, className };
}

function updateCounts() {
  const pendingCount = allReminders.filter((r) => r.status === 'pending').length;
  const snoozedCount = allReminders.filter((r) => r.status === 'snoozed').length;
  const completedCount = allReminders.filter((r) => r.status === 'completed').length;

  countPending.textContent = String(pendingCount);
  countSnoozed.textContent = String(snoozedCount);
  countCompleted.textContent = String(completedCount);
  countAll.textContent = String(allReminders.length);
}

async function renderRecollectionHub() {
  if (currentMode !== 'home') {
    recollectionHub.classList.add('hidden');
    return;
  }

  try {
    const items: RecollectionItem[] = await remyAPI.getRecollectionItems();
    recollectionHub.classList.remove('hidden');

    const calls = items.filter((i) => i.category === 'call');
    const groceries = items.filter((i) => i.category === 'grocery');
    const chores = items.filter((i) => i.category === 'chore' || i.category === 'general');

    countCalls.textContent = String(calls.length);
    countGroceries.textContent = String(groceries.length);
    countChores.textContent = String(chores.length);

    renderColItems(itemsCalls, calls);
    renderColItems(itemsGroceries, groceries);
    renderColItems(itemsChores, chores);
  } catch (e) {
    console.error('Failed to load recollection items', e);
  }
}

function renderColItems(container: HTMLElement, items: RecollectionItem[]) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = '<div style="color: #52525b; font-size: 11px; padding: 4px 0;">None pending</div>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'recollection-card';
    card.innerHTML = `
      <div class="recollection-card-title">${escapeHtml(item.title)}</div>
      ${item.notes ? `<div class="recollection-card-notes">${escapeHtml(item.notes)}</div>` : ''}
      <div class="recollection-card-actions">
        ${callButton(item.reminder)}
        <button class="action-btn snooze-btn" data-id="${item.id}" data-preset="15m" style="padding: 2px 6px; font-size: 10px;">+15m</button>
        <button class="action-btn complete" data-id="${item.id}" style="padding: 2px 6px; font-size: 10px;">✓ Done</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function callButton(reminder: Reminder): string {
  const target = getCallTarget(reminder);
  if (!target || reminder.status === "completed") return "";
  return '<button class="action-btn call-btn" data-id="' + escapeHtml(reminder.id) + '" title="Open your calling app">' + escapeHtml(target.phone ? "Call " + target.name : "Open dialer") + '</button>';
}

function renderReminders() {
  updateCounts();

  let filtered = allReminders;
  if (currentTab !== 'all') {
    filtered = filtered.filter((r) => r.status === currentTab);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.notes && r.notes.toLowerCase().includes(q))
    );
  }

  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  filtered.forEach((reminder) => {
    const card = document.createElement('div');
    card.className = `reminder-card ${reminder.status}`;

    const isUnarmed = reminder.armed === false;
    const { text: relTime, className: relClass } = formatRelativeTime(reminder.dueDate);
    const displayTime = isUnarmed ? 'Inbox' : relTime;
    const displayClass = isUnarmed ? 'meta-due' : relClass;

    const contextTag = reminder.context && reminder.context !== 'all'
      ? `<span class="meta-badge" style="text-transform: uppercase;">${escapeHtml(reminder.context)}</span>`
      : '';

    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${escapeHtml(reminder.title)}</div>
        ${reminder.notes ? `<div class="card-notes">${escapeHtml(reminder.notes)}</div>` : ''}
        <div class="card-meta">
          <span class="${displayClass}">${displayTime}</span>
          ${reminder.snoozeCount > 0 ? `<span class="meta-badge">Snoozed ${reminder.snoozeCount}x</span>` : ''}
          ${contextTag}
        </div>
      </div>
      <div class="card-actions">
        ${callButton(reminder)}
        ${
          reminder.status !== 'completed'
            ? `
          <button class="action-btn snooze-btn" data-id="${reminder.id}" data-preset="15m">+15m</button>
          <button class="action-btn snooze-btn" data-id="${reminder.id}" data-preset="1h">+1h</button>
          <button class="action-btn snooze-btn" data-id="${reminder.id}" data-preset="tomorrow_morning">Tomorrow</button>
          <button class="action-btn complete" data-id="${reminder.id}">✓ Complete</button>
        `
            : `
          <button class="action-btn complete" data-id="${reminder.id}">Completed</button>
        `
        }
        <button class="action-btn delete" data-id="${reminder.id}" title="Delete">✕</button>
      </div>
    `;

    listContainer.appendChild(card);
  });

}

// Delegate once so refreshed agenda and recollection cards share the same actions.
document.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".action-btn");
  if (!button || button.disabled || !button.dataset.id) return;
  const id = button.dataset.id;
  const status = document.getElementById("action-status");
  button.disabled = true;
  try {
    if (button.classList.contains("call-btn")) await remyAPI.callReminder(id);
    else if (button.classList.contains("snooze-btn")) await remyAPI.snoozeReminder(id, button.dataset.preset);
    else if (button.classList.contains("complete")) await remyAPI.completeReminder(id);
    else if (button.classList.contains("delete")) await remyAPI.deleteReminder(id);
    if (status) status.textContent = "";
    if (!button.classList.contains("call-btn")) await loadReminders();
  } catch {
    if (status) status.textContent = button.classList.contains("call-btn") ? "Could not open a calling app. Check your default phone app." : "Could not save this change. Please try again.";
  } finally { button.disabled = false; }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadReminders() {
  try {
    allReminders = await remyAPI.listReminders(undefined, currentMode !== 'all' ? currentMode : undefined);
    renderReminders();
    await renderRecollectionHub();
  } catch (e) {
    console.error('Failed to load reminders', e);
  }
}

function updateModeButtons() {
  modeButtons.forEach((btn) => {
    const mode = (btn as HTMLElement).dataset.mode;
    if (mode === currentMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Mode button click listeners
modeButtons.forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    const target = e.currentTarget as HTMLElement;
    const mode = target.dataset.mode as any;
    currentMode = mode;
    updateModeButtons();
    if (typeof remyAPI !== 'undefined' && remyAPI.setMode) {
      await remyAPI.setMode(mode);
    }
    await loadReminders();
  });
});

// Tab click listeners
tabButtons.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    const target = e.currentTarget as HTMLElement;
    target.classList.add('active');
    currentTab = target.dataset.tab as any;
    renderReminders();
  });
});

// Search input
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderReminders();
});

// Quick Capture button
const btnQuickCapture = document.getElementById('btn-quick-capture') as HTMLButtonElement | null;
if (btnQuickCapture) {
  btnQuickCapture.addEventListener('click', async () => {
    if (typeof remyAPI !== 'undefined' && remyAPI.openSpotlight) {
      await remyAPI.openSpotlight();
    }
  });
}

// Sync Now button
btnSync.addEventListener('click', async () => {
  btnSync.disabled = true;
  btnSync.textContent = '↻ Syncing...';
  syncBadge.className = 'sync-badge syncing';
  syncText.textContent = 'Syncing...';

  try {
    await remyAPI.syncNow();
    await loadReminders();
  } catch (e) {
    console.error('Sync failed', e);
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = '↻ Sync';
  }
});

// IPC event subscriptions
if (typeof remyAPI !== 'undefined') {
  remyAPI.onAgendaRefresh(() => {
    loadReminders();
  });

  if (remyAPI.onModeChange) {
    remyAPI.onModeChange((mode: any) => {
      currentMode = mode;
      updateModeButtons();
      loadReminders();
    });
  }

  remyAPI.onSyncStatusChange((data: { status: string; lastSync: string | null }) => {
    syncBadge.className = `sync-badge ${data.status}`;
    if (data.status === 'synced') {
      syncText.textContent = 'Synced';
    } else if (data.status === 'syncing') {
      syncText.textContent = 'Syncing...';
    } else if (data.status === 'error') {
      syncText.textContent = 'Sync Error';
    } else {
      syncText.textContent = 'Idle';
    }
  });

  // Initial mode check
  if (remyAPI.getMode) {
    remyAPI.getMode().then((mode: any) => {
      if (mode) {
        currentMode = mode;
        updateModeButtons();
      }
      loadReminders();
    });
  } else {
    loadReminders();
  }

  // Initial sync status check
  remyAPI.getSyncStatus().then((data: any) => {
    if (data) {
      syncBadge.className = `sync-badge ${data.status}`;
      syncText.textContent = data.status === 'synced' ? 'Synced' : data.status;
    }
  });
} else {
  loadReminders();
}
