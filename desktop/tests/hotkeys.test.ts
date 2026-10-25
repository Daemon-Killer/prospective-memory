import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HotkeyManager,
  normalizeAccelerator,
  formatShortcutForDisplay,
} from '../src/main/hotkeys';

let registeredShortcut: string | null = null;
let registeredCallback: (() => void) | null = null;
let registerFailureList: string[] = [];
let registrationAttempts: string[] = [];

vi.mock('electron', () => {
  return {
    globalShortcut: {
      register: (shortcut: string, callback: () => void) => {
        registrationAttempts.push(shortcut);
        if (registerFailureList.includes(shortcut)) {
          return false;
        }
        registeredShortcut = shortcut;
        registeredCallback = callback;
        return true;
      },
      unregister: (shortcut: string) => {
        if (registeredShortcut === shortcut) {
          registeredShortcut = null;
          registeredCallback = null;
        }
      },
      unregisterAll: () => {
        registeredShortcut = null;
        registeredCallback = null;
      },
    },
  };
});

describe('Desktop Hotkey Manager', () => {
  let hotkeyManager: HotkeyManager;
  let triggerCount: number;

  beforeEach(() => {
    registeredShortcut = null;
    registeredCallback = null;
    registerFailureList = [];
    registrationAttempts = [];
    triggerCount = 0;
    hotkeyManager = new HotkeyManager(() => {
      triggerCount++;
    });
  });

  afterEach(() => {
    hotkeyManager.unregisterAll();
    vi.restoreAllMocks();
  });

  it('provides platform-specific default shortcut', () => {
    const defaultShortcut = HotkeyManager.getDefaultShortcut();
    if (process.platform === 'darwin') {
      expect(defaultShortcut).toBe('Command+Shift+R');
    } else {
      expect(defaultShortcut).toBe('Control+Alt+R');
    }
  });

  it('registers the platform default shortcut when none specified', () => {
    const registered = hotkeyManager.register();
    const expected = HotkeyManager.getDefaultShortcut();
    expect(registered).toBe(expected);
    expect(hotkeyManager.getRegistered()).toBe(expected);
    expect(hotkeyManager.getAllRegistered()).toEqual([expected]);
    expect(registeredShortcut).toBe(expected);

    // Trigger shortcut callback
    expect(registeredCallback).not.toBeNull();
    registeredCallback!();
    expect(triggerCount).toBe(1);
  });

  it('registers custom preferred hotkey when specified', () => {
    const registered = hotkeyManager.register('Alt+Shift+Space');
    expect(registered).toBe('Alt+Shift+Space');
    expect(hotkeyManager.getRegistered()).toBe('Alt+Shift+Space');
  });

  it('normalizes Win+Shift+R to Super+Shift+R for Electron globalShortcut', () => {
    expect(normalizeAccelerator('Win+Shift+R')).toBe('Super+Shift+R');
    expect(normalizeAccelerator('Cmd+Shift+R')).toBe('Command+Shift+R');
    expect(normalizeAccelerator('Option+Shift+R')).toBe('Alt+Shift+R');

    const registered = hotkeyManager.register('Win+Shift+R');
    expect(registered).toBe('Super+Shift+R');
    expect(hotkeyManager.getRegistered()).toBe('Super+Shift+R');
  });

  it('formats shortcuts cleanly for display across platforms', () => {
    const display = formatShortcutForDisplay('Super+Shift+R');
    if (process.platform === 'darwin') {
      expect(display).toBe('Cmd+Shift+R');
    } else {
      expect(display).toBe('Win+Shift+R');
    }
  });

  it('returns clean display shortcut via getDisplayShortcut()', () => {
    hotkeyManager.register('Win+Shift+R');
    const display = hotkeyManager.getDisplayShortcut();
    if (process.platform === 'darwin') {
      expect(display).toBe('Cmd+Shift+R');
    } else {
      expect(display).toBe('Win+Shift+R');
    }
  });

  it('falls back to secondary shortcuts if preferred is taken', () => {
    const preferred = HotkeyManager.getDefaultShortcut();
    registerFailureList = [preferred];
    const registered = hotkeyManager.register(preferred);
    expect(registered).not.toBeNull();
    expect(registered).not.toBe(preferred);
  });

  it('cascades through fallback list when both Alt+Shift+R and Win+Shift+R collide', () => {
    // Attack surface: both primary and secondary candidate shortcuts are bound by another app
    registerFailureList = ['Alt+Shift+R', 'Super+Shift+R', 'Command+Shift+R'];
    const registered = hotkeyManager.register('Alt+Shift+R');
    expect(registered).not.toBeNull();
    expect(registered).not.toBe('Alt+Shift+R');
    expect(registered).not.toBe('Super+Shift+R');
    expect(registered).not.toBe('Command+Shift+R');
    // Should have cascaded to non-colliding fallback candidates
    expect([
      'Control+Alt+Space',
      'F9',
      'Shift+F9',
      'Control+Alt+N',
      'Control+Alt+R',
      'CommandOrControl+Shift+R',
      'Alt+Shift+Space',
      'CommandOrControl+Shift+Space',
      'Alt+Space',
    ]).toContain(registered);
  });

  it('returns null and displays None when all candidate shortcuts fail', () => {
    // Force all possible candidate registrations to fail
    registerFailureList = [
      'Alt+Shift+R',
      'Super+Shift+R',
      'Command+Shift+R',
      'Control+Alt+Space',
      'F9',
      'Shift+F9',
      'Control+Alt+N',
      'Control+Alt+R',
      'CommandOrControl+Shift+R',
      'Alt+Shift+Space',
      'CommandOrControl+Shift+Space',
      'Alt+Space',
    ];
    const registered = hotkeyManager.register();
    expect(registered).toBeNull();
    expect(hotkeyManager.getRegistered()).toBeNull();
    expect(hotkeyManager.getDisplayShortcut()).toBe('None');
    expect(registrationAttempts).not.toContain('Control+Shift+K');
  });

  it('safely handles empty, null, or undefined inputs in format and normalize', () => {
    expect(normalizeAccelerator('')).toBe('');
    expect(normalizeAccelerator(null as any)).toBe('');
    expect(normalizeAccelerator(undefined as any)).toBe('');

    expect(formatShortcutForDisplay('')).toBe('');
    expect(formatShortcutForDisplay(null as any)).toBe('');
    expect(formatShortcutForDisplay(undefined as any)).toBe('');
  });

  it('unregisters shortcut cleanly', () => {
    hotkeyManager.register();
    expect(hotkeyManager.getRegistered()).not.toBeNull();
    hotkeyManager.unregister();
    expect(hotkeyManager.getRegistered()).toBeNull();
  });
});

