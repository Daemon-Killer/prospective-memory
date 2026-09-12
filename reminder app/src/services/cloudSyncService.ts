import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { Reminder } from '../types/reminder';
import { storageService } from './storageService';

export const CLOUD_STORAGE_KEY_URL = '@remy/cloud_api_url';
export const CLOUD_STORAGE_KEY_TOKEN = '@remy/cloud_token';
export const CLOUD_STORAGE_KEY_LAST_SYNC = '@remy/cloud_last_sync';
export const CLOUD_STORAGE_KEY_ENABLED = '@remy/cloud_sync_enabled';

export const DEFAULT_API_URL = 'https://prospective-memory-api.onrender.com';
export const DEFAULT_TOKEN = 'd/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=';

export type CloudSyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'disabled';

export interface CloudConfig {
  apiUrl: string;
  token: string;
  enabled: boolean;
  lastSyncTime: string | null;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  serverSyncTime?: string;
  error?: string;
}

export class CloudSyncService {
  private apiUrl: string = DEFAULT_API_URL;
  private token: string = DEFAULT_TOKEN;
  private enabled: boolean = true;
  private lastSyncTime: string | null = null;
  private state: CloudSyncState = 'idle';
  private errorMessage: string | null = null;

  private isSyncInProgress: boolean = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(state: CloudSyncState, config: CloudConfig) => void> = new Set();
  private initialized: boolean = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const [savedUrl, savedToken, savedLastSync, savedEnabled] = await Promise.all([
        AsyncStorage.getItem(CLOUD_STORAGE_KEY_URL),
        AsyncStorage.getItem(CLOUD_STORAGE_KEY_TOKEN),
        AsyncStorage.getItem(CLOUD_STORAGE_KEY_LAST_SYNC),
        AsyncStorage.getItem(CLOUD_STORAGE_KEY_ENABLED),
      ]);

      if (savedUrl) this.apiUrl = savedUrl.trim();
      if (savedToken) this.token = savedToken.trim();
      if (savedLastSync) this.lastSyncTime = savedLastSync;
      if (savedEnabled !== null) this.enabled = savedEnabled === 'true';

      this.initialized = true;
      this.notifyListeners();

      // Hook into local mutations
      storageService.onMutation(() => {
        this.triggerDebouncedSync();
      });

      // Start auto sync polling & lifecycle listeners
      this.startAutoSync();

      // Initial sync
      if (this.enabled) {
        setTimeout(() => this.syncNow(), 500);
      }
    } catch (e) {
      console.warn('CloudSyncService: Error during init', e);
      this.initialized = true;
    }
  }

  getConfig(): CloudConfig {
    return {
      apiUrl: this.apiUrl,
      token: this.token,
      enabled: this.enabled,
      lastSyncTime: this.lastSyncTime,
    };
  }

  getState(): CloudSyncState {
    return this.enabled ? this.state : 'disabled';
  }

  getErrorMessage(): string | null {
    return this.errorMessage;
  }

  async updateConfig(newConfig: Partial<CloudConfig>): Promise<void> {
    if (newConfig.apiUrl !== undefined) {
      this.apiUrl = newConfig.apiUrl.trim().replace(/\/+$/, '');
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_URL, this.apiUrl);
    }
    if (newConfig.token !== undefined) {
      this.token = newConfig.token.trim();
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_TOKEN, this.token);
    }
    if (newConfig.enabled !== undefined) {
      this.enabled = newConfig.enabled;
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_ENABLED, String(this.enabled));
    }
    this.notifyListeners();

    if (this.enabled) {
      this.syncNow();
    }
  }

  subscribe(listener: (state: CloudSyncState, config: CloudConfig) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState(), this.getConfig());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    const config = this.getConfig();
    for (const listener of this.listeners) {
      try {
        listener(currentState, config);
      } catch (e) {
        console.error('CloudSyncService: Error notifying listener', e);
      }
    }
  }

  triggerDebouncedSync(delayMs: number = 800): void {
    if (!this.enabled || !this.apiUrl || !this.token) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.syncNow();
    }, delayMs);
  }

  async syncNow(): Promise<SyncResult> {
    if (!this.enabled) {
      return { success: false, syncedCount: 0, error: 'Sync disabled' };
    }
    if (this.isSyncInProgress) {
      return { success: true, syncedCount: 0 };
    }
    if (!this.apiUrl || !this.token) {
      this.state = 'error';
      this.errorMessage = 'Missing API URL or Token';
      this.notifyListeners();
      return { success: false, syncedCount: 0, error: this.errorMessage };
    }

    this.isSyncInProgress = true;
    this.state = 'syncing';
    this.errorMessage = null;
    this.notifyListeners();

    try {
      if (!storageService.isReady()) {
        await storageService.init();
      }

      const localReminders = storageService.getAll();
      const endpoint = `${this.apiUrl}/v1/reminders/sync`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PMEM-TOKEN': this.token,
        },
        body: JSON.stringify({
          reminders: localReminders,
          clientSyncTime: this.lastSyncTime,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const data = await response.json();
      const syncedItems: Reminder[] = data.synced || [];
      const serverSyncTime: string = data.serverSyncTime || new Date().toISOString();

      if (syncedItems.length > 0) {
        await storageService.applyRemoteSync(syncedItems);
      }

      this.lastSyncTime = serverSyncTime;
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_LAST_SYNC, serverSyncTime);

      this.state = 'synced';
      this.errorMessage = null;
      this.notifyListeners();

      return {
        success: true,
        syncedCount: syncedItems.length,
        serverSyncTime,
      };
    } catch (err: any) {
      const msg = err?.message || 'Network sync error';
      this.state = 'error';
      this.errorMessage = msg;
      this.notifyListeners();
      return { success: false, syncedCount: 0, error: msg };
    } finally {
      this.isSyncInProgress = false;
    }
  }

  private startAutoSync(): void {
    if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);

    // Sync every 30 seconds if active
    this.pollIntervalTimer = setInterval(() => {
      if (this.enabled && !this.isSyncInProgress) {
        this.syncNow();
      }
    }, 30000);

    // Listen to AppState (mobile and web)
    AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && this.enabled) {
        this.syncNow();
      }
    });

    // Also attach window focus on web if available
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => {
        if (this.enabled) {
          this.syncNow();
        }
      });
    }
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);
    this.listeners.clear();
  }
}

export const cloudSyncService = new CloudSyncService();
