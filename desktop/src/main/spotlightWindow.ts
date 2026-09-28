import { BrowserWindow, screen } from 'electron';
import path from 'path';

export class SpotlightWindow {
  private window: BrowserWindow | null = null;
  private isVisible: boolean = false;

  constructor() {
    this.createWindow();
  }

  private createWindow(): void {
    const winWidth = 660;
    const winHeight = 160;

    let posX = 0;
    let posY = 0;
    try {
      const cursor = screen.getCursorScreenPoint();
      const currentDisplay = screen.getDisplayNearestPoint(cursor);
      const { x, y, width, height } = currentDisplay.workArea;
      posX = Math.round(x + (width - winWidth) / 2);
      posY = Math.round(y + height * 0.2);
    } catch {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      posX = Math.round((width - winWidth) / 2);
      posY = Math.round(height * 0.2);
    }

    this.window = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: posX,
      y: posY,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window.loadFile(path.join(__dirname, '../renderer/spotlight/index.html'));

    this.window.on('blur', () => {
      this.hide();
    });

    this.window.on('closed', () => {
      this.window = null;
      this.isVisible = false;
    });
  }

  public show(): void {
    if (!this.window) {
      this.createWindow();
    }
    if (this.window) {
      try {
        const cursor = screen.getCursorScreenPoint();
        const currentDisplay = screen.getDisplayNearestPoint(cursor);
        const { x, y, width, height } = currentDisplay.workArea;
        const winWidth = 660;
        const posX = Math.round(x + (width - winWidth) / 2);
        const posY = Math.round(y + height * 0.2);
        this.window.setPosition(posX, posY);
      } catch (_) {}

      this.window.show();
      this.window.focus();
      this.window.webContents.send('spotlight:focus');
      this.isVisible = true;
    }
  }

  public hide(): void {
    if (this.window && this.isVisible) {
      this.window.hide();
      this.isVisible = false;
    }
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public getIsOpen(): boolean {
    return this.isVisible;
  }
}
