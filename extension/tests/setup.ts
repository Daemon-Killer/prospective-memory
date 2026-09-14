import { vi, beforeEach } from 'vitest';

export function createChromeMock() {
  const localStore = new Map<string, any>();
  const syncStore = new Map<string, any>();

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn().mockImplementation((keys) => {
          if (!keys) return Promise.resolve(Object.fromEntries(localStore));
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: localStore.get(keys) });
          }
          if (Array.isArray(keys)) {
            const res: Record<string, any> = {};
            for (const k of keys) {
              if (localStore.has(k)) res[k] = localStore.get(k);
            }
            return Promise.resolve(res);
          }
          if (typeof keys === 'object') {
            const res: Record<string, any> = { ...keys };
            for (const k of Object.keys(keys)) {
              if (localStore.has(k)) res[k] = localStore.get(k);
            }
            return Promise.resolve(res);
          }
          return Promise.resolve({});
        }),
        set: vi.fn().mockImplementation((items) => {
          for (const [k, v] of Object.entries(items)) {
            localStore.set(k, v);
          }
          return Promise.resolve();
        }),
        remove: vi.fn().mockImplementation((keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            localStore.delete(k);
          }
          return Promise.resolve();
        }),
        clear: vi.fn().mockImplementation(() => {
          localStore.clear();
          return Promise.resolve();
        }),
      },
      sync: {
        get: vi.fn().mockImplementation((keys) => {
          if (!keys) return Promise.resolve(Object.fromEntries(syncStore));
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: syncStore.get(keys) });
          }
          if (Array.isArray(keys)) {
            const res: Record<string, any> = {};
            for (const k of keys) {
              if (syncStore.has(k)) res[k] = syncStore.get(k);
            }
            return Promise.resolve(res);
          }
          if (typeof keys === 'object') {
            const res: Record<string, any> = { ...keys };
            for (const k of Object.keys(keys)) {
              if (syncStore.has(k)) res[k] = syncStore.get(k);
            }
            return Promise.resolve(res);
          }
          return Promise.resolve({});
        }),
        set: vi.fn().mockImplementation((items) => {
          for (const [k, v] of Object.entries(items)) {
            syncStore.set(k, v);
          }
          return Promise.resolve();
        }),
        remove: vi.fn().mockImplementation((keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            syncStore.delete(k);
          }
          return Promise.resolve();
        }),
        clear: vi.fn().mockImplementation(() => {
          syncStore.clear();
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
        hasListener: vi.fn(),
      },
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn().mockResolvedValue(true),
      clearAll: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      onAlarm: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
        hasListener: vi.fn(),
      },
    },
    notifications: {
      create: vi.fn().mockImplementation((id, opts, cb) => {
        const notifId = id || ('notif-' + Date.now());
        if (cb) cb(notifId);
        return Promise.resolve(notifId);
      }),
      clear: vi.fn().mockResolvedValue(true),
      getAll: vi.fn().mockResolvedValue({}),
      onButtonClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    omnibox: {
      setDefaultSuggestion: vi.fn(),
      onInputChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInputEntered: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    commands: {
      getAll: vi.fn().mockResolvedValue([]),
      onCommand: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      getPanelBehavior: vi.fn().mockResolvedValue({ openPanelOnActionClick: false }),
      setOptions: vi.fn().mockResolvedValue(undefined),
      getOptions: vi.fn().mockResolvedValue({}),
      open: vi.fn().mockResolvedValue(undefined),
    },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      getBadgeText: vi.fn().mockResolvedValue(''),
      setTitle: vi.fn().mockResolvedValue(undefined),
      setIcon: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onStartup: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      getManifest: vi.fn().mockReturnValue({}),
      getURL: vi.fn().mockImplementation((path) => 'chrome-extension://mock-id/' + path),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com', active: true }]),
      sendMessage: vi.fn().mockResolvedValue({ status: 'ACK' }),
      create: vi.fn().mockResolvedValue({ id: 2 }),
    },
  };

  return { chromeMock, localStore, syncStore };
}

export const { chromeMock, localStore, syncStore } = createChromeMock();

// @ts-ignore
globalThis.chrome = chromeMock;

beforeEach(() => {
  localStore.clear();
  syncStore.clear();
  vi.clearAllMocks();
});
