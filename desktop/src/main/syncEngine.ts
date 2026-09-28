import { Reminder, SyncBatchIn, SyncBatchOut, SyncResult, SyncStatus } from '../types';
import { LocalLedger } from './ledger';

export const MAX_SYNC_BATCH_SIZE = 500;
export const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export const DEFAULT_API_URL = 'https://prospective-memory-api.onrender.com';
export const DEFAULT_TOKEN = 'd/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=';

export function chunkArray<T>(items: T[], size: number = MAX_SYNC_BATCH_SIZE): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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

  return { winner: local, action: 'keep_local' };
}

export class SyncEngine {
  private ledger: LocalLedger;
  private apiUrl: string;
  private token: string;
  private status: SyncStatus = 'idle';
  private lastServerSyncTime: string | null = null;
  private lastError: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private listeners: Set<(status: SyncStatus, lastSync: string | null) => void> = new Set();

  constructor(
    ledger: LocalLedger,
    apiUrl: string = process.env.PMEM_API_URL || DEFAULT_API_URL,
    token: string = process.env.PMEM_TOKEN || DEFAULT_TOKEN
  ) {
    this.ledger = ledger;
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.token = token;
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  public getLastSyncTime(): string | null {
    return this.lastServerSyncTime;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public onStatusChange(fn: (status: SyncStatus, lastSync: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(status: SyncStatus, error: string | null = null): void {
    this.status = status;
    this.lastError = error;
    for (const listener of this.listeners) {
      try {
        listener(this.status, this.lastServerSyncTime);
      } catch (e) {
        console.error('SyncEngine listener error', e);
      }
    }
  }

  public triggerDebounced(delayMs: number = 300): Promise<SyncResult> {
    return new Promise((resolve) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        const res = await this.syncNow();
        resolve(res);
      }, delayMs);
    });
  }

  public startAutoSync(intervalMs: number = 30000): void {
    this.stopAutoSync();
    this.pollTimer = setInterval(() => {
      this.syncNow().catch((err) => console.warn('AutoSync error:', err));
    }, intervalMs);
  }

  public stopAutoSync(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async syncNow(): Promise<SyncResult> {
    if (this.status === 'syncing') {
      return { success: false, syncedCount: 0, error: 'Sync already in progress' };
    }

    this.setStatus('syncing');

    try {
      const allReminders = this.ledger.listReminders({ includeDeleted: true });
      const chunks = chunkArray(allReminders, MAX_SYNC_BATCH_SIZE);
      let totalSynced = 0;
      let lastServerTime: string | undefined;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Send clientSyncTime with first chunk; subsequent chunks send null in same run
        const clientSyncTime = i === 0 ? this.lastServerSyncTime : null;
        const payload: SyncBatchIn = {
          reminders: chunk,
          clientSyncTime,
        };

        const batchResult = await this.executeWithRetry(payload);
        if (!batchResult.success) {
          this.setStatus('error', batchResult.error);
          return batchResult;
        }

        // Apply remote changes into local ledger
        if (batchResult.serverSyncTime) {
          lastServerTime = batchResult.serverSyncTime;
        }

        totalSynced += batchResult.syncedCount;
      }

      if (lastServerTime) {
        this.lastServerSyncTime = lastServerTime;
      }

      this.setStatus('synced');
      return {
        success: true,
        syncedCount: totalSynced,
        serverSyncTime: this.lastServerSyncTime || undefined,
      };
    } catch (err: any) {
      const msg = err?.message || 'Sync failed';
      this.setStatus('error', msg);
      return { success: false, syncedCount: 0, error: msg };
    }
  }

  private async executeWithRetry(payload: SyncBatchIn): Promise<SyncResult> {
    const url = `${this.apiUrl}/v1/reminders/sync`;

    for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PMEM-TOKEN': this.token,
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 401 || response.status === 403) {
          return {
            success: false,
            syncedCount: 0,
            statusCode: response.status,
            error: `Authentication failed (HTTP ${response.status})`,
          };
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as SyncBatchOut;
        let applied = 0;

        if (Array.isArray(data.synced)) {
          for (const remote of data.synced) {
            const local = this.ledger.getReminder(remote.id);
            const decision = resolveLww(local || undefined, remote);

            if (decision.action === 'apply_remote' || decision.action === 'delete') {
              this.ledger.upsertReminder(decision.winner);
              applied++;
            }
          }
        }

        return {
          success: true,
          syncedCount: applied,
          serverSyncTime: data.serverSyncTime,
        };
      } catch (err: any) {
        if (attempt === BACKOFF_DELAYS_MS.length) {
          return {
            success: false,
            syncedCount: 0,
            error: err?.message || 'Max retries exceeded',
          };
        }
        const delay = BACKOFF_DELAYS_MS[attempt];
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return { success: false, syncedCount: 0, error: 'Retry loop exhausted' };
  }
}
