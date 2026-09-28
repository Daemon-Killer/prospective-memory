import { BrowserWindow } from 'electron';
import path from 'path';

export class AgendaWindow {
  private window: BrowserWindow | null = null;

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
      this.window.show();
      this.window.focus();
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

  public prepareToQuit(): void {
    if (this.window) {
      (this.window as any).__isQuitting = true;
    }
  }
}
