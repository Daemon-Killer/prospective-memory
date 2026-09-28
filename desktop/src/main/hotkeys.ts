import { globalShortcut } from 'electron';

export class HotkeyManager {
  private registeredShortcut: string | null = null;
  private onTrigger: () => void;

  constructor(onTrigger: () => void) {
    this.onTrigger = onTrigger;
  }

  public register(preferred: string = 'Alt+Shift+Space'): string | null {
    this.unregister();

    const candidates = [
      preferred,
      'CommandOrControl+Shift+Space',
      'Alt+Space',
      'Control+Alt+R',
    ];

    for (const shortcut of candidates) {
      try {
        const success = globalShortcut.register(shortcut, () => {
          this.onTrigger();
        });
        if (success) {
          this.registeredShortcut = shortcut;
          return shortcut;
        }
      } catch (e) {
        // Try next fallback
      }
    }

    return null;
  }

  public getRegistered(): string | null {
    return this.registeredShortcut;
  }

  public unregister(): void {
    if (this.registeredShortcut) {
      try {
        globalShortcut.unregister(this.registeredShortcut);
      } catch (e) {
        // Ignore
      }
      this.registeredShortcut = null;
    }
  }

  public unregisterAll(): void {
    try {
      globalShortcut.unregisterAll();
    } catch (e) {
      // Ignore
    }
    this.registeredShortcut = null;
  }
}
