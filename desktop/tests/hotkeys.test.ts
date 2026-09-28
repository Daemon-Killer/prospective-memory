import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HotkeyManager } from '../src/main/hotkeys';

let registeredShortcut: string | null = null;
let registeredCallback: (() => void) | null = null;
let registerFailureList: string[] = [];

vi.mock('electron', () => {
  return {
    globalShortcut: {
      register: (shortcut: string, callback: () => void) => {
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
    triggerCount = 0;
    hotkeyManager = new HotkeyManager(() => {
      triggerCount++;
    });
  });

  afterEach(() => {
    hotkeyManager.unregisterAll();
    vi.restoreAllMocks();
  });

  it('registers the preferred hotkey Alt+Shift+Space', () => {
    const registered = hotkeyManager.register('Alt+Shift+Space');
    expect(registered).toBe('Alt+Shift+Space');
    expect(hotkeyManager.getRegistered()).toBe('Alt+Shift+Space');

    // Trigger shortcut callback
    expect(registeredCallback).not.toBeNull();
    registeredCallback!();
    expect(triggerCount).toBe(1);
  });

  it('falls back to secondary shortcuts if preferred is taken', () => {
    registerFailureList = ['Alt+Shift+Space'];
    const registered = hotkeyManager.register('Alt+Shift+Space');
    expect(registered).toBe('CommandOrControl+Shift+Space');
    expect(hotkeyManager.getRegistered()).toBe('CommandOrControl+Shift+Space');
  });

  it('unregisters shortcut cleanly', () => {
    hotkeyManager.register('Alt+Shift+Space');
    expect(hotkeyManager.getRegistered()).toBe('Alt+Shift+Space');
    hotkeyManager.unregister();
    expect(hotkeyManager.getRegistered()).toBeNull();
  });
});
