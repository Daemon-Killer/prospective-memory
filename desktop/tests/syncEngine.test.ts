import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, chunkArray, resolveLww } from '../src/main/syncEngine';
import { LocalLedger } from '../src/main/ledger';
import { Reminder } from '../src/types';

describe('Desktop Cloud Sync Engine', () => {
  let ledger: LocalLedger;

  beforeEach(async () => {
    ledger = new LocalLedger(':memory:');
    await ledger.init();
  });

  afterEach(() => {
    ledger.close();
    vi.restoreAllMocks();
  });

  describe('chunkArray', () => {
    it('returns [[]] for empty array so polling can send empty batch', () => {
      const chunks = chunkArray([]);
      expect(chunks).toEqual([[]]);
    });

    it('splits large array into chunks of <= 500 items', () => {
      const items = Array.from({ length: 1050 }, (_, i) => ({ id: `id-${i}` }));
      const chunks = chunkArray(items, 500);
      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(500);
      expect(chunks[1].length).toBe(500);
      expect(chunks[2].length).toBe(50);
    });
  });

  describe('resolveLww', () => {
    it('applies remote when local does not exist', () => {
      const remote: Reminder = {
        id: 'r1',
        title: 'Remote reminder',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:00:00.000Z',
      };
      const res = resolveLww(undefined, remote);
      expect(res.action).toBe('apply_remote');
      expect(res.winner).toBe(remote);
    });

    it('deletes when remote does not exist locally and isDeleted is true', () => {
      const remote: Reminder = {
        id: 'r1',
        title: 'Remote deleted',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:00:00.000Z',
        isDeleted: true,
      };
      const res = resolveLww(undefined, remote);
      expect(res.action).toBe('delete');
    });

    it('applies remote when remote updatedAt >= local updatedAt', () => {
      const local: Reminder = {
        id: 'r1',
        title: 'Local stale',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:00:00.000Z',
      };
      const remote: Reminder = {
        id: 'r1',
        title: 'Remote updated',
        dueDate: '2026-09-28T13:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:05:00.000Z',
      };
      const res = resolveLww(local, remote);
      expect(res.action).toBe('apply_remote');
      expect(res.winner.title).toBe('Remote updated');
    });

    it('keeps local when local updatedAt > remote updatedAt', () => {
      const local: Reminder = {
        id: 'r1',
        title: 'Local fresh',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T14:00:00.000Z',
      };
      const remote: Reminder = {
        id: 'r1',
        title: 'Remote stale',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T12:00:00.000Z',
        updatedAt: '2026-09-28T12:00:00.000Z',
      };
      const res = resolveLww(local, remote);
      expect(res.action).toBe('keep_local');
      expect(res.winner.title).toBe('Local fresh');
    });
  });

  describe('SyncEngine execution', () => {
    it('successfully syncs and applies inbound reminders from server', async () => {
      const remoteReminder: Reminder = {
        id: 'cloud-1',
        title: 'Cloud created reminder',
        dueDate: '2026-09-28T18:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          synced: [remoteReminder],
          serverSyncTime: '2026-09-28T12:00:00.000Z',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const engine = new SyncEngine(ledger, 'https://test-api.example.com', 'test-token');
      const result = await engine.syncNow();

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);
      expect(result.serverSyncTime).toBe('2026-09-28T12:00:00.000Z');
      expect(engine.getStatus()).toBe('synced');

      // Verify it was applied to the local ledger
      const inLedger = ledger.getReminder('cloud-1');
      expect(inLedger).not.toBeNull();
      expect(inLedger?.title).toBe('Cloud created reminder');
    });

    it('halts and returns error immediately on HTTP 401 Unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized token',
      });
      vi.stubGlobal('fetch', mockFetch);

      const engine = new SyncEngine(ledger, 'https://test-api.example.com', 'bad-token');
      const result = await engine.syncNow();

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(engine.getStatus()).toBe('error');
      // Should not retry on 401
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('sends X-PMEM-TOKEN header matching backend auth expectation', async () => {
      let sentHeaders: any = null;
      const mockFetch = vi.fn().mockImplementation((_url, options) => {
        sentHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ synced: [], serverSyncTime: '2026-09-28T12:00:00.000Z' }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      const engine = new SyncEngine(ledger, 'https://test-api.example.com', 'secret-pmem-token');
      await engine.syncNow();

      expect(sentHeaders).toBeDefined();
      expect(sentHeaders['X-PMEM-TOKEN']).toBe('secret-pmem-token');
    });

    it('applies remote deleted tombstones into ledger preserving remote updatedAt', async () => {
      const remoteDeleted: Reminder = {
        id: 'remote-del-1',
        title: 'Deleted elsewhere',
        dueDate: '2026-09-28T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T11:00:00.000Z',
        isDeleted: true,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          synced: [remoteDeleted],
          serverSyncTime: '2026-09-28T12:00:00.000Z',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const engine = new SyncEngine(ledger, 'https://test-api.example.com', 'test-token');
      const result = await engine.syncNow();

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);

      const inLedger = ledger.getReminder('remote-del-1');
      expect(inLedger).not.toBeNull();
      expect(inLedger?.isDeleted).toBe(true);
      expect(inLedger?.updatedAt).toBe('2026-09-28T11:00:00.000Z');
    });
  });
});
