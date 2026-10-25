import { BrowserWindow } from 'electron';
import path from 'path';

export class AgendaWindow {
  private window: BrowserWindow | null = null;
  private focusListeners: Set<() => void> = new Set();
  private blurListeners: Set<() => void> = new Set();

  constructor() {
    this.createWindow();
  }

  private createWindow(): void {
    this.window = new BrowserWindow({
      width: 880,
      height: 640,
      minWidth: 640,
      minHeight: 480,
      backgroundColor: '#000000',
      title: 'Remy Reminders',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadFile(path.join(__dirname, '../renderer/agenda/index.html'));

    this.window.on('focus', () => {
      this.focusListeners.forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
    });

    this.window.on('blur', () => {
      this.blurListeners.forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
    });

    // Prevent quit on close, hide to tray instead
    this.window.on('close', (event) => {
      if (!(this.window as any)?.__isQuitting) {
        event.preventDefault();
        this.window?.hide();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  public show(): void {
    if (!this.window) {
      this.createWindow();
    }
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.show();
      this.window.focus();
      this.window.moveTop();
    }
  }

  public hide(): void {
    if (this.window && this.window.isVisible()) {
      this.window.hide();
    }
  }

  public toggle(): void {
    if (this.window && this.window.isVisible()) {
      this.window.hide();
    } else {
      this.show();
    }
  }

  public notifyDataChanged(): void {
    if (this.window && this.window.webContents) {
      this.window.webContents.send('agenda:refresh');
    }
  }

  public notifySyncStatus(status: string, lastSync: string | null): void {
    if (this.window && this.window.webContents) {
      this.window.webContents.send('agenda:syncStatus', { status, lastSync });
    }
  }

  public notifyModeChanged(mode: string): void {
    if (this.window && this.window.webContents) {
      this.window.webContents.send('agenda:modeChanged', mode);
    }
  }

  public onFocus(fn: () => void): () => void {
    this.focusListeners.add(fn);
    return () => this.focusListeners.delete(fn);
  }

  public onBlur(fn: () => void): () => void {
    this.blurListeners.add(fn);
    return () => this.blurListeners.delete(fn);
  }

  public prepareToQuit(): void {
    if (this.window) {
      (this.window as any).__isQuitting = true;
    }
  }
}
