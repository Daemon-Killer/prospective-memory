import { StorageService, STORAGE_KEY, STORAGE_VERSION, StorageEnvelope } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

describe('StorageService Empirical Stress & Adversarial Challenge Suite', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockAsyncStorage.__reset();
    service = new StorageService();
    await service.init();
  });

  // =========================================================================
  // Section 1: High-Concurrency Operations (100 Simultaneous Operations)
  // =========================================================================
  describe('1. High-Concurrency Stress Testing (100 Simultaneous Operations)', () => {
    it('handles 100 simultaneous create operations without loss, corruption, or unhandled rejection', async () => {
      const COUNT = 100;
      const startTime = Date.now();

      // Launch 100 simultaneous creations
      const promises = Array.from({ length: COUNT }, (_, i) =>
        service.create({
          title: `Concurrent Reminder #${i + 1}`,
          notes: `Notes for reminder ${i + 1}`,
          dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
        })
      );

      const results = await Promise.all(promises);
      const elapsedMs = Date.now() - startTime;

      // 1. All 100 promises resolved
      expect(results.length).toBe(COUNT);

      // 2. In-memory cache contains exactly 100 items
      const allCached = service.getAll();
      expect(allCached.length).toBe(COUNT);

      // 3. Every ID is unique
      const ids = new Set(allCached.map((r) => r.id));
      expect(ids.size).toBe(COUNT);

      // 4. In-memory cache consistency vs disk state
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const envelope: StorageEnvelope = JSON.parse(rawStored!);
      expect(envelope.version).toBe(STORAGE_VERSION);
      expect(envelope.reminders.length).toBe(COUNT);

      // Verify every reminder created is present on disk with identical data
      const diskMap = new Map(envelope.reminders.map((r) => [r.id, r]));
      for (const item of allCached) {
        const diskItem = diskMap.get(item.id);
        expect(diskItem).toBeDefined();
        expect(diskItem?.title).toBe(item.title);
        expect(diskItem?.dueDate).toBe(item.dueDate);
        expect(diskItem?.status).toBe('pending');
      }

      console.log(`[PASS] 100 simultaneous creates completed in ${elapsedMs}ms`);
    });

    it('handles 100 simultaneous mixed mutations (create, snooze, toggle, update, delete)', async () => {
      // Pre-populate 40 reminders
      const initialReminders: Reminder[] = [];
      for (let i = 0; i < 40; i++) {
        const r = await service.create({
          title: `Seed Task ${i}`,
          dueDate: new Date(Date.now() + (i + 10) * 60000).toISOString(),
        });
        initialReminders.push(r);
      }

      expect(service.getAll().length).toBe(40);

      // Prepare 100 concurrent operations:
      // - 20 snoozes on seed tasks 0..19
      // - 20 toggles on seed tasks 10..29
      // - 20 updates on seed tasks 20..39
      // - 20 deletes (10 existing seed tasks 30..39, 10 non-existent tasks)
      // - 20 new creates
      const mutationPromises: Promise<any>[] = [];

      // 20 Snoozes
      for (let i = 0; i < 20; i++) {
        const targetDate = new Date(Date.now() + (i + 100) * 60000);
        mutationPromises.push(service.snooze(initialReminders[i].id, targetDate, '1h'));
      }

      // 20 Toggles
      for (let i = 10; i < 30; i++) {
        mutationPromises.push(service.toggleComplete(initialReminders[i].id));
      }

      // 20 Updates
      for (let i = 20; i < 40; i++) {
        mutationPromises.push(service.update(initialReminders[i].id, { title: `Updated Title ${i}` }));
      }

      // 20 Deletes (10 existing seed tasks 30..39, 10 non-existent IDs)
      for (let i = 30; i < 40; i++) {
        mutationPromises.push(service.delete(initialReminders[i].id));
      }
      for (let i = 0; i < 10; i++) {
        mutationPromises.push(service.delete(`non-existent-${i}`));
      }

      // 20 New creates
      for (let i = 0; i < 20; i++) {
        mutationPromises.push(
          service.create({
            title: `Concurrent New Task ${i}`,
            dueDate: new Date(Date.now() + (i + 50) * 60000).toISOString(),
          })
        );
      }

      expect(mutationPromises.length).toBe(100);

      // Execute all 100 simultaneously
      const results = await Promise.all(mutationPromises);
      expect(results.length).toBe(100);

      // Verify Cache vs Disk Consistency
      const inMemoryReminders = service.getAll();
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const envelope: StorageEnvelope = JSON.parse(rawStored!);

      const liveOnDisk = envelope.reminders.filter((r) => !r.isDeleted);
      expect(liveOnDisk.length).toBe(inMemoryReminders.length);

      const diskMap = new Map(envelope.reminders.map((r) => [r.id, r]));
      for (const item of inMemoryReminders) {
        const diskItem = diskMap.get(item.id);
        expect(diskItem).toBeDefined();
        expect(diskItem).toEqual(item);
      }

      // Deleted seed tasks stay as tombstones on disk but vanish from live reads
      for (let i = 30; i < 40; i++) {
        const deletedId = initialReminders[i].id;
        expect(service.getById(deletedId)).toBeUndefined();
        expect(diskMap.get(deletedId)?.isDeleted).toBe(true);
      }
    });

    it('handles 100 simultaneous concurrent operations on a single reminder without state corruption', async () => {
      const initial = await service.create({
        title: 'High Contention Reminder',
        dueDate: '2026-09-15T12:00:00.000Z',
      });

      // Launch 100 alternating snooze and update operations on the exact same reminder
      const ops: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        ops.push(service.snooze(initial.id, new Date(Date.now() + (i + 1) * 3600000), '1h'));
        ops.push(service.update(initial.id, { notes: `Contention note step ${i}` }));
      }

      await Promise.all(ops);

      const finalItem = service.getById(initial.id);
      expect(finalItem).toBeDefined();
      expect(finalItem?.snoozeCount).toBe(50);
      expect(finalItem?.status).toBe('snoozed');

      // Verify disk state exactly matches cache
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope: StorageEnvelope = JSON.parse(rawStored!);
      const diskItem = envelope.reminders.find((r) => r.id === initial.id);
      expect(diskItem).toEqual(finalItem);
    });
  });

  // =========================================================================
  // Section 2: In-Memory Cache Consistency vs Disk State Verification
  // =========================================================================
  describe('2. In-Memory Cache Consistency vs Disk State Verification', () => {
    it('verifies deep equality between in-memory cache and serialized disk state after multiple lifecycle phases', async () => {
      // Phase 1: Create 20 reminders
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const r = await service.create({
          title: `Phase Task ${i}`,
          dueDate: new Date(Date.now() + i * 10000).toISOString(),
          notes: i % 2 === 0 ? `Notes for ${i}` : undefined,
        });
        ids.push(r.id);
      }

      // Phase 2: Snooze half of them
      for (let i = 0; i < 10; i++) {
        await service.snooze(ids[i], new Date(Date.now() + (i + 50) * 10000), '15m');
      }

      // Phase 3: Complete a quarter of them
      for (let i = 5; i < 10; i++) {
        await service.toggleComplete(ids[i]);
      }

      // Phase 4: Delete 3 reminders
      await service.delete(ids[0]);
      await service.delete(ids[1]);
      await service.delete(ids[2]);

      // Deep compare in-memory cache vs disk
      const cached = service.getAll();
      const rawDisk = mockAsyncStorage.__getRaw(STORAGE_KEY);
      expect(rawDisk).not.toBeNull();
      const diskEnvelope: StorageEnvelope = JSON.parse(rawDisk!);

      expect(cached.length).toBe(17);
      expect(diskEnvelope.reminders.filter((r) => !r.isDeleted).length).toBe(17);
      expect(diskEnvelope.reminders.filter((r) => r.isDeleted).length).toBe(3);

      // Check each cached item exists on disk with exact equality
      const diskMap = new Map(diskEnvelope.reminders.map((r) => [r.id, r]));
      for (const item of cached) {
        expect(diskMap.get(item.id)).toEqual(item);
      }

      // Fresh service instance hydration check
      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getAll()).toEqual(cached);
      expect(freshService.getPending()).toEqual(service.getPending());
      expect(freshService.getSnoozed()).toEqual(service.getSnoozed());
      expect(freshService.getCompleted()).toEqual(service.getCompleted());
      expect(freshService.getActive()).toEqual(service.getActive());
    });

    it('guarantees defensive copies prevent external memory pollution of cache and disk', async () => {
      const created = await service.create({
        title: 'Original Title',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      // Attempt to mutate through getAll()
      const all = service.getAll();
      all[0].title = 'HAIRPIN MUTATION';
      all[0].snoozeCount = 9999;
      all[0].status = 'completed';

      expect(service.getById(created.id)?.title).toBe('Original Title');
      expect(service.getById(created.id)?.snoozeCount).toBe(0);
      expect(service.getById(created.id)?.status).toBe('pending');

      // Attempt to mutate through getById()
      const fetched = service.getById(created.id)!;
      fetched.title = 'ANOTHER MUTATION';

      expect(service.getById(created.id)?.title).toBe('Original Title');

      // Disk state must remain completely uncorrupted
      const rawDisk = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const diskEnvelope: StorageEnvelope = JSON.parse(rawDisk!);
      expect(diskEnvelope.reminders[0].title).toBe('Original Title');
      expect(diskEnvelope.reminders[0].snoozeCount).toBe(0);
    });
  });

  // =========================================================================
  // Section 3: Corrupted JSON Disk Injection & Graceful Recovery
  // =========================================================================
  describe('3. Corrupted JSON Disk Injection & Graceful Recovery', () => {
    it('gracefully recovers from unparseable corrupted JSON string on disk and self-heals', async () => {
      mockAsyncStorage.__setRaw(STORAGE_KEY, '{ invalid JSON syntax [[[:::');

      const recoveryService = new StorageService();
      await expect(recoveryService.init()).resolves.not.toThrow();

      expect(recoveryService.isReady()).toBe(true);
      expect(recoveryService.getAll()).toEqual([]);

      // Ensure storage can heal itself on next write
      const healed = await recoveryService.create({
        title: 'Healing Reminder',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      expect(recoveryService.getAll().length).toBe(1);
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope: StorageEnvelope = JSON.parse(rawStored!);
      expect(envelope.reminders[0].id).toBe(healed.id);
      expect(envelope.reminders[0].title).toBe('Healing Reminder');
    });

    it('gracefully recovers when disk contains a primitive string or non-object JSON', async () => {
      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify('just a raw string'));

      const recoveryService = new StorageService();
      await recoveryService.init();

      expect(recoveryService.isReady()).toBe(true);
      expect(recoveryService.getAll()).toEqual([]);
    });

    it('gracefully recovers when disk envelope contains corrupted/incomplete reminder entries', async () => {
      const corruptEnvelope = {
        version: 1,
        reminders: [
          null,
          undefined,
          {},
          { id: 'only-id' },
          { title: 'no-id-or-date' },
          { id: 'no-due-date', title: 'Task' },
          {
            id: 'valid-recovered',
            title: 'Valid Intact Task',
            dueDate: '2026-09-15T12:00:00.000Z',
            status: 'pending',
          },
        ],
        updatedAt: new Date().toISOString(),
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(corruptEnvelope));

      const recoveryService = new StorageService();
      await recoveryService.init();

      expect(recoveryService.isReady()).toBe(true);
      // Only the single valid reminder should be loaded into cache
      const loaded = recoveryService.getAll();
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe('valid-recovered');
      expect(loaded[0].title).toBe('Valid Intact Task');
    });

    it('handles corrupted date strings in stored JSON without unhandled crash', async () => {
      const envelopeWithBadDate = {
        version: 1,
        reminders: [
          {
            id: 'bad-date-task',
            title: 'Bad Date',
            dueDate: 'not-a-valid-date',
          },
        ],
        updatedAt: new Date().toISOString(),
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelopeWithBadDate));

      const recoveryService = new StorageService();
      await expect(recoveryService.init()).resolves.not.toThrow();
      expect(recoveryService.isReady()).toBe(true);
      expect(recoveryService.getAll()).toEqual([]);
    });
  });

  // =========================================================================
  // Section 4: Memory Pressure Stress (Large Payloads)
  // =========================================================================
  describe('4. Memory Pressure Stress (Large Payloads)', () => {
    it('survives large payload volume: 300 reminders with 2KB notes (>700KB serialized envelope)', async () => {
      const COUNT = 300;
      const largeNote = 'M'.repeat(2048);

      const startTime = Date.now();
      const promises: Promise<any>[] = [];
      for (let i = 0; i < COUNT; i++) {
        promises.push(
          service.create({
            title: `Payload Task #${i}`,
            notes: largeNote,
            dueDate: new Date(Date.now() + (i + 1) * 60000).toISOString(),
          })
        );
      }

      await Promise.all(promises);
      const elapsedMs = Date.now() - startTime;

      expect(service.getAll().length).toBe(COUNT);

      const raw = mockAsyncStorage.__getRaw(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(raw!.length).toBeGreaterThan(600 * 1024);
      console.log(`[PASS] 300 large payload reminders (${raw!.length} bytes) persisted in ${elapsedMs}ms`);
    });
  });

  // =========================================================================
  // Section 5: Hardened Mitigations & Adversarial Resilience
  // =========================================================================
  describe('5. Hardened Mitigations & Adversarial Resilience', () => {
    it('Mitigation 1: Uninitialized mutations automatically hydrate and preserve pre-existing disk records', async () => {
      // 1. Seed disk with an existing reminder from a previous session
      const seedReminder: Reminder = {
        id: 'seed-historical',
        title: 'Historical Reminder',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-10T10:00:00.000Z',
        updatedAt: '2026-09-10T10:00:00.000Z',
      };
      mockAsyncStorage.__setRaw(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          reminders: [seedReminder],
          updatedAt: '2026-09-10T10:00:00.000Z',
        })
      );

      // 2. Instantiate new service, but do NOT call init()
      const uninitializedService = new StorageService();
      expect(uninitializedService.isReady()).toBe(false);

      // 3. Perform a mutation (create)
      const created = await uninitializedService.create({
        title: 'Created Without Init',
        dueDate: '2026-09-16T10:00:00.000Z',
      });

      // 4. Inspect disk: Historical reminder must be PRESERVED alongside newly created reminder
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope: StorageEnvelope = JSON.parse(rawStored!);

      const hasHistorical = envelope.reminders.some((r) => r.id === 'seed-historical');
      const hasNew = envelope.reminders.some((r) => r.id === created.id);

      expect(hasNew).toBe(true);
      expect(hasHistorical).toBe(true); // Confirmed preserved!
    });

    it('Mitigation 2: In-flight hydration race condition preserves concurrent cache entries and synchronizes disk', async () => {
      // 1. Seed disk with a pre-existing task
      const oldTask: Reminder = {
        id: 'old-seed',
        title: 'Old Seed Task',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-10T10:00:00.000Z',
        updatedAt: '2026-09-10T10:00:00.000Z',
      };
      mockAsyncStorage.__setRaw(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          reminders: [oldTask],
          updatedAt: '2026-09-10T10:00:00.000Z',
        })
      );

      const serviceInstance = new StorageService();

      // Simulate 30ms I/O latency on reading disk
      const originalGetItem = mockAsyncStorage.getItem;
      mockAsyncStorage.getItem = jest.fn(async (key: string) => {
        const result = await originalGetItem(key);
        await new Promise((resolve) => setTimeout(resolve, 30));
        return result;
      });

      // Start init()
      const pInit = serviceInstance.init();

      // While init() is awaiting disk I/O, trigger create()
      await new Promise((resolve) => setTimeout(resolve, 10));
      const pCreate = serviceInstance.create({
        title: 'Concurrent Create In Flight',
        dueDate: '2026-09-16T10:00:00.000Z',
      });

      const [_, createdItem] = await Promise.all([pInit, pCreate]);
      mockAsyncStorage.getItem = originalGetItem;

      // In-memory cache preserves createdItem
      const cachedItem = serviceInstance.getById(createdItem.id);
      expect(cachedItem).toBeDefined();
      expect(cachedItem?.title).toBe('Concurrent Create In Flight');

      // Pre-existing disk item is also present in cache
      expect(serviceInstance.getById('old-seed')).toBeDefined();

      // Disk envelope contains both items
      const rawDisk = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope = JSON.parse(rawDisk!);
      expect(envelope.reminders.some((r: any) => r.id === createdItem.id)).toBe(true);
      expect(envelope.reminders.some((r: any) => r.id === 'old-seed')).toBe(true);
    });

    it('Mitigation 3: Recovers gracefully from transient disk errors and persists subsequent writes without queue deadlock', async () => {
      const testService = new StorageService();
      await testService.init();

      // Force a single transient failure on setItem
      let shouldFail = true;
      const originalSetItem = mockAsyncStorage.setItem;
      mockAsyncStorage.setItem = jest.fn(async (key: string, val: string) => {
        if (shouldFail) {
          shouldFail = false; // Next write would succeed
          throw new Error('Transient I/O Error: Storage lock or quota');
        }
        return originalSetItem(key, val);
      });

      // 1. First write fails as expected
      await expect(
        testService.create({
          title: 'Failing Task 1',
          dueDate: '2026-09-15T10:00:00.000Z',
        })
      ).rejects.toThrow('Transient I/O Error');

      // 2. Second write must succeed since the transient error cleared.
      let recovered = false;
      try {
        await testService.create({
          title: 'Subsequent Task 2',
          dueDate: '2026-09-15T11:00:00.000Z',
        });
        recovered = true;
      } catch (e) {
        recovered = false;
      }

      // Verification: Queue recovered, both tasks are in cache and persisted
      expect(recovered).toBe(true);
      expect(testService.getAll().length).toBe(2);

      const rawDisk = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope = JSON.parse(rawDisk!);
      expect(envelope.reminders.length).toBe(2);

      mockAsyncStorage.setItem = originalSetItem;
    });
  });
});
