declare const remyAPI: any;

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
}

let allReminders: Reminder[] = [];
let currentTab: 'pending' | 'snoozed' | 'completed' | 'all' = 'pending';
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

const tabButtons = document.querySelectorAll('.tab-btn');

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

    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${escapeHtml(reminder.title)}</div>
        ${reminder.notes ? `<div class="card-notes">${escapeHtml(reminder.notes)}</div>` : ''}
        <div class="card-meta">
          <span class="${displayClass}">${displayTime}</span>
          ${reminder.snoozeCount > 0 ? `<span class="meta-badge">Snoozed ${reminder.snoozeCount}x</span>` : ''}
        </div>
      </div>
      <div class="card-actions">
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

  // Attach event listeners
  document.querySelectorAll('.snooze-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      const preset = (e.currentTarget as HTMLElement).dataset.preset!;
      await remyAPI.snoozeReminder(id, preset);
      await loadReminders();
    });
  });

  document.querySelectorAll('.action-btn.complete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      await remyAPI.completeReminder(id);
      await loadReminders();
    });
  });

  document.querySelectorAll('.action-btn.delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      await remyAPI.deleteReminder(id);
      await loadReminders();
    });
  });
}

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
    allReminders = await remyAPI.listReminders();
    renderReminders();
  } catch (e) {
    console.error('Failed to load reminders', e);
  }
}

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

  // Initial status check
  remyAPI.getSyncStatus().then((data: any) => {
    if (data) {
      syncBadge.className = `sync-badge ${data.status}`;
      syncText.textContent = data.status === 'synced' ? 'Synced' : data.status;
    }
  });
}

// Initial load
loadReminders();
