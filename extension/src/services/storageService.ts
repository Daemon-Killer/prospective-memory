/**
 * Storage Service - Dual Storage Segregation & Offline-First Ledger
 * - chrome.storage.local: Active reminder ledger with 0ms in-memory cache
 * - chrome.storage.sync: User configuration (apiUrl, token, customLingo, syncEnabled)
 */

import {
  Reminder,
  UserConfig,
  DEFAULT_CONFIG,
} from '../types/reminder';

class StorageService {
  private cache = new Map<string, Reminder>();
  private configCache: UserConfig = { ...DEFAULT_CONFIG };
  private clientSyncTime: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.setupStorageListener();
  }

  private setupStorageListener() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          if (changes.reminders) {
            this.hydrateRemindersFromRaw(changes.reminders.newValue);
          }
          if (changes.clientSyncTime) {
            this.clientSyncTime = changes.clientSyncTime.newValue ?? null;
          }
        } else if (areaName === 'sync') {
          if (changes.userConfig) {
            this.configCache = { ...DEFAULT_CONFIG, ...changes.userConfig.newValue };
          }
        }
      });
    }
  }

  /**
   * Initializes in-memory cache from chrome.storage.local and chrome.storage.sync
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        this.initialized = true;
        return;
      }

      try {
        const [localData, syncData] = await Promise.all([
          chrome.storage.local.get(['reminders', 'clientSyncTime']),
          chrome.storage.sync.get(['userConfig']),
        ]);

        if (localData) {
          if (localData.reminders) {
            this.hydrateRemindersFromRaw(localData.reminders);
          }
          if (localData.clientSyncTime) {
            this.clientSyncTime = localData.clientSyncTime;
          }
        }

        if (syncData?.userConfig) {
          this.configCache = { ...DEFAULT_CONFIG, ...syncData.userConfig };
        }
      } catch (err) {
        console.warn('[StorageService] Error initializing storage:', err);
      } finally {
        this.initialized = true;
      }
    })();

    return this.initPromise;
  }

  private hydrateRemindersFromRaw(raw: unknown) {
    if (!raw) return;
    if (Array.isArray(raw)) {
      this.cache.clear();
      for (const item of raw) {
        if (item && item.id) {
          this.cache.set(item.id, item);
        }
      }
    } else if (typeof raw === 'object') {
      this.cache.clear();
      for (const [id, item] of Object.entries(raw as Record<string, Reminder>)) {
        if (item && item.id) {
          this.cache.set(id, item);
        }
      }
    }
  }

  private async flushLocal(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const remindersObj = Object.fromEntries(this.cache.entries());
    await chrome.storage.local.set({
      reminders: remindersObj,
      clientSyncTime: this.clientSyncTime,
    });
  }

  // --- 0ms Synchronous Cache Reads ---

  public getAll(): Reminder[] {
    return Array.from(this.cache.values());
  }

  public getById(id: string): Reminder | undefined {
    return this.cache.get(id);
  }

  public getActive(): Reminder[] {
    return this.getAll().filter((r) => !r.isDeleted && r.status !== 'completed');
  }

  public getPending(): Reminder[] {
    return this.getAll().filter(
      (r) => !r.isDeleted && (r.status === 'pending' || r.status === 'snoozed')
    );
  }

  public getArmed(): Reminder[] {
    return this.getAll().filter(
      (r) => !r.isDeleted && r.armed !== false && r.status !== 'completed'
    );
  }

  public getAllForSync(): Reminder[] {
    return Array.from(this.cache.values());
  }

  // --- Fast In-Memory Writes with Write-Through Persistence ---

  public async saveReminder(reminder: Reminder): Promise<Reminder> {
    // 0ms in-memory cache update
    this.cache.set(reminder.id, reminder);
    // Asynchronous write-through flush
    await this.flushLocal();
    return reminder;
  }

  public async saveReminders(reminders: Reminder[]): Promise<void> {
    for (const r of reminders) {
      this.cache.set(r.id, r);
    }
    await this.flushLocal();
  }

  public async softDeleteReminder(id: string): Promise<boolean> {
    const existing = this.cache.get(id);
    if (!existing) return false;
    const updated: Reminder = {
      ...existing,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    await this.flushLocal();
    return true;
  }

  public async deleteReminder(id: string): Promise<boolean> {
    const existed = this.cache.delete(id);
    if (existed) {
      await this.flushLocal();
    }
    return existed;
  }

  /**
   * Prunes tombstones (isDeleted === true) after server acknowledges sync
   */
  public async pruneTombstones(): Promise<number> {
    let count = 0;
    for (const [id, item] of this.cache.entries()) {
      if (item.isDeleted) {
        this.cache.delete(id);
        count++;
      }
    }
    if (count > 0) {
      await this.flushLocal();
    }
    return count;
  }

  // --- Sync Cursor ---

  public getClientSyncTime(): string | null {
    return this.clientSyncTime;
  }

  public async setClientSyncTime(time: string | null): Promise<void> {
    this.clientSyncTime = time;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ clientSyncTime: time });
    }
  }

  // --- Configuration (chrome.storage.sync) ---

  public getConfig(): UserConfig {
    return { ...this.configCache };
  }

  public async saveConfig(config: Partial<UserConfig>): Promise<UserConfig> {
    this.configCache = { ...this.configCache, ...config };
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      await chrome.storage.sync.set({ userConfig: this.configCache });
    }
    return this.getConfig();
  }

  public clearCache(): void {
    this.cache.clear();
    this.clientSyncTime = null;
    this.configCache = { ...DEFAULT_CONFIG };
    this.initialized = false;
    this.initPromise = null;
  }
}

export const storageService = new StorageService();
