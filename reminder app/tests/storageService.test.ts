import { StorageService, STORAGE_KEY, STORAGE_VERSION, StorageEnvelope } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

// Register mock for @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockAsyncStorage.__reset();
    service = new StorageService();
    await service.init();
  });

  describe('Hydration & Initialization', () => {
    it('initializes with an empty cache when storage is empty', () => {
      expect(service.isReady()).toBe(true);
      expect(service.getAll()).toEqual([]);
    });

    it('hydrates existing reminders from envelope format', async () => {
      const storedReminder: Reminder = {
        id: 'rem-1',
        title: 'Hydrated Task',
        notes: 'Some notes',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        lastSnoozedAt: null,
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
        completedAt: null,
        notificationId: 'notif-123',
      };

      const envelope: StorageEnvelope = {
        version: STORAGE_VERSION,
        reminders: [storedReminder],
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.isReady()).toBe(true);
      expect(freshService.getAll().length).toBe(1);
      expect(freshService.getById('rem-1')).toEqual(storedReminder);
    });

    it('hydrates legacy flat-array JSON format gracefully', async () => {
      const legacyReminder: Reminder = {
        id: 'legacy-1',
        title: 'Legacy Reminder',
        notes: null,
        dueDate: '2026-09-11T09:00:00.000Z',
        status: 'pending',
        snoozeCount: 1,
        lastSnoozedAt: '2026-09-10T09:00:00.000Z',
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T09:00:00.000Z',
        completedAt: null,
        notificationId: null,
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify([legacyReminder]));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getAll().length).toBe(1);
      expect(freshService.getById('legacy-1')?.title).toBe('Legacy Reminder');
    });

    it('recovers gracefully from malformed or corrupted storage JSON', async () => {
      mockAsyncStorage.__setRaw(STORAGE_KEY, '{ corrupt-json-string ::: }');

      const freshService = new StorageService();
      await expect(freshService.init()).resolves.not.toThrow();

      expect(freshService.isReady()).toBe(true);
      expect(freshService.getAll()).toEqual([]);
    });

    it('coalesces concurrent init calls to avoid duplicate reads', async () => {
      mockAsyncStorage.getItem.mockClear();
      const freshService = new StorageService();
      const [init1, init2, init3] = [freshService.init(), freshService.init(), freshService.init()];

      await Promise.all([init1, init2, init3]);

      // Only one AsyncStorage.getItem call should have executed
      expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(1);
    });

    it('hydrates valid reminders and skips corrupted dueDate record without wiping cache', async () => {
      const goodReminder1: Reminder = {
        id: 'good-1',
        title: 'Valid Reminder 1',
        notes: 'Preserved note 1',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        lastSnoozedAt: null,
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
        completedAt: null,
        notificationId: null,
      };

      const corruptReminder = {
        id: 'bad-due-date',
        title: 'Corrupted Date Reminder',
        dueDate: 'invalid-iso-date-string',
        status: 'pending',
      };

      const goodReminder2: Reminder = {
        id: 'good-2',
        title: 'Valid Reminder 2',
        notes: 'Preserved note 2',
        dueDate: '2026-09-15T14:00:00.000Z',
        status: 'snoozed',
        snoozeCount: 1,
        lastSnoozedAt: '2026-09-10T13:00:00.000Z',
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T13:00:00.000Z',
        completedAt: null,
        notificationId: null,
      };

      const envelope = {
        version: STORAGE_VERSION,
        reminders: [goodReminder1, corruptReminder, goodReminder2],
        updatedAt: '2026-09-10T13:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.isReady()).toBe(true);
      expect(freshService.getAll().length).toBe(2);
      expect(freshService.getById('good-1')?.title).toBe('Valid Reminder 1');
      expect(freshService.getById('good-2')?.title).toBe('Valid Reminder 2');
      expect(freshService.getById('bad-due-date')).toBeUndefined();
    });

    it('defaults corrupted optional date fields (lastSnoozedAt, completedAt) to null instead of dropping reminder', async () => {
      const reminderWithCorruptDates = {
        id: 'corrupt-optional-dates',
        title: 'Reminder With Corrupt Optional Dates',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'snoozed',
        snoozeCount: 1,
        lastSnoozedAt: 'not-a-valid-snooze-date',
        completedAt: 'not-a-valid-completed-date',
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      const envelope = {
        version: STORAGE_VERSION,
        reminders: [reminderWithCorruptDates],
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getAll().length).toBe(1);
      const hydrated = freshService.getById('corrupt-optional-dates');
      expect(hydrated).toBeDefined();
      expect(hydrated?.title).toBe('Reminder With Corrupt Optional Dates');
      expect(hydrated?.lastSnoozedAt).toBeNull();
      expect(hydrated?.completedAt).toBeNull();
    });

    it('defaults corrupted audit date fields (createdAt, updatedAt) to valid ISO timestamp', async () => {
      const reminderWithCorruptAudit = {
        id: 'corrupt-audit-dates',
        title: 'Reminder With Corrupt Audit Dates',
        dueDate: '2026-09-15T10:00:00.000Z',
        createdAt: 'unparseable-created-timestamp',
        updatedAt: 'unparseable-updated-timestamp',
      };

      const envelope = {
        version: STORAGE_VERSION,
        reminders: [reminderWithCorruptAudit],
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getAll().length).toBe(1);
      const hydrated = freshService.getById('corrupt-audit-dates');
      expect(hydrated).toBeDefined();
      expect(isNaN(new Date(hydrated!.createdAt).getTime())).toBe(false);
      expect(isNaN(new Date(hydrated!.updatedAt).getTime())).toBe(false);
    });

    it('isolates unexpected per-item runtime exceptions so remaining items hydrate successfully', async () => {
      const throwingItem = {
        get id() {
          throw new Error('Getter explosion on item id');
        },
        title: 'Exploding Item',
        dueDate: '2026-09-15T10:00:00.000Z',
      };

      const goodItem: Reminder = {
        id: 'survivor-1',
        title: 'Surviving Reminder',
        notes: 'Safe',
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        lastSnoozedAt: null,
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
        completedAt: null,
        notificationId: null,
      };

      const envelope = {
        version: STORAGE_VERSION,
        reminders: [goodItem],
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const origParse = JSON.parse;
      const parseSpy = jest.spyOn(JSON, 'parse').mockImplementationOnce((str: string) => {
        const result = origParse(str);
        result.reminders.unshift(throwingItem);
        return result;
      });

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getAll().length).toBe(1);
      expect(freshService.getById('survivor-1')).toBeDefined();

      parseSpy.mockRestore();
    });

    it('preserves notes whitespace and formatting across hydration cycle', async () => {
      const rawNotes = '  Swiss Design Manifesto:\n  - Clean typography\n  - High contrast  ';
      const reminder: Reminder = {
        id: 'hydration-notes-test',
        title: 'Hydration Notes',
        notes: rawNotes,
        dueDate: '2026-09-15T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        lastSnoozedAt: null,
        createdAt: '2026-09-10T12:00:00.000Z',
        updatedAt: '2026-09-10T12:00:00.000Z',
        completedAt: null,
        notificationId: null,
      };

      const envelope = {
        version: STORAGE_VERSION,
        reminders: [reminder],
        updatedAt: '2026-09-10T12:00:00.000Z',
      };

      mockAsyncStorage.__setRaw(STORAGE_KEY, JSON.stringify(envelope));

      const freshService = new StorageService();
      await freshService.init();

      expect(freshService.getById('hydration-notes-test')?.notes).toBe(rawNotes);
    });
  });

  describe('Synchronous 0ms Reads', () => {
    let r1: Reminder;
    let r2: Reminder;
    let r3: Reminder;

    beforeEach(async () => {
      r1 = await service.create({
        title: 'Task 1 (Early)',
        dueDate: '2026-09-11T08:00:00.000Z',
      });
      r2 = await service.create({
        title: 'Task 2 (Late)',
        dueDate: '2026-09-11T18:00:00.000Z',
      });
      r3 = await service.create({
        title: 'Task 3 (Mid)',
        dueDate: '2026-09-11T12:00:00.000Z',
      });
    });

    it('getAll() returns all reminders sorted by dueDate ascending', () => {
      const all = service.getAll();
      expect(all.length).toBe(3);
      expect(all[0].id).toBe(r1.id);
      expect(all[1].id).toBe(r3.id);
      expect(all[2].id).toBe(r2.id);
    });

    it('getAll() returns defensive copies preventing internal cache mutation', () => {
      const all = service.getAll();
      all[0].title = 'Mutated Externally';

      const freshFetch = service.getById(all[0].id);
      expect(freshFetch?.title).toBe('Task 1 (Early)');
    });

    it('getById() returns item if present and undefined if missing', () => {
      expect(service.getById(r2.id)?.title).toBe('Task 2 (Late)');
      expect(service.getById('non-existent-id')).toBeUndefined();
    });

    it('getPending() returns only reminders with pending status', async () => {
      await service.snooze(r3.id, new Date('2026-09-11T14:00:00.000Z'));
      await service.toggleComplete(r2.id);

      const pending = service.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(r1.id);
    });

    it('getSnoozed() returns only reminders with snoozed status', async () => {
      await service.snooze(r3.id, new Date('2026-09-11T14:00:00.000Z'));

      const snoozed = service.getSnoozed();
      expect(snoozed.length).toBe(1);
      expect(snoozed[0].id).toBe(r3.id);
      expect(snoozed[0].status).toBe('snoozed');
    });

    it('getCompleted() returns completed reminders sorted by completedAt descending', async () => {
      await service.toggleComplete(r1.id);
      // Small artificial delay to ensure distinct completedAt timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.toggleComplete(r2.id);

      const completed = service.getCompleted();
      expect(completed.length).toBe(2);
      expect(completed[0].id).toBe(r2.id); // More recently completed first
      expect(completed[1].id).toBe(r1.id);
    });

    it('getActive() returns both pending and snoozed reminders, excluding completed', async () => {
      await service.snooze(r3.id, new Date('2026-09-11T14:00:00.000Z'));
      await service.toggleComplete(r2.id);

      const active = service.getActive();
      expect(active.length).toBe(2);
      expect(active.map((r) => r.id)).toEqual([r1.id, r3.id]);
    });
  });

  describe('Creation (create)', () => {
    it('creates a reminder with valid fields and defaults', async () => {
      const created = await service.create({
        title: 'Read prospective memory papers',
        notes: 'Review Einstein and McDaniel',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      expect(created.id).toBeDefined();
      expect(created.title).toBe('Read prospective memory papers');
      expect(created.notes).toBe('Review Einstein and McDaniel');
      expect(created.dueDate).toBe('2026-09-12T10:00:00.000Z');
      expect(created.status).toBe('pending');
      expect(created.snoozeCount).toBe(0);
      expect(created.lastSnoozedAt).toBeNull();
      expect(created.completedAt).toBeNull();
      expect(created.notificationId).toBeNull();
      expect(created.armed).toBe(true);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Immediate synchronous read check (0ms)
      expect(service.getById(created.id)).toEqual(created);

      // Verify write-through persistence to AsyncStorage
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.reminders.length).toBe(1);
      expect(parsedEnvelope.reminders[0].id).toBe(created.id);
    });

    it('trims title whitespace but preserves notes leading/trailing whitespace and multi-line formatting', async () => {
      const multiLineNotes = '  Line 1: Indented Swiss header\n    Line 2: Nested tabular spec\n  Line 3: Trailing space   ';
      const created = await service.create({
        title: '   Trimmed Title Task   ',
        notes: multiLineNotes,
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      expect(created.title).toBe('Trimmed Title Task');
      expect(created.notes).toBe(multiLineNotes);

      const fetched = service.getById(created.id);
      expect(fetched?.title).toBe('Trimmed Title Task');
      expect(fetched?.notes).toBe(multiLineNotes);
    });

    it('preserves whitespace-only notes verbatim without converting to null', async () => {
      const whitespaceNotes = '   \t  \n  ';
      const created = await service.create({
        title: 'Task With Whitespace Notes',
        notes: whitespaceNotes,
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      expect(created.title).toBe('Task With Whitespace Notes');
      expect(created.notes).toBe(whitespaceNotes);
    });

    it('treats null or undefined notes as null without error', async () => {
      const createdNull = await service.create({
        title: 'Null Notes Task',
        notes: null,
        dueDate: '2026-09-12T10:00:00.000Z',
      });
      expect(createdNull.notes).toBeNull();

      const createdUndefined = await service.create({
        title: 'Undefined Notes Task',
        dueDate: '2026-09-12T10:00:00.000Z',
      });
      expect(createdUndefined.notes).toBeNull();
    });

    it('throws when title is empty or only whitespace', async () => {
      await expect(
        service.create({
          title: '   ',
          dueDate: '2026-09-12T10:00:00.000Z',
        })
      ).rejects.toThrow('Reminder title cannot be empty');
    });

    it('throws when title exceeds 255 characters', async () => {
      const longTitle = 'a'.repeat(256);
      await expect(
        service.create({
          title: longTitle,
          dueDate: '2026-09-12T10:00:00.000Z',
        })
      ).rejects.toThrow('Reminder title cannot exceed 255 characters');
    });

    it('throws when dueDate is not a valid ISO date', async () => {
      await expect(
        service.create({
          title: 'Valid Title',
          dueDate: 'not-a-valid-date',
        })
      ).rejects.toThrow(/Invalid dueDate/);
    });
  });

  describe('Updating (update)', () => {
    it('updates title, notes, and dueDate', async () => {
      const created = await service.create({
        title: 'Original Title',
        notes: 'Original Notes',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const updated = await service.update(created.id, {
        title: 'Updated Title',
        notes: 'Updated Notes',
        dueDate: '2026-09-13T12:00:00.000Z',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.notes).toBe('Updated Notes');
      expect(updated.dueDate).toBe('2026-09-13T12:00:00.000Z');
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

      // Confirm cache is updated
      expect(service.getById(created.id)?.title).toBe('Updated Title');
    });

    it('throws error when updating non-existent reminder', async () => {
      await expect(
        service.update('non-existent', { title: 'New Title' })
      ).rejects.toThrow(/not found/);
    });

    it('throws error when updated title is empty', async () => {
      const created = await service.create({
        title: 'Valid',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      await expect(
        service.update(created.id, { title: '   ' })
      ).rejects.toThrow('Reminder title cannot be empty');
    });

    it('populates completedAt when transitioning status to completed via update', async () => {
      const created = await service.create({
        title: 'Task',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const updated = await service.update(created.id, { status: 'completed' });
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).not.toBeNull();

      const reverted = await service.update(created.id, { status: 'pending' });
      expect(reverted.status).toBe('pending');
      expect(reverted.completedAt).toBeNull();
    });

    it('preserves notes whitespace on update and allows resetting notes to null', async () => {
      const created = await service.create({
        title: 'Initial Title',
        notes: 'Initial Note',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const updatedNotes = '  Updated Note with Leading Space  ';
      const updated = await service.update(created.id, {
        notes: updatedNotes,
      });
      expect(updated.notes).toBe(updatedNotes);

      const cleared = await service.update(created.id, {
        notes: null,
      });
      expect(cleared.notes).toBeNull();
    });
  });

  describe('Snooze (snooze)', () => {
    it('snoozes a reminder, increments snoozeCount, and updates lastSnoozedAt', async () => {
      const created = await service.create({
        title: 'Morning medication',
        dueDate: '2026-09-11T08:00:00.000Z',
      });

      const target = new Date('2026-09-11T09:00:00.000Z');
      const snoozed = await service.snooze(created.id, target, '1h');

      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozeCount).toBe(1);
      expect(snoozed.dueDate).toBe(target.toISOString());
      expect(snoozed.lastSnoozedAt).toBeDefined();

      // Snooze a second time
      const target2 = new Date('2026-09-11T10:00:00.000Z');
      const snoozed2 = await service.snooze(created.id, target2, '1h');

      expect(snoozed2.snoozeCount).toBe(2);
      expect(snoozed2.dueDate).toBe(target2.toISOString());
    });

    it('throws error when snoozing non-existent reminder', async () => {
      await expect(
        service.snooze('missing-id', new Date())
      ).rejects.toThrow(/not found/);
    });

    it('throws error when targetDate is invalid Date', async () => {
      const created = await service.create({
        title: 'Valid',
        dueDate: '2026-09-11T08:00:00.000Z',
      });

      await expect(
        service.snooze(created.id, new Date('invalid-date'))
      ).rejects.toThrow(/Invalid targetDate/);
    });
  });

  describe('Toggle Complete (toggleComplete)', () => {
    it('toggles pending to completed and clears notificationId', async () => {
      const created = await service.create({
        title: 'Submit quarterly taxes',
        dueDate: '2026-09-15T15:00:00.000Z',
      });
      await service.setNotificationId(created.id, 'notif-999');

      const completed = await service.toggleComplete(created.id);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).not.toBeNull();
      expect(completed.notificationId).toBeNull();

      // Toggle back to pending
      const uncompleted = await service.toggleComplete(created.id);
      expect(uncompleted.status).toBe('pending');
      expect(uncompleted.completedAt).toBeNull();
    });

    it('toggles snoozed to completed', async () => {
      const created = await service.create({
        title: 'Call dentist',
        dueDate: '2026-09-11T09:00:00.000Z',
      });
      await service.snooze(created.id, new Date('2026-09-11T10:00:00.000Z'));

      const completed = await service.toggleComplete(created.id);
      expect(completed.status).toBe('completed');
    });

    it('throws error when toggling non-existent reminder', async () => {
      await expect(service.toggleComplete('non-existent')).rejects.toThrow(/not found/);
    });
  });

  describe('Inbox arming', () => {
    it('persists unarmed dumps and arms them on snooze', async () => {
      const created = await service.create({
        title: 'call mom',
        dueDate: new Date().toISOString(),
        armed: false,
      });
      expect(created.armed).toBe(false);

      const snoozed = await service.snooze(created.id, new Date(Date.now() + 15 * 60 * 1000));
      expect(snoozed.armed).toBe(true);
      expect(snoozed.status).toBe('snoozed');
    });
  });

  describe('Notification ID Management (setNotificationId)', () => {
    it('sets and updates notificationId', async () => {
      const created = await service.create({
        title: 'Task with alert',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const updated = await service.setNotificationId(created.id, 'expo-alert-42');
      expect(updated.notificationId).toBe('expo-alert-42');
      expect(service.getById(created.id)?.notificationId).toBe('expo-alert-42');

      const cleared = await service.setNotificationId(created.id, null);
      expect(cleared.notificationId).toBeNull();
    });
  });

  describe('Deletion (delete)', () => {
    it('deletes an existing reminder and returns true', async () => {
      const created = await service.create({
        title: 'Trash Task',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const deleted = await service.delete(created.id);
      expect(deleted).toBe(true);
      expect(service.getById(created.id)).toBeUndefined();
      expect(service.getAll().length).toBe(0);

      // Soft-delete tombstone is persisted so cloud sync can propagate the delete
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.reminders.length).toBe(1);
      expect(parsedEnvelope.reminders[0].id).toBe(created.id);
      expect(parsedEnvelope.reminders[0].isDeleted).toBe(true);
      expect(service.getAllForSync()[0].isDeleted).toBe(true);
    });

    it('returns false when attempting to delete non-existent ID', async () => {
      const deleted = await service.delete('missing-id');
      expect(deleted).toBe(false);
    });
  });

  describe('Reconciliation (reconcileActiveReminders)', () => {
    it('returns all active reminders and excludes completed items', async () => {
      const r1 = await service.create({ title: 'Active 1', dueDate: '2026-09-11T10:00:00.000Z' });
      const r2 = await service.create({ title: 'Active 2', dueDate: '2026-09-11T11:00:00.000Z' });
      const r3 = await service.create({ title: 'Done', dueDate: '2026-09-11T12:00:00.000Z' });

      await service.snooze(r2.id, new Date('2026-09-11T14:00:00.000Z'));
      await service.toggleComplete(r3.id);

      const active = await service.reconcileActiveReminders();
      expect(active.length).toBe(2);
      expect(active.map((r) => r.id)).toEqual([r1.id, r2.id]);
    });
  });

  describe('Reactivity & Subscriptions', () => {
    it('synchronously notifies subscribers on create, update, snooze, toggle, and delete', async () => {
      const listener = jest.fn();
      const unsubscribe = service.subscribe(listener);

      const created = await service.create({
        title: 'Reactive Task',
        dueDate: '2026-09-12T10:00:00.000Z',
      });
      expect(listener).toHaveBeenCalledTimes(1);

      await service.update(created.id, { title: 'Updated Title' });
      expect(listener).toHaveBeenCalledTimes(2);

      await service.snooze(created.id, new Date('2026-09-12T12:00:00.000Z'));
      expect(listener).toHaveBeenCalledTimes(3);

      await service.toggleComplete(created.id);
      expect(listener).toHaveBeenCalledTimes(4);

      await service.delete(created.id);
      expect(listener).toHaveBeenCalledTimes(5);

      unsubscribe();
      await service.create({
        title: 'After Unsubscribe',
        dueDate: '2026-09-12T10:00:00.000Z',
      });
      // Listener should not receive further calls
      expect(listener).toHaveBeenCalledTimes(5);
    });

    it('safely handles errors thrown inside subscriber callbacks without breaking service', async () => {
      const faultyListener = jest.fn(() => {
        throw new Error('Subscriber error');
      });
      service.subscribe(faultyListener);

      await expect(
        service.create({
          title: 'Fault Tolerant',
          dueDate: '2026-09-12T10:00:00.000Z',
        })
      ).resolves.toBeDefined();
    });
  });

  describe('Write-Through Concurrency & Race Condition Elimination', () => {
    it('handles multiple rapid concurrent mutations sequentially without data corruption', async () => {
      const created = await service.create({
        title: 'Initial',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      // Fire 5 rapid concurrent updates without awaiting between them
      const p1 = service.update(created.id, { title: 'Update 1' });
      const p2 = service.update(created.id, { title: 'Update 2' });
      const p3 = service.update(created.id, { title: 'Update 3' });
      const p4 = service.update(created.id, { title: 'Update 4' });
      const p5 = service.update(created.id, { title: 'Final Update' });

      await Promise.all([p1, p2, p3, p4, p5]);

      expect(service.getById(created.id)?.title).toBe('Final Update');

      // Verify that disk storage contains the final state
      const rawStored = mockAsyncStorage.__getRaw(STORAGE_KEY);
      const envelope = JSON.parse(rawStored!);
      expect(envelope.reminders[0].title).toBe('Final Update');
    });

    it('recovers from transient AsyncStorage failure and persists subsequent mutations', async () => {
      let failNext = true;
      const origSetItem = mockAsyncStorage.setItem;
      mockAsyncStorage.setItem = jest.fn(async (key: string, val: string) => {
        if (failNext) {
          failNext = false;
          throw new Error('Simulated transient disk error');
        }
        return origSetItem(key, val);
      });

      await expect(
        service.create({ title: 'Task with error', dueDate: '2026-09-12T10:00:00.000Z' })
      ).rejects.toThrow('Simulated transient disk error');

      // Next mutation must succeed
      const successful = await service.create({
        title: 'Task after recovery',
        dueDate: '2026-09-12T11:00:00.000Z',
      });
      expect(successful.title).toBe('Task after recovery');
      expect(service.getAll().length).toBe(2);

      mockAsyncStorage.setItem = origSetItem;
    });
  });

  describe('Automatic Hydration on Mutation (Uninitialized Invariant)', () => {
    beforeEach(() => {
      const seed: Reminder = {
        id: 'seed-task-1',
        title: 'Seed Task',
        dueDate: '2026-09-20T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-10T10:00:00.000Z',
        updatedAt: '2026-09-10T10:00:00.000Z',
      };
      mockAsyncStorage.__setRaw(
        STORAGE_KEY,
        JSON.stringify({ version: 1, reminders: [seed], updatedAt: '2026-09-10T10:00:00.000Z' })
      );
    });

    it('update() on uninitialized service hydrates and updates reminder without data loss', async () => {
      const uninit = new StorageService();
      const updated = await uninit.update('seed-task-1', { title: 'Updated Title' });
      expect(updated.title).toBe('Updated Title');
      expect(uninit.isReady()).toBe(true);
      expect(uninit.getAll().length).toBe(1);
    });

    it('snooze() on uninitialized service hydrates and snoozes reminder', async () => {
      const uninit = new StorageService();
      const targetDate = new Date('2026-09-21T10:00:00.000Z');
      const snoozed = await uninit.snooze('seed-task-1', targetDate);
      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozeCount).toBe(1);
    });

    it('toggleComplete() on uninitialized service hydrates and toggles reminder', async () => {
      const uninit = new StorageService();
      const toggled = await uninit.toggleComplete('seed-task-1');
      expect(toggled.status).toBe('completed');
    });

    it('delete() on uninitialized service hydrates and deletes reminder', async () => {
      const uninit = new StorageService();
      const deleted = await uninit.delete('seed-task-1');
      expect(deleted).toBe(true);
      expect(uninit.getAll().length).toBe(0);
    });

    it('reconcileActiveReminders() on uninitialized service hydrates and returns active items', async () => {
      const uninit = new StorageService();
      const active = await uninit.reconcileActiveReminders();
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('seed-task-1');
    });
  });

  describe('Cloud sync helpers (tombstones + LWW)', () => {
    it('applyRemoteSync inserts, updates by LWW, and honors newer local writes', async () => {
      const local = await service.create({
        title: 'Local',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      const changed = await service.applyRemoteSync([
        {
          ...local,
          title: 'From server',
          updatedAt: new Date(Date.parse(local.updatedAt) + 5000).toISOString(),
        },
      ]);
      expect(changed).toBe(true);
      expect(service.getById(local.id)?.title).toBe('From server');

      const afterLocalEdit = await service.update(local.id, { title: 'Local again' });
      const ignored = await service.applyRemoteSync([
        {
          ...afterLocalEdit,
          title: 'Stale server',
          updatedAt: new Date(Date.parse(afterLocalEdit.updatedAt) - 5000).toISOString(),
        },
      ]);
      expect(ignored).toBe(false);
      expect(service.getById(local.id)?.title).toBe('Local again');
    });

    it('applyRemoteSync applies remote tombstones and pruneSyncedTombstones drops local deletes after upload', async () => {
      const created = await service.create({
        title: 'To delete remotely',
        dueDate: '2026-09-12T10:00:00.000Z',
      });

      await service.applyRemoteSync([
        {
          ...created,
          isDeleted: true,
          updatedAt: new Date(Date.parse(created.updatedAt) + 1000).toISOString(),
        },
      ]);
      expect(service.getById(created.id)).toBeUndefined();
      expect(service.getAllForSync().find((r) => r.id === created.id)).toBeUndefined();

      const local = await service.create({
        title: 'Local delete',
        dueDate: '2026-09-12T11:00:00.000Z',
      });
      await service.delete(local.id);
      expect(service.getAllForSync().find((r) => r.id === local.id)?.isDeleted).toBe(true);

      await service.pruneSyncedTombstones();
      expect(service.getAllForSync().find((r) => r.id === local.id)).toBeUndefined();
    });

    it('applyRemoteSync does not notify mutation listeners', async () => {
      const mutation = jest.fn();
      service.onMutation(mutation);
      await service.applyRemoteSync([
        {
          id: 'remote-1',
          title: 'Remote insert',
          notes: null,
          dueDate: '2026-09-12T10:00:00.000Z',
          status: 'pending',
          snoozeCount: 0,
          lastSnoozedAt: null,
          createdAt: '2026-09-12T09:00:00.000Z',
          updatedAt: '2026-09-12T09:00:00.000Z',
          completedAt: null,
        },
      ]);
      expect(mutation).not.toHaveBeenCalled();
      expect(service.getById('remote-1')?.title).toBe('Remote insert');
    });
  });

  describe('Clear (clear)', () => {
    it('clears in-memory cache and removes key from AsyncStorage', async () => {
      await service.create({ title: 'T1', dueDate: '2026-09-12T10:00:00.000Z' });
      await service.create({ title: 'T2', dueDate: '2026-09-12T11:00:00.000Z' });
      expect(service.getAll().length).toBe(2);

      await service.clear();

      expect(service.getAll().length).toBe(0);
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
      expect(mockAsyncStorage.__getRaw(STORAGE_KEY)).toBeNull();
    });
  });
});
