import { app, Menu, nativeImage, Tray } from 'electron';
import fs from 'fs';
import path from 'path';
import { Reminder, ContextMode } from '../types';

export interface TrayCallbacks {
  onOpenAgenda: () => void;
  onQuickCapture: () => void;
  onSyncNow: () => void;
  onSetMode: (mode: ContextMode) => void;
  onQuit: () => void;
}

export interface TrayState {
  activeCount: number;
  nextDueReminder: Reminder | null;
  currentMode: ContextMode;
  syncStatusText: string;
  shortcut: string;
}

function formatDueTime(isoDate: string): string {
  try {
    const target = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = target - now;
    const isPast = diffMs < 0;
    const absDiff = Math.abs(diffMs);
    const mins = Math.round(absDiff / (60 * 1000));
    const hours = Math.round(absDiff / (60 * 60 * 1000));
    const days = Math.round(absDiff / (24 * 60 * 60 * 1000));

    if (mins < 1) return isPast ? 'Overdue' : 'Due now';
    if (mins < 60) return isPast ? `${mins}m ago` : `in ${mins}m`;
    if (hours < 24) return isPast ? `${hours}h ago` : `in ${hours}h`;
    return isPast ? `${days}d ago` : `in ${days}d`;
  } catch {
    return '';
  }
}

export class AppTray {
  private tray: Tray | null = null;
  private callbacks: TrayCallbacks;
  private state: TrayState = {
    activeCount: 0,
    nextDueReminder: null,
    currentMode: 'all',
    syncStatusText: 'Sync Now',
    shortcut: process.platform === 'darwin' ? 'Cmd+Shift+R' : 'Ctrl+Alt+R',
  };

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
    this.init();
  }

  private init(): void {
    const iconCandidates = [
      path.join(__dirname, '../assets/icon-32.png'),
      path.join(__dirname, '../../assets/icon-32.png'),
    ];
    try {
      if (app && typeof app.getAppPath === 'function') {
        iconCandidates.push(
          path.join(app.getAppPath(), 'dist/assets/icon-32.png'),
          path.join(app.getAppPath(), 'assets/icon-32.png')
        );
      }
    } catch (_) {}
    const iconPath = iconCandidates.find((p) => fs.existsSync(p)) || iconCandidates[0];
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Create a fallback 16x16 icon
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.render();

    this.tray.on('click', () => {
      this.callbacks.onOpenAgenda();
    });

    this.tray.on('double-click', () => {
      this.callbacks.onOpenAgenda();
    });
  }

  public updateState(partial: Partial<TrayState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.render();
  }

  public updateContextMenu(syncStatusText: string = 'Sync Now'): void {
    this.updateState({ syncStatusText });
  }

  private render(): void {
    if (!this.tray) return;

    const { activeCount, nextDueReminder, currentMode, syncStatusText, shortcut } = this.state;
    const modeUpper = currentMode.toUpperCase();

    let upcomingLabel = 'No upcoming items';
    if (nextDueReminder) {
      const relTime = formatDueTime(nextDueReminder.dueDate);
      const titleTrunc = nextDueReminder.title.length > 25
        ? nextDueReminder.title.slice(0, 22) + '...'
        : nextDueReminder.title;
      upcomingLabel = `${titleTrunc} (${relTime})`;
    }

    // Set Tooltip
    const tooltipText = `Remy Reminders [${modeUpper}]\n• Active: ${activeCount}\n• Next: ${upcomingLabel}`;
    this.tray.setToolTip(tooltipText);

    // macOS menu bar title (displays count directly on menu bar)
    if (process.platform === 'darwin') {
      this.tray.setTitle(activeCount > 0 ? ` ${activeCount}` : '');
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Remy Reminders: ${activeCount} active (${modeUpper})`,
        enabled: false,
      },
      {
        label: `⏰ Next: ${upcomingLabel}`,
        click: () => this.callbacks.onOpenAgenda(),
      },
      { type: 'separator' },
      {
        label: 'Context Mode',
        submenu: [
          {
            label: 'All Environments (Global)',
            type: 'radio',
            checked: currentMode === 'all',
            click: () => this.callbacks.onSetMode('all'),
          },
          {
            label: 'Work Workstation',
            type: 'radio',
            checked: currentMode === 'work',
            click: () => this.callbacks.onSetMode('work'),
          },
          {
            label: 'Home Domestic',
            type: 'radio',
            checked: currentMode === 'home',
            click: () => this.callbacks.onSetMode('home'),
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Open Agenda',
        click: () => this.callbacks.onOpenAgenda(),
      },
      {
        label: `Quick Capture (${shortcut})`,
        click: () => this.callbacks.onQuickCapture(),
      },
      {
        label: syncStatusText,
        click: () => this.callbacks.onSyncNow(),
      },
      { type: 'separator' },
      {
        label: 'Quit Remy',
        click: () => this.callbacks.onQuit(),
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
