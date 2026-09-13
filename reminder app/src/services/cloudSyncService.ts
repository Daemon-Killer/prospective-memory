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

export const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
export const POLL_INTERVAL_MS = 30000;

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

function isJestRuntime(): boolean {
  return typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;
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
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt: number = 0;
  private appStateSubscription: { remove: () => void } | null = null;
  private windowFocusHandler: (() => void) | null = null;
  private unbindMutation: (() => void) | null = null;
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

      this.unbindMutation = storageService.onMutation(() => {
        this.triggerDebouncedSync();
      });

      this.startAutoSync();

      if (this.enabled && !isJestRuntime()) {
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
    let credentialsChanged = false;
    if (newConfig.apiUrl !== undefined) {
      const trimmed = newConfig.apiUrl.trim().replace(/\/+$/, '');
      if (trimmed !== this.apiUrl) {
        credentialsChanged = true;
        this.apiUrl = trimmed;
        await AsyncStorage.setItem(CLOUD_STORAGE_KEY_URL, this.apiUrl);
      }
    }
    if (newConfig.token !== undefined) {
      const trimmed = newConfig.token.trim();
      if (trimmed !== this.token) {
        credentialsChanged = true;
        this.token = trimmed;
        await AsyncStorage.setItem(CLOUD_STORAGE_KEY_TOKEN, this.token);
      }
    }
    if (credentialsChanged) {
      this.lastSyncTime = null;
      await AsyncStorage.removeItem(CLOUD_STORAGE_KEY_LAST_SYNC);
    }
    if (newConfig.enabled !== undefined) {
      this.enabled = newConfig.enabled;
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_ENABLED, String(this.enabled));
    }
    this.notifyListeners();

    if (this.enabled) {
      this.syncNow({ forceFull: credentialsChanged });
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

  private triggerDebouncedSync(delayMs: number = 300): void {
    if (!this.enabled || isJestRuntime()) {
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.syncNow();
    }, delayMs);
  }

  /**
   * Resets the local incremental sync cursor and triggers a full sync with the remote cloud.
   * Merges all remote reminders into local storage via Last-Write-Wins without data loss.
   */
  async forceFullSync(): Promise<SyncResult> {
    this.lastSyncTime = null;
    await AsyncStorage.removeItem(CLOUD_STORAGE_KEY_LAST_SYNC);
    return this.syncNow({ forceFull: true });
  }

  async syncNow(options?: { forceFull?: boolean }): Promise<SyncResult> {
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

      const localReminders = storageService.getAllForSync().map((reminder) => {
        const { notificationId: _notificationId, ...wire } = reminder;
        return wire;
      });
      const endpoint = `${this.apiUrl}/v1/reminders/sync`;

      // If forceFull is requested OR if local cache is completely empty,
      // request all active records from server (clientSyncTime: null).
      const shouldDoFullSync = options?.forceFull || storageService.getAll().length === 0;
      const clientSyncTime = shouldDoFullSync ? null : this.lastSyncTime;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PMEM-TOKEN': this.token,
        },
        body: JSON.stringify({
          reminders: localReminders,
          clientSyncTime,
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
        await storageService.applyRemoteSync(syncedItems as Reminder[]);
      }
      await storageService.pruneSyncedTombstones();

      this.lastSyncTime = serverSyncTime;
      await AsyncStorage.setItem(CLOUD_STORAGE_KEY_LAST_SYNC, serverSyncTime);

      this.retryAttempt = 0;
      this.clearBackoff();
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
      this.scheduleBackoffRetry();
      return { success: false, syncedCount: 0, error: msg };
    } finally {
      this.isSyncInProgress = false;
    }
  }

  private scheduleBackoffRetry(): void {
    if (!this.enabled || isJestRuntime()) {
      return;
    }
    if (this.backoffTimer) {
      return;
    }
    const delay = BACKOFF_DELAYS_MS[Math.min(this.retryAttempt, BACKOFF_DELAYS_MS.length - 1)];
    this.retryAttempt += 1;
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.syncNow();
    }, delay);
  }

  private clearBackoff(): void {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private startAutoSync(): void {
    if (isJestRuntime()) {
      return;
    }
    if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);

    this.pollIntervalTimer = setInterval(() => {
      if (this.enabled && !this.isSyncInProgress) {
        this.syncNow();
      }
    }, POLL_INTERVAL_MS);

    if (!this.appStateSubscription && AppState?.addEventListener) {
      this.appStateSubscription = AppState.addEventListener(
        'change',
        (nextAppState: AppStateStatus) => {
          if (nextAppState === 'active' && this.enabled) {
            this.syncNow();
          }
        }
      );
    }

    if (
      !this.windowFocusHandler &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      this.windowFocusHandler = () => {
        if (this.enabled) {
          this.syncNow();
        }
      };
      window.addEventListener('focus', this.windowFocusHandler);
    }
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);
    this.clearBackoff();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.unbindMutation?.();
    this.unbindMutation = null;
    if (this.windowFocusHandler && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.windowFocusHandler);
      this.windowFocusHandler = null;
    }
    this.listeners.clear();
  }
}

export const cloudSyncService = new CloudSyncService();
