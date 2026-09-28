import { app, ipcMain } from 'electron';
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

async function bootstrap() {
  const dbPath = resolveDbPath();
  ledger = new LocalLedger(dbPath);
  await ledger.init();

  syncEngine = new SyncEngine(ledger);
  syncEngine.startAutoSync(30000);

  spotlightWindow = new SpotlightWindow();
  agendaWindow = new AgendaWindow();

  ledger.onChange(() => {
    agendaWindow.notifyDataChanged();
  });

  notificationService = new NotificationService(ledger, syncEngine, () => {
    agendaWindow.show();
  });
  notificationService.start(10000);

  hotkeyManager = new HotkeyManager(() => {
    spotlightWindow.toggle();
  });
  const registered = hotkeyManager.register('Alt+Shift+Space');
  console.log(`Global hotkey registered: ${registered || 'none'}`);

  appTray = new AppTray({
    onOpenAgenda: () => agendaWindow.show(),
    onQuickCapture: () => spotlightWindow.show(),
    onSyncNow: async () => {
      appTray.updateContextMenu('Syncing...');
      const res = await syncEngine.syncNow();
      appTray.updateContextMenu(res.success ? 'Sync Now (Synced)' : 'Sync Now (Error)');
      agendaWindow.notifyDataChanged();
    },
    onQuit: () => {
      agendaWindow.prepareToQuit();
      app.quit();
    },
  });

  syncEngine.onStatusChange((status, lastSync) => {
    agendaWindow.notifySyncStatus(status, lastSync);
  });

  setupIpc();

  // Initial sync in background
  setTimeout(() => {
    syncEngine.syncNow().then(() => {
      agendaWindow.notifyDataChanged();
    }).catch(() => {});
  }, 1000);
}

function setupIpc() {
  ipcMain.handle('spotlight:compile', (_event, text: string) => {
    if (!text || !text.trim()) return null;
    const draft = compileCaptureWithIntent(text);
    return {
      raw: draft.raw,
      title: draft.title,
      lingoKey: draft.lingoKey,
      preset: draft.preset,
      dueDate: draft.dueDate.toISOString(),
      armed: draft.armed,
      musicDraft: draft.musicDraft,
    };
  });

  ipcMain.handle('spotlight:submit', async (_event, text: string) => {
    if (!text || !text.trim()) return null;
    const { reminder, draft } = compileToReminder(text);
    const saved = ledger.upsertReminder(reminder);
    spotlightWindow.hide();
    agendaWindow.notifyDataChanged();
    syncEngine.triggerDebounced();
    return { reminder: saved, draft };
  });

  ipcMain.handle('spotlight:hide', () => {
    spotlightWindow.hide();
  });

  ipcMain.handle('agenda:list', (_event, status?: string) => {
    return ledger.listReminders({ status: status || undefined, includeDeleted: false });
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
    syncEngine.triggerDebounced();
    return updated;
  });

  ipcMain.handle('agenda:complete', (_event, id: string) => {
    const updated = ledger.completeReminder(id);
    notificationService.clearNotified(id);
    agendaWindow.notifyDataChanged();
    syncEngine.triggerDebounced();
    return updated;
  });

  ipcMain.handle('agenda:delete', (_event, id: string) => {
    const res = ledger.deleteReminder(id);
    notificationService.clearNotified(id);
    agendaWindow.notifyDataChanged();
    syncEngine.triggerDebounced();
    return res;
  });

  ipcMain.handle('agenda:sync', async () => {
    const res = await syncEngine.syncNow();
    agendaWindow.notifyDataChanged();
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
