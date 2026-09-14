import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_SYNC_BATCH_SIZE,
  BACKOFF_DELAYS_MS,
  chunkArray,
  resolveLww,
  SyncService,
} from '../src/services/syncService';
import { storageService } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';

describe('Cloud Sync Engine & Offline-First Ledger (R5)', () => {
  let syncService: SyncService;

  beforeEach(() => {
    storageService.clearCache();
    syncService = new SyncService();
    vi.clearAllMocks();
  });

  describe('Outbound Batch Chunking (FastAPI Limit <= 500)', () => {
    it('enforces MAX_SYNC_BATCH_SIZE to be exactly 500 items', () => {
      expect(MAX_SYNC_BATCH_SIZE).toBe(500);
    });

    it('chunks exactly 1,200 records into [500, 500, 200]', () => {
      const items = Array.from({ length: 1200 }, (_, i) => ({ id: `rem-${i}` }));
      const chunks = chunkArray(items, 500);

      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(500);
      expect(chunks[1].length).toBe(500);
      expect(chunks[2].length).toBe(200);

      // Verify continuous ordering
      expect(chunks[0][0].id).toBe('rem-0');
      expect(chunks[0][499].id).toBe('rem-499');
      expect(chunks[1][0].id).toBe('rem-500');
      expect(chunks[1][499].id).toBe('rem-999');
      expect(chunks[2][0].id).toBe('rem-1000');
      expect(chunks[2][199].id).toBe('rem-1199');
    });

    it('handles empty input by returning a single empty chunk for polling', () => {
      const chunks = chunkArray([], 500);
      expect(chunks).toEqual([[]]);
    });

    it('handles boundary cases (exact 500 items vs 501 items)', () => {
      const exact500 = Array.from({ length: 500 }, (_, i) => i);
      expect(chunkArray(exact500, 500).length).toBe(1);
      expect(chunkArray(exact500, 500)[0].length).toBe(500);

      const items501 = Array.from({ length: 501 }, (_, i) => i);
      const chunks501 = chunkArray(items501, 500);
      expect(chunks501.length).toBe(2);
      expect(chunks501[0].length).toBe(500);
      expect(chunks501[1].length).toBe(1);
    });
  });

  describe('Bidirectional Last-Write-Wins (LWW) Resolution', () => {
    it('applies remote when remote updatedAt is newer than local', () => {
      const local: Reminder = {
        id: 'rem-1',
        title: 'Local version',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
      };

      const remote: Reminder = {
        id: 'rem-1',
        title: 'Remote version (edited on phone)',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:30:00.000Z', // 30m newer
      };

      const { winner, action } = resolveLww(local, remote);
      expect(action).toBe('apply_remote');
      expect(winner.title).toBe('Remote version (edited on phone)');
    });

    it('retains local when local updatedAt is newer than remote', () => {
      const local: Reminder = {
        id: 'rem-2',
        title: 'Fresh local edit',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:45:00.000Z', // newer
      };

      const remote: Reminder = {
        id: 'rem-2',
        title: 'Old remote edit',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:15:00.000Z',
      };

      const { winner, action } = resolveLww(local, remote);
      expect(action).toBe('keep_local');
      expect(winner.title).toBe('Fresh local edit');
    });

    it('deletes local record when remote has isDeleted=true and is newer', () => {
      const local: Reminder = {
        id: 'rem-3',
        title: 'About to be deleted',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:10:00.000Z',
      };

      const remoteDeleted: Reminder = {
        id: 'rem-3',
        title: 'About to be deleted',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:20:00.000Z',
        isDeleted: true,
      };

      const { action } = resolveLww(local, remoteDeleted);
      expect(action).toBe('delete');
    });
  });

  describe('Sync Execution with Mocked Fetch', () => {
    it('transmits reminders, applies remote changes, and prunes tombstones', async () => {
      const localItem: Reminder = {
        id: 'loc-1',
        title: 'Local Item',
        dueDate: '2026-09-14T10:00:00Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00Z',
        updatedAt: '2026-09-14T09:00:00Z',
        notificationId: 'os-notif-1', // Should be stripped on wire
      };

      const deletedItem: Reminder = {
        id: 'tomb-1',
        title: 'To prune',
        dueDate: '2026-09-14T10:00:00Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00Z',
        updatedAt: '2026-09-14T09:00:00Z',
        isDeleted: true,
      };

      await storageService.saveReminders([localItem, deletedItem]);

      const mockFetch = vi.fn().mockImplementation(async (url, init) => {
        const body = JSON.parse(init.body);
        // Verify notificationId is stripped
        expect(body.reminders[0].notificationId).toBeUndefined();
        // Verify header
        expect(init.headers['X-PMEM-TOKEN']).toBeDefined();

        return {
          ok: true,
          status: 200,
          json: async () => ({
            synced: [
              {
                id: 'remote-new-1',
                title: 'Remote Task from Cloud',
                dueDate: '2026-09-14T12:00:00Z',
                status: 'pending',
                snoozeCount: 0,
                createdAt: '2026-09-14T09:30:00Z',
                updatedAt: '2026-09-14T09:30:00Z',
                armed: true,
              },
            ],
            serverSyncTime: '2026-09-14T09:35:00.000Z',
          }),
        };
      });

      const res = await syncService.sync({ fetchFn: mockFetch as any });

      expect(res.success).toBe(true);
      expect(res.syncedCount).toBe(1);
      expect(res.serverSyncTime).toBe('2026-09-14T09:35:00.000Z');

      // Local storage has remote-new-1
      expect(storageService.getById('remote-new-1')).toBeDefined();
      // Tombstone tomb-1 was pruned
      expect(storageService.getById('tomb-1')).toBeUndefined();
      // Sync cursor updated
      expect(storageService.getClientSyncTime()).toBe('2026-09-14T09:35:00.000Z');
    });
  });

  describe('Exponential Backoff Retry Ladder', () => {
    it('verifies backoff delays step through [1000, 2000, 4000, 8000, 16000, 30000] ms', () => {
      expect(BACKOFF_DELAYS_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    });

    it('immediately halts and does not retry on HTTP 401 or 403 (Auth failure)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const sleepSpy = vi.fn().mockResolvedValue(undefined);

      const res = await syncService.syncWithRetry({
        maxRetries: 5,
        fetchFn: mockFetch as any,
        sleepFn: sleepSpy,
      });

      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.error).toContain('Authentication failed (HTTP 401)');
      // Zero retry attempts!
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it('retries through backoff ladder on transient 500 error then succeeds', async () => {
      let callCount = 0;
      const delaysRecorded: number[] = [];

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return {
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            synced: [],
            serverSyncTime: '2026-09-14T10:00:00.000Z',
          }),
        };
      });

      const sleepSpy = vi.fn().mockImplementation(async (ms) => {
        delaysRecorded.push(ms);
      });

      const res = await syncService.syncWithRetry({
        maxRetries: 4,
        fetchFn: mockFetch as any,
        sleepFn: sleepSpy,
      });

      expect(res.success).toBe(true);
      expect(callCount).toBe(3);
      // Attempt 1 delay = 1000ms, Attempt 2 delay = 2000ms
      expect(delaysRecorded).toEqual([1000, 2000]);
    });
  });
});
