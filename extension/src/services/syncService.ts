/**
 * Cloud Sync Engine & Offline-First Ledger
 * Implements bidirectional Last-Write-Wins (LWW) sync against POST /v1/reminders/sync.
 * Chunks outbound batches into <= 500 items to satisfy FastAPI validation limit.
 * Implements exponential backoff retry ladder: [1000, 2000, 4000, 8000, 16000, 30000] ms.
 * Immediately halts retries on HTTP 401 or 403.
 */

import { Reminder } from '../types/reminder';
import { storageService } from './storageService';
import { registerSyncTrigger } from './notificationService';

export const MAX_SYNC_BATCH_SIZE = 500;
export const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  serverSyncTime?: string;
  error?: string;
  statusCode?: number;
}

export interface SyncBatchIn {
  reminders: Omit<Reminder, 'notificationId'>[];
  clientSyncTime: string | null;
}

export interface SyncBatchOut {
  synced: Reminder[];
  serverSyncTime: string;
}

/**
 * Strictly chunks an array into slices of <= size (default 500).
 * If items is empty, returns [[]] so an empty batch can be sent to poll for updates.
 */
export function chunkArray<T>(items: T[], size: number = MAX_SYNC_BATCH_SIZE): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Resolves conflict between local and remote reminder using Last-Write-Wins (LWW)
 */
export function resolveLww(
  local: Reminder | undefined,
  remote: Reminder
): { winner: Reminder; action: 'keep_local' | 'apply_remote' | 'delete' } {
  if (!local) {
    if (remote.isDeleted) {
      return { winner: remote, action: 'delete' };
    }
    return { winner: remote, action: 'apply_remote' };
  }

  const localUpdatedMs = new Date(local.updatedAt || local.createdAt || 0).getTime();
  const remoteUpdatedMs = new Date(remote.updatedAt || remote.createdAt || 0).getTime();

  if (remoteUpdatedMs >= localUpdatedMs) {
    if (remote.isDeleted) {
      return { winner: remote, action: 'delete' };
    }
    return { winner: remote, action: 'apply_remote' };
  }

  // Local is strictly newer: retain local record (will be pushed on next sync)
  return { winner: local, action: 'keep_local' };
}

export class SyncService {
  private status: SyncStatus = 'idle';
  private lastError: string | null = null;
  private debounceTimer: any = null;

  constructor() {
    registerSyncTrigger(() => this.triggerDebouncedSync(300));
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Debounced sync trigger for rapid edits
   */
  public triggerDebouncedSync(delayMs: number = 300): Promise<SyncResult> {
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(async () => {
        const res = await this.sync();
        resolve(res);
      }, delayMs);
    });
  }

  /**
   * Executes a single sync run, chunking outbound records into <= 500 items.
   */
  public async sync(options?: { forceFull?: boolean; fetchFn?: typeof fetch }): Promise<SyncResult> {
    const fetchImpl = options?.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) {
      return { success: false, syncedCount: 0, error: 'No fetch implementation available' };
    }

    await storageService.init();
    const config = storageService.getConfig();

    if (!config.syncEnabled) {
      return { success: true, syncedCount: 0 };
    }

    if (!config.apiUrl || !config.token) {
      this.status = 'error';
      this.lastError = 'Missing apiUrl or token';
      return { success: false, syncedCount: 0, error: this.lastError };
    }

    this.status = 'syncing';
    this.lastError = null;

    try {
      const allLocal = storageService.getAllForSync();
      // Strip notificationId prior to wire transmission
      const wireReminders = allLocal.map(({ notificationId, ...wire }) => wire);
      const chunks = chunkArray(wireReminders, MAX_SYNC_BATCH_SIZE);

      let clientCursor = options?.forceFull ? null : storageService.getClientSyncTime();
      let totalSynced = 0;
      let finalServerSyncTime: string | undefined;

      const baseUrl = config.apiUrl.replace(/\/+$/, '');
      const syncUrl = `${baseUrl}/v1/reminders/sync`;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Send clientSyncTime with first chunk; subsequent chunks send null in same run
        const clientSyncTime = i === 0 ? clientCursor : null;
        const payload: SyncBatchIn = {
          reminders: chunk,
          clientSyncTime,
        };

        const resp = await fetchImpl(syncUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PMEM-TOKEN': config.token,
          },
          body: JSON.stringify(payload),
        });

        if (resp.status === 401 || resp.status === 403) {
          const authErr = `Authentication failed (HTTP ${resp.status}): Invalid API token`;
          this.status = 'error';
          this.lastError = authErr;
          return { success: false, syncedCount: totalSynced, error: authErr, statusCode: resp.status };
        }

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`Server returned HTTP ${resp.status}: ${text}`);
        }

        const data: SyncBatchOut = await resp.json();
        finalServerSyncTime = data.serverSyncTime;

        // Apply bidirectional Last-Write-Wins for returned items
        if (Array.isArray(data.synced)) {
          for (const remote of data.synced) {
            const local = storageService.getById(remote.id);
            const { winner, action } = resolveLww(local, remote);

            if (action === 'delete') {
              await storageService.deleteReminder(remote.id);
            } else if (action === 'apply_remote') {
              await storageService.saveReminder(winner);
            }
          }
          totalSynced += data.synced.length;
        }
      }

      // Prune tombstones ONLY after successful server acknowledgment
      await storageService.pruneTombstones();

      // Update sync cursor
      if (finalServerSyncTime) {
        await storageService.setClientSyncTime(finalServerSyncTime);
      }

      this.status = 'synced';
      return {
        success: true,
        syncedCount: totalSynced,
        serverSyncTime: finalServerSyncTime,
      };
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err?.message || String(err);
      return {
        success: false,
        syncedCount: 0,
        error: this.lastError ?? undefined,
      };
    }
  }

  /**
   * Sync with exponential backoff retry ladder [1000, 2000, 4000, 8000, 16000, 30000] ms.
   * Halts immediately on 401/403.
   */
  public async syncWithRetry(options?: {
    maxRetries?: number;
    forceFull?: boolean;
    fetchFn?: typeof fetch;
    sleepFn?: (ms: number) => Promise<void>;
  }): Promise<SyncResult> {
    const maxRetries = options?.maxRetries ?? BACKOFF_DELAYS_MS.length;
    const sleep = options?.sleepFn || ((ms: number) => new Promise((res) => setTimeout(res, ms)));

    let attempt = 0;

    while (attempt <= maxRetries) {
      const result = await this.sync({
        forceFull: options?.forceFull,
        fetchFn: options?.fetchFn,
      });

      if (result.success) {
        return result;
      }

      // Immediate halt on authentication failure (401 / 403)
      if (result.statusCode === 401 || result.statusCode === 403) {
        return result;
      }

      if (attempt >= maxRetries) {
        return result;
      }

      const delayIndex = Math.min(attempt, BACKOFF_DELAYS_MS.length - 1);
      const delayMs = BACKOFF_DELAYS_MS[delayIndex];
      attempt++;
      await sleep(delayMs);
    }

    return {
      success: false,
      syncedCount: 0,
      error: this.lastError || 'Max retries exceeded',
    };
  }
}

export const syncService = new SyncService();
