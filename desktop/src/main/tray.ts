import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'path';

export interface TrayCallbacks {
  onOpenAgenda: () => void;
  onQuickCapture: () => void;
  onSyncNow: () => void;
  onQuit: () => void;
}

export class AppTray {
  private tray: Tray | null = null;
  private callbacks: TrayCallbacks;

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
    this.init();
  }

  private init(): void {
    const iconPath = path.join(__dirname, '../assets/icon-32.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Create a fallback 16x16 icon
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('Remy Reminders - Prospective Memory');

    this.updateContextMenu();

    this.tray.on('click', () => {
      this.callbacks.onOpenAgenda();
    });

    this.tray.on('double-click', () => {
      this.callbacks.onOpenAgenda();
    });
  }

  public updateContextMenu(syncStatusText: string = 'Sync Now'): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Agenda',
        click: () => this.callbacks.onOpenAgenda(),
      },
      {
        label: 'Quick Capture',
        accelerator: 'Alt+Shift+Space',
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
