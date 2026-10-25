import { globalShortcut } from 'electron';

export function normalizeAccelerator(shortcut: string): string {
  if (!shortcut || typeof shortcut !== 'string') return '';
  return shortcut
    .replace(/\bWin\b/gi, 'Super')
    .replace(/\bCmd\b/gi, 'Command')
    .replace(/\bOption\b/gi, 'Alt');
}

export function formatShortcutForDisplay(shortcut: string): string {
  if (!shortcut || typeof shortcut !== 'string') return '';
  if (process.platform === 'darwin') {
    return shortcut
      .replace(/\bSuper\b/gi, 'Cmd')
      .replace(/\bCommandOrControl\b/gi, 'Cmd')
      .replace(/\bCommand\b/gi, 'Cmd')
      .replace(/\bControl\b/gi, 'Ctrl');
  } else {
    return shortcut
      .replace(/\bSuper\b/gi, 'Win')
      .replace(/\bCommandOrControl\b/gi, 'Ctrl')
      .replace(/\bCommand\b/gi, 'Ctrl')
      .replace(/\bControl\b/gi, 'Ctrl');
  }
}

export class HotkeyManager {
  private registeredShortcuts: string[] = [];
  private registrationAttempted: boolean = false;
  private onTrigger: () => void;

  constructor(onTrigger: () => void) {
    this.onTrigger = onTrigger;
  }

  public static getDefaultShortcut(): string {
    return process.platform === 'darwin' ? 'Command+Shift+R' : 'Control+Alt+R';
  }

  public register(preferred?: string): string | null {
    this.unregister();
    this.registrationAttempted = true;

    const isMac = process.platform === 'darwin';
    const primary = preferred ? normalizeAccelerator(preferred) : HotkeyManager.getDefaultShortcut();

    const candidates = [
      primary,
      'Control+Alt+Space',
      'F9',
      'Shift+F9',
      'Control+Alt+N',
      'Control+Alt+R',
      isMac ? 'Command+Shift+R' : 'Alt+Shift+R',
      isMac ? 'CommandOrControl+Shift+R' : 'Super+Shift+R',
      'Alt+Shift+R',
      'Super+Shift+R',
      'CommandOrControl+Shift+R',
      'Alt+Shift+Space',
      'CommandOrControl+Shift+Space',
      'Alt+Space',
    ];

    // Filter duplicates while maintaining preference order
    const uniqueCandidates = Array.from(new Set(candidates));

    for (const shortcut of uniqueCandidates) {
      try {
        const success = globalShortcut.register(shortcut, () => {
          this.onTrigger();
        });
        if (success) {
          this.registeredShortcuts.push(shortcut);
          break;
        }
      } catch (e) {
        // Try next fallback
      }
    }

    return this.registeredShortcuts[0] || null;
  }

  public getRegistered(): string | null {
    return this.registeredShortcuts[0] || null;
  }

  public getAllRegistered(): string[] {
    return [...this.registeredShortcuts];
  }

  public getDisplayShortcut(): string {
    if (this.registrationAttempted && this.registeredShortcuts.length === 0) {
      return 'None';
    }
    const raw = this.registeredShortcuts[0] || HotkeyManager.getDefaultShortcut();
    return formatShortcutForDisplay(raw);
  }

  public unregister(): void {
    for (const sc of this.registeredShortcuts) {
      try {
        globalShortcut.unregister(sc);
      } catch (_) {}
    }
    this.registeredShortcuts = [];
  }

  public unregisterAll(): void {
    this.unregister();
    try {
      globalShortcut.unregisterAll();
    } catch (_) {}
    this.registeredShortcuts = [];
    this.registrationAttempted = false;
  }
}

