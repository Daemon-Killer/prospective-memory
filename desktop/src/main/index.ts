import { app, ipcMain, globalShortcut, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { LocalLedger } from './ledger';
import { SyncEngine } from './syncEngine';
import { NotificationService } from './notifications';
import { HotkeyManager } from './hotkeys';
import { SpotlightWindow } from './spotlightWindow';
import { AgendaWindow } from './agendaWindow';
import { AppTray } from './tray';
import { compileToReminder, compileCaptureWithIntent } from './compiler';
import { getRecollectionItems } from './homeRecollection';
import { getCallTarget } from '@core/callTarget';
import { ContextMode } from '../types';
import { createPersonalAssistant } from './personalAssistant';
import {
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
  calculateWeekend,
} from '@core/snoozeCalculator';

// Windows Shell App ID registration for Action Center toasts and grouping
app.setAppUserModelId('com.remy.desktop');

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (agendaWindow) {
      agendaWindow.show();
    }
  });
}

let ledger: LocalLedger;
let syncEngine: SyncEngine;
let notificationService: NotificationService;
let hotkeyManager: HotkeyManager;
let spotlightWindow: SpotlightWindow;
let agendaWindow: AgendaWindow;
let appTray: AppTray;
let currentMode: ContextMode = 'all';

function resolveDbPath(): string {
  if (process.env.PMEM_DB_PATH) {
    return process.env.PMEM_DB_PATH;
  }
  if (process.env.PMEM_DATA_DIR) {
    return path.join(process.env.PMEM_DATA_DIR, 'tasks.db');
  }
  const repoTasksDb = path.resolve(__dirname, '../../../data/tasks.db');
  if (fs.existsSync(repoTasksDb) || !app.isPackaged) {
    return repoTasksDb;
  }
  return path.join(app.getPath('userData'), 'tasks.db');
}

function refreshTray(): void {
  if (!appTray || !ledger) return;

  const allActive = ledger
    .listReminders({ includeDeleted: false })
    .filter((r) => r.status !== 'completed');

  // Filter for active count based on currentMode
  const modeActive = allActive.filter((r) => {
    if (currentMode === 'all') return true;
    if (currentMode === 'work') {
      return r.context === 'work' || r.tags?.some((t) => ['work', 'office', 'job'].includes(t.toLowerCase()));
    }
    if (currentMode === 'home') {
      return r.context !== 'work' && !r.tags?.some((t) => ['work', 'office', 'job'].includes(t.toLowerCase()));
    }
    return true;
  });

  // Upcoming due item
  const sortedUpcoming = [...modeActive]
    .filter((r) => r.armed !== false)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const nextDue = sortedUpcoming[0] || null;

  const syncStatus = syncEngine ? syncEngine.getStatus() : 'idle';
  const syncStatusText =
    syncStatus === 'syncing'
      ? 'Syncing...'
      : syncStatus === 'synced'
      ? 'Sync Now (Synced)'
      : syncStatus === 'error'
      ? 'Sync Now (Error)'
      : 'Sync Now';

  appTray.updateState({
    activeCount: modeActive.length,
    nextDueReminder: nextDue,
    currentMode,
    syncStatusText,
    shortcut: hotkeyManager ? hotkeyManager.getDisplayShortcut() : 'None',
  });
}

function handleSetMode(mode: ContextMode): void {
  currentMode = mode;
  if (ledger) {
    ledger.setSetting('active_mode', mode);
  }
  if (agendaWindow) {
    agendaWindow.notifyModeChanged(mode);
    agendaWindow.notifyDataChanged();
  }
  refreshTray();
}

async function bootstrap() {
  const dbPath = resolveDbPath();
  ledger = new LocalLedger(dbPath);
  await ledger.init();

  currentMode = (ledger.getSetting('active_mode', 'all') as ContextMode) || 'all';

  syncEngine = new SyncEngine(ledger);
  syncEngine.startAutoSync(30000);

  spotlightWindow = new SpotlightWindow();
  agendaWindow = new AgendaWindow();

  ledger.onChange(() => {
    agendaWindow.notifyDataChanged();
    refreshTray();
  });

  agendaWindow.onFocus(() => {
    syncEngine.setActive(true);
    syncEngine.syncNow().catch(() => {});
  });

  agendaWindow.onBlur(() => {
    syncEngine.setActive(false);
  });

  notificationService = new NotificationService(ledger, syncEngine, () => {
    agendaWindow.show();
  });
  notificationService.start(10000);

  hotkeyManager = new HotkeyManager(() => {
    spotlightWindow.toggle();
  });
  const registered = hotkeyManager.register();
  console.log(`Global hotkey registered: ${registered || 'none'}`);

  // Register global hotkey for Agenda as well (Alt+Shift+A / Win+Shift+A / Ctrl+Shift+A)
  try {
    const agendaCandidates = ['Alt+Shift+A', 'CommandOrControl+Shift+A', 'Super+Shift+A'];
    for (const hk of agendaCandidates) {
      try {
        globalShortcut.register(hk, () => {
          agendaWindow.toggle();
        });
      } catch (_) {}
    }
  } catch (_) {}

  appTray = new AppTray({
    onOpenAgenda: () => agendaWindow.show(),
    onQuickCapture: () => spotlightWindow.show(),
    onSyncNow: async () => {
      appTray.updateContextMenu('Syncing...');
      const res = await syncEngine.syncNow();
      appTray.updateContextMenu(res.success ? 'Sync Now (Synced)' : 'Sync Now (Error)');
      agendaWindow.notifyDataChanged();
      refreshTray();
    },
    onSetMode: (mode) => handleSetMode(mode),
    onQuit: () => {
      agendaWindow.prepareToQuit();
      app.quit();
    },
  });

  syncEngine.onStatusChange((status, lastSync) => {
    agendaWindow.notifySyncStatus(status, lastSync);
    refreshTray();
  });

  setupIpc();
  refreshTray();

  // Show Agenda window on launch so user gets immediate visual UI
  agendaWindow.show();

  // Initial sync in background
  setTimeout(() => {
    syncEngine
      .syncNow()
      .then(() => {
        agendaWindow.notifyDataChanged();
        refreshTray();
      })
      .catch(() => {});
  }, 1000);
}

