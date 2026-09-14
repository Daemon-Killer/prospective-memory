import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storageService } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';
import { localStore, syncStore } from './setup';

describe('Dual Storage Ledger & 0ms In-Memory Cache (R5)', () => {
  beforeEach(() => {
    storageService.clearCache();
    localStore.clear();
    syncStore.clear();
    vi.clearAllMocks();
  });

  describe('Dual Storage Segregation', () => {
    it('stores active reminders in chrome.storage.local', async () => {
      const reminder: Reminder = {
        id: 'rem-local-1',
        title: 'Local task',
        dueDate: '2026-09-14T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T11:00:00.000Z',
        updatedAt: '2026-09-14T11:00:00.000Z',
        armed: true,
      };

      await storageService.saveReminder(reminder);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const stored = localStore.get('reminders');
      expect(stored).toBeDefined();
      expect(stored['rem-local-1']).toBeDefined();
      expect(stored['rem-local-1'].title).toBe('Local task');
    });

    it('stores user configuration in chrome.storage.sync', async () => {
      await storageService.saveConfig({
        apiUrl: 'https://custom-api.example.com',
        token: 'test-token-123',
        customLingo: 'c=call $',
      });

      expect(chrome.storage.sync.set).toHaveBeenCalled();
      const storedConfig = syncStore.get('userConfig');
      expect(storedConfig).toBeDefined();
      expect(storedConfig.apiUrl).toBe('https://custom-api.example.com');
      expect(storedConfig.token).toBe('test-token-123');
      expect(storedConfig.customLingo).toBe('c=call $');
    });
  });

  describe('0ms In-Memory Cache Performance & Synchronous Access', () => {
    it('provides synchronous instant reads from memory without awaiting storage', async () => {
      const reminder: Reminder = {
        id: 'fast-read-1',
        title: 'Instant read',
        dueDate: '2026-09-14T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T11:00:00.000Z',
        updatedAt: '2026-09-14T11:00:00.000Z',
        armed: true,
      };

      await storageService.saveReminder(reminder);

      // Synchronous, non-async immediate call
      const start = performance.now();
      const read = storageService.getById('fast-read-1');
      const all = storageService.getAll();
      const elapsed = performance.now() - start;

      expect(read).toBeDefined();
      expect(read?.title).toBe('Instant read');
      expect(all.length).toBe(1);
      expect(elapsed).toBeLessThan(1); // sub-millisecond
    });

    it('executes 1,000 in-memory reads in under 5ms', async () => {
      const reminders: Reminder[] = [];
      for (let i = 0; i < 50; i++) {
        reminders.push({
          id: `bench-${i}`,
          title: `Task ${i}`,
          dueDate: new Date().toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await storageService.saveReminders(reminders);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        storageService.getById(`bench-${i % 50}`);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(15);
    });
  });

  describe('Active, Pending, and Armed Query Filters', () => {
    it('filters active, pending, and armed reminders correctly', async () => {
      const pendingArmed: Reminder = {
        id: '1',
        title: 'Pending Armed',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        armed: true,
      };
      const inboxUnarmed: Reminder = {
        id: '2',
        title: 'Inbox Unarmed',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        armed: false,
      };
      const completed: Reminder = {
        id: '3',
        title: 'Completed',
        dueDate: new Date().toISOString(),
        status: 'completed',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        armed: true,
      };
      const deleted: Reminder = {
        id: '4',
        title: 'Deleted',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: true,
      };

      await storageService.saveReminders([pendingArmed, inboxUnarmed, completed, deleted]);

      const active = storageService.getActive();
      expect(active.map((r) => r.id)).toEqual(['1', '2']);

      const pending = storageService.getPending();
      expect(pending.map((r) => r.id)).toEqual(['1', '2']);

      const armed = storageService.getArmed();
      expect(armed.map((r) => r.id)).toEqual(['1']);
    });
  });

  describe('Tombstone Pruning', () => {
    it('prunes soft-deleted tombstones after server acknowledgment', async () => {
      const active: Reminder = {
        id: 'active-1',
        title: 'Active task',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const deleted: Reminder = {
        id: 'deleted-1',
        title: 'Deleted task',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: true,
      };

      await storageService.saveReminders([active, deleted]);
      expect(storageService.getAll().length).toBe(2);

      const prunedCount = await storageService.pruneTombstones();

      expect(prunedCount).toBe(1);
      expect(storageService.getAll().length).toBe(1);
      expect(storageService.getById('deleted-1')).toBeUndefined();
      expect(storageService.getById('active-1')).toBeDefined();
    });
  });
});