function setupIpc() {
  let assistant: ReturnType<typeof createPersonalAssistant> | undefined;
  const getAssistant = (event: Electron.IpcMainInvokeEvent) => {
    if (event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith('file:') || !event.senderFrame.url.endsWith('/renderer/agenda/index.html')) throw new Error('Assistant access is limited to the Remy agenda.');
    return assistant ??= createPersonalAssistant(app.getPath('userData'));
  };
  ipcMain.handle('assistant:config', event => getAssistant(event).config());
  ipcMain.handle('assistant:connect', (event, link: string) => getAssistant(event).connect(link));
  ipcMain.handle('assistant:forget', event => getAssistant(event).forget());
  ipcMain.handle('assistant:request', (event, method: string, route: string, body?: string) => getAssistant(event).request(method, route, body));

  ipcMain.handle('spotlight:getShortcut', () => hotkeyManager.getDisplayShortcut());

  ipcMain.handle('spotlight:compile', (_event, text: string) => {
    if (!text || !text.trim()) return null;
    const draft = compileCaptureWithIntent(text, 'inbox', new Date(), undefined, currentMode);
    return {
      raw: draft.raw,
      title: draft.title,
      lingoKey: draft.lingoKey,
      preset: draft.preset,
      dueDate: draft.dueDate.toISOString(),
      armed: draft.armed,
      context: draft.context,
      tags: draft.tags,
      musicDraft: draft.musicDraft,
    };
  });

  ipcMain.handle('spotlight:submit', async (_event, text: string) => {
    if (!text || !text.trim()) return null;
    const { reminder, draft } = compileToReminder(text, currentMode);
    const saved = ledger.upsertReminder(reminder);
    spotlightWindow.hide();
    agendaWindow.notifyDataChanged();
    refreshTray();
    syncEngine.triggerBurstSync();
    return { reminder: saved, draft };
  });

  ipcMain.handle('spotlight:hide', () => {
    spotlightWindow.hide();
  });

  ipcMain.handle('spotlight:show', () => {
    spotlightWindow.show();
  });

  ipcMain.handle('agenda:list', (_event, status?: string, context?: string) => {
    const filterContext = context || (currentMode !== 'all' ? currentMode : undefined);
    return ledger.listReminders({ status: status || undefined, context: filterContext, includeDeleted: false });
  });

  ipcMain.handle('mode:get', () => {
    return currentMode;
  });

  ipcMain.handle('mode:set', (_event, mode: ContextMode) => {
    handleSetMode(mode);
    return currentMode;
  });

  ipcMain.handle('recollection:list', () => {
    const active = ledger.listReminders({ includeDeleted: false });
    return getRecollectionItems(active);
  });

  ipcMain.handle('agenda:call', async (_event, id: string) => {
    const reminder = ledger.getReminder(id);
    const target = reminder && !reminder.isDeleted ? getCallTarget(reminder) : null;
    if (!target) throw new Error('This reminder has no call action');
    await shell.openExternal('tel:' + (target.phone || ''));
    return true;
  });

  ipcMain.handle('agenda:snooze', (_event, id: string, preset: string) => {
    const existing = ledger.getReminder(id);
    if (!existing) return null;

    const baseDate = new Date(existing.dueDate);
    const now = new Date();
    let target: Date;

    switch (preset) {
      case '15m':
        target = calculate15Minutes(now, baseDate);
        break;
      case '1h':
        target = calculate1Hour(now, baseDate);
        break;
      case 'evening':
        target = calculateThisEvening(now);
        break;
      case 'tomorrow_morning':
        target = calculateTomorrowMorning(now);
        break;
      case 'weekend':
        target = calculateWeekend(now);
        break;
      default:
        target = calculate15Minutes(now, baseDate);
    }

    const updated = ledger.snoozeReminder(id, target.toISOString());
    notificationService.clearNotified(id);
    agendaWindow.notifyDataChanged();
    refreshTray();
    syncEngine.triggerBurstSync();
    return updated;
  });

  ipcMain.handle('agenda:complete', (_event, id: string) => {
    const updated = ledger.completeReminder(id);
    notificationService.clearNotified(id);
    agendaWindow.notifyDataChanged();
    refreshTray();
    syncEngine.triggerBurstSync();
    return updated;
  });

  ipcMain.handle('agenda:delete', (_event, id: string) => {
    const res = ledger.deleteReminder(id);
    notificationService.clearNotified(id);
    agendaWindow.notifyDataChanged();
    refreshTray();
    syncEngine.triggerBurstSync();
    return res;
  });

  ipcMain.handle('agenda:sync', async () => {
    const res = await syncEngine.syncNow();
    agendaWindow.notifyDataChanged();
    refreshTray();
    return res;
  });

  ipcMain.handle('agenda:getSyncStatus', () => {
    return {
      status: syncEngine.getStatus(),
      lastSync: syncEngine.getLastSyncTime(),
    };
  });
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // Do not quit when windows are closed, stay resident in tray!
});

app.on('will-quit', () => {
  if (hotkeyManager) hotkeyManager.unregisterAll();
  if (notificationService) notificationService.stop();
  if (syncEngine) syncEngine.stopAutoSync();
  if (ledger) ledger.close();
  if (appTray) appTray.destroy();
});
