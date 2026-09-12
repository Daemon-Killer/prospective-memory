/**
 * Tier 1: Core Feature Coverage Test Suite
 * Minimum 5 tests per core feature across 5 features (25 tests total)
 */

import { describe, it, expect } from './harness/testFramework.ts';
import { createTestHarness } from './harness/testHarness.ts';
import { calculateSnoozeTime } from './harness/referenceDomain.ts';
import {
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  NOTIFICATION_CATEGORY,
} from './harness/types.ts';

export function registerTier1Tests() {
  describe('Tier 1 - Feature 1: Reminder Creation & Invariant Validation', () => {
    it('E2E-T1-CREAT-01: Standard reminder creation with title, notes, and future dueDate', async () => {
      const h = await createTestHarness('2026-09-10T10:00:00.000Z');
      const reminder = await h.repository.create({
        title: 'Review quarterly Swiss design spec',
        notes: 'Tabular typography and OLED high contrast',
        dueDate: '2026-09-10T15:00:00.000Z',
      });

      expect(reminder.id).toBeDefined();
      expect(reminder.title).toBe('Review quarterly Swiss design spec');
      expect(reminder.notes).toBe('Tabular typography and OLED high contrast');
      expect(reminder.dueDate).toBe('2026-09-10T15:00:00.000Z');
      expect(reminder.status).toBe('pending');
      expect(reminder.snoozeCount).toBe(0);
      expect(reminder.lastSnoozedAt).toBeNull();
      expect(reminder.completedAt).toBeNull();
      expect(reminder.createdAt).toBe('2026-09-10T10:00:00.000Z');
      expect(reminder.updatedAt).toBe('2026-09-10T10:00:00.000Z');
    });

    it('E2E-T1-CREAT-02: Minimal reminder creation (title only, null notes)', async () => {
      const h = await createTestHarness('2026-09-10T10:00:00.000Z');
      const reminder = await h.repository.create({
        title: 'Call dentist',
        dueDate: '2026-09-10T12:00:00.000Z',
      });

      expect(reminder.id).toBeDefined();
      expect(reminder.title).toBe('Call dentist');
      expect(reminder.notes).toBeNull();
      expect(reminder.status).toBe('pending');
      expect(reminder.snoozeCount).toBe(0);
    });

    it('E2E-T1-CREAT-03: Creation of overdue reminder accepts input and preserves past due date', async () => {
      const h = await createTestHarness('2026-09-10T10:00:00.000Z');
      const reminder = await h.repository.create({
        title: 'Overdue task from yesterday',
        dueDate: '2026-09-09T18:00:00.000Z',
      });

      expect(reminder.id).toBeDefined();
      expect(reminder.status).toBe('pending');
      expect(reminder.dueDate).toBe('2026-09-09T18:00:00.000Z');
      // Verify synchronous retrieval confirms existence
      const retrieved = h.repository.getById(reminder.id);
      expect(retrieved?.title).toBe('Overdue task from yesterday');
    });

    it('E2E-T1-CREAT-04: Invariant rejection on empty or whitespace-only title', async () => {
      const h = await createTestHarness();
      await expect(async () => {
        await h.repository.create({
          title: '   ',
          dueDate: '2026-09-10T12:00:00.000Z',
        });
      }).toThrow('Validation Error: Reminder title cannot be empty or whitespace');
    });

    it('E2E-T1-CREAT-05: Invariant rejection on invalid ISO 8601 date string', async () => {
      const h = await createTestHarness();
      await expect(async () => {
        await h.repository.create({
          title: 'Invalid Date Reminder',
          dueDate: 'not-a-real-date',
        });
      }).toThrow('Validation Error: Invalid ISO 8601 date string');
    });
  });

  describe('Tier 1 - Feature 2: Offline Persistence & Hydrated Storage CRUD', () => {
    it('E2E-T1-STORE-01: Full CRUD lifecycle: Create -> Read -> Update -> Delete', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      // Create
      const created = await h.repository.create({
        title: 'Initial Title',
        notes: 'Initial Notes',
        dueDate: '2026-09-10T14:00:00.000Z',
      });

      // Read
      const fetched = h.repository.getById(created.id);
      expect(fetched?.title).toBe('Initial Title');

      // Update
      h.clock.advanceMinutes(30);
      const updated = await h.repository.update(created.id, {
        title: 'Updated Title',
        notes: 'Updated Notes',
      });
      expect(updated.title).toBe('Updated Title');
      expect(updated.notes).toBe('Updated Notes');
      expect(updated.updatedAt).toBe('2026-09-10T08:30:00.000Z');

      // Delete
      const deleted = await h.repository.delete(created.id);
      expect(deleted).toBe(true);
      expect(h.repository.getById(created.id)).toBeUndefined();
    });

    it('E2E-T1-STORE-02: Cold boot hydration restores exact count and records from persistent storage', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      await h.repository.create({ title: 'Task Alpha', dueDate: '2026-09-10T10:00:00.000Z' });
      await h.repository.create({ title: 'Task Beta', dueDate: '2026-09-10T11:00:00.000Z' });
      await h.repository.create({ title: 'Task Gamma', dueDate: '2026-09-10T12:00:00.000Z' });

      expect(h.repository.getAll().length).toBe(3);

      // Simulate complete app cold reboot
      await h.reboot();

      const restored = h.repository.getAll();
      expect(restored.length).toBe(3);
      expect(restored[0].title).toBe('Task Alpha');
      expect(restored[1].title).toBe('Task Beta');
      expect(restored[2].title).toBe('Task Gamma');
    });

    it('E2E-T1-STORE-03: Updating reminder A leaves reminder B completely unmodified', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r1 = await h.repository.create({ title: 'Task 1', notes: 'Note 1', dueDate: '2026-09-10T10:00:00.000Z' });
      const r2 = await h.repository.create({ title: 'Task 2', notes: 'Note 2', dueDate: '2026-09-10T11:00:00.000Z' });

      await h.repository.update(r1.id, { title: 'Task 1 Modified' });

      const fetchedR2 = h.repository.getById(r2.id);
      expect(fetchedR2?.title).toBe('Task 2');
      expect(fetchedR2?.notes).toBe('Note 2');
    });

    it('E2E-T1-STORE-04: Idempotent deletion on non-existent ID returns false safely', async () => {
      const h = await createTestHarness();
      const result = await h.repository.delete('non-existent-uuid-1234');
      expect(result).toBe(false);
    });

    it('E2E-T1-STORE-05: In-memory cache consistency: synchronous getAll reflects mutations immediately', async () => {
      const h = await createTestHarness();
      expect(h.repository.getAll().length).toBe(0);

      const r = await h.repository.create({ title: 'Immediate Sync', dueDate: '2026-09-10T12:00:00.000Z' });
      expect(h.repository.getAll().length).toBe(1);
      expect(h.repository.getAll()[0].id).toBe(r.id);

      await h.repository.delete(r.id);
      expect(h.repository.getAll().length).toBe(0);
    });
  });

  describe('Tier 1 - Feature 3: Reminder Lifecycle State Machine & Audit', () => {
    it('E2E-T1-STATE-01: Pending to Completed: status becomes completed and completedAt is set', async () => {
      const h = await createTestHarness('2026-09-10T09:00:00.000Z');
      const r = await h.repository.create({ title: 'Buy milk', dueDate: '2026-09-10T12:00:00.000Z' });

      h.clock.advanceMinutes(45);
      const completed = await h.repository.toggleComplete(r.id);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBe('2026-09-10T09:45:00.000Z');
      expect(completed.updatedAt).toBe('2026-09-10T09:45:00.000Z');
    });

    it('E2E-T1-STATE-02: Completed to Pending: toggleComplete uncompletes and clears completedAt', async () => {
      const h = await createTestHarness('2026-09-10T09:00:00.000Z');
      const r = await h.repository.create({ title: 'Pay bills', dueDate: '2026-09-10T12:00:00.000Z' });
      await h.repository.toggleComplete(r.id);

      h.clock.advanceHours(1);
      const toggledBack = await h.repository.toggleComplete(r.id);

      expect(toggledBack.status).toBe('pending');
      expect(toggledBack.completedAt).toBeNull();
      expect(toggledBack.updatedAt).toBe('2026-09-10T10:00:00.000Z');
    });

    it('E2E-T1-STATE-03: Pending to Snoozed: status becomes snoozed and increments snoozeCount', async () => {
      const h = await createTestHarness('2026-09-10T09:00:00.000Z');
      const r = await h.repository.create({ title: 'Water plants', dueDate: '2026-09-10T10:00:00.000Z' });

      const target = new Date('2026-09-10T10:15:00.000Z');
      const snoozed = await h.repository.snooze(r.id, target, '15m');

      expect(snoozed.status).toBe('snoozed');
      expect(snoozed.snoozeCount).toBe(1);
      expect(snoozed.lastSnoozedAt).toBe('2026-09-10T09:00:00.000Z');
      expect(snoozed.dueDate).toBe('2026-09-10T10:15:00.000Z');
    });

    it('E2E-T1-STATE-04: Snoozed to Completed: preserves snoozeCount and updates completedAt', async () => {
      const h = await createTestHarness('2026-09-10T09:00:00.000Z');
      const r = await h.repository.create({ title: 'Fix bug', dueDate: '2026-09-10T10:00:00.000Z' });
      await h.repository.snooze(r.id, new Date('2026-09-10T10:30:00.000Z'), 'custom');

      h.clock.advanceMinutes(15);
      const completed = await h.repository.toggleComplete(r.id);

      expect(completed.status).toBe('completed');
      expect(completed.snoozeCount).toBe(1);
      expect(completed.completedAt).toBe('2026-09-10T09:15:00.000Z');
    });

    it('E2E-T1-STATE-05: Consecutive Snoozes: accumulates snoozeCount and advances lastSnoozedAt', async () => {
      const h = await createTestHarness('2026-09-10T09:00:00.000Z');
      const r = await h.repository.create({ title: 'Draft proposal', dueDate: '2026-09-10T10:00:00.000Z' });

      await h.repository.snooze(r.id, new Date('2026-09-10T10:15:00.000Z'), '15m');
      h.clock.advanceMinutes(10);
      await h.repository.snooze(r.id, new Date('2026-09-10T11:15:00.000Z'), '1h');
      h.clock.advanceMinutes(20);
      const finalSnoozed = await h.repository.snooze(r.id, new Date('2026-09-10T19:00:00.000Z'), 'evening');

      expect(finalSnoozed.snoozeCount).toBe(3);
      expect(finalSnoozed.lastSnoozedAt).toBe('2026-09-10T09:30:00.000Z');
      expect(finalSnoozed.dueDate).toBe('2026-09-10T19:00:00.000Z');
    });
  });

  describe('Tier 1 - Feature 4: Snooze Calculations & T_base Math', () => {
    it('E2E-T1-SNOOZE-01: +15m when future (T_now < T_due) calculates from T_due + 15m', async () => {
      const now = new Date('2026-09-10T09:00:00.000Z');
      const due = new Date('2026-09-10T10:00:00.000Z');

      const target = calculateSnoozeTime('15m', due, now);
      // T_base = max(09:00, 10:00) = 10:00 -> 10:00 + 15m = 10:15:00.000Z
      expect(target.toISOString()).toBe('2026-09-10T10:15:00.000Z');
    });

    it('E2E-T1-SNOOZE-02: +15m when overdue (T_now > T_due) calculates from T_now + 15m', async () => {
      const now = new Date('2026-09-10T11:00:00.000Z');
      const due = new Date('2026-09-10T09:00:00.000Z'); // Overdue by 2 hours

      const target = calculateSnoozeTime('15m', due, now);
      // T_base = max(11:00, 09:00) = 11:00 -> 11:00 + 15m = 11:15:00.000Z
      expect(target.toISOString()).toBe('2026-09-10T11:15:00.000Z');
    });

    it('E2E-T1-SNOOZE-03: +1h adds exactly 60 minutes with seconds clamped to 00', async () => {
      const now = new Date('2026-09-10T10:14:37.892Z');
      const due = new Date('2026-09-10T10:14:37.892Z');

      const target = calculateSnoozeTime('1h', due, now);
      // 10:14 + 1h = 11:14:00.000Z
      expect(target.toISOString()).toBe('2026-09-10T11:14:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('E2E-T1-SNOOZE-04: Evening snooze before 18:30 sets today at 19:00:00.000', async () => {
      const now = new Date(2026, 8, 10, 14, 30, 0);
      const due = new Date(2026, 8, 10, 14, 30, 0);

      const target = calculateSnoozeTime('evening', due, now);
      expect(target.getHours()).toBe(19);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getDate()).toBe(now.getDate());
    });

    it('E2E-T1-SNOOZE-05: Tomorrow morning sets next calendar day at 09:00:00.000', async () => {
      const now = new Date('2026-09-10T20:00:00.000Z');
      const due = new Date('2026-09-10T20:00:00.000Z');

      const target = calculateSnoozeTime('tomorrow_morning', due, now);
      expect(target.getDate()).toBe(now.getDate() + 1);
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    });
  });

  describe('Tier 1 - Feature 5: Actionable Notification Payloads & Background Rescheduling', () => {
    it('E2E-T1-NOTIF-01: Notification scheduling assigns notificationId and registers category payload', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r = await h.repository.create({ title: 'Actionable Alert', dueDate: '2026-09-10T12:00:00.000Z' });

      const notifId = await h.notificationService.scheduleReminderNotification(r);
      expect(notifId).toBeDefined();
      expect(r.notificationId).toBe(notifId);

      const scheduled = h.notificationEngine.scheduledAlerts.get(notifId!);
      expect(scheduled).toBeDefined();
      expect(scheduled?.reminderId).toBe(r.id);
      expect(scheduled?.categoryIdentifier).toBe(NOTIFICATION_CATEGORY);
    });

    it('E2E-T1-NOTIF-02: Shade ACTION_COMPLETE marks reminder completed and cancels notification', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r = await h.repository.create({ title: 'Task to Complete', dueDate: '2026-09-10T10:00:00.000Z' });
      const notifId = await h.notificationService.scheduleReminderNotification(r);

      // User taps "Complete" button directly in notification shade
      await h.notificationService.handleNotificationResponse(ACTION_COMPLETE, r.id);

      const updated = h.repository.getById(r.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeDefined();

      // Verify notification is cancelled
      expect(h.notificationEngine.scheduledAlerts.has(notifId!)).toBe(false);
    });

    it('E2E-T1-NOTIF-03: Shade ACTION_SNOOZE_15M reschedules reminder and registers subsequent alert', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r = await h.repository.create({ title: 'Task to Snooze 15m', dueDate: '2026-09-10T10:00:00.000Z' });
      const oldNotifId = await h.notificationService.scheduleReminderNotification(r);

      // Notification shade fires +15m action
      await h.notificationService.handleNotificationResponse(ACTION_SNOOZE_15M, r.id);

      const snoozed = h.repository.getById(r.id);
      expect(snoozed?.status).toBe('snoozed');
      expect(snoozed?.snoozeCount).toBe(1);
      expect(snoozed?.dueDate).toBe('2026-09-10T10:15:00.000Z');

      // Old notification cancelled, new notification scheduled
      expect(h.notificationEngine.scheduledAlerts.has(oldNotifId!)).toBe(false);
      expect(snoozed?.notificationId).toBeDefined();
      expect(h.notificationEngine.scheduledAlerts.has(snoozed!.notificationId!)).toBe(true);
    });

    it('E2E-T1-NOTIF-04: Shade ACTION_SNOOZE_1H reschedules reminder by 1 hour', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r = await h.repository.create({ title: 'Task to Snooze 1h', dueDate: '2026-09-10T10:00:00.000Z' });
      await h.notificationService.scheduleReminderNotification(r);

      await h.notificationService.handleNotificationResponse(ACTION_SNOOZE_1H, r.id);

      const snoozed = h.repository.getById(r.id);
      expect(snoozed?.status).toBe('snoozed');
      expect(snoozed?.dueDate).toBe('2026-09-10T11:00:00.000Z');
    });

    it('E2E-T1-NOTIF-05: Cold boot reconciliation returns active reminders for alert reconciliation', async () => {
      const h = await createTestHarness('2026-09-10T08:00:00.000Z');
      const r1 = await h.repository.create({ title: 'Active 1', dueDate: '2026-09-10T12:00:00.000Z' });
      const r2 = await h.repository.create({ title: 'Active 2', dueDate: '2026-09-10T14:00:00.000Z' });
      const r3 = await h.repository.create({ title: 'Done', dueDate: '2026-09-10T10:00:00.000Z' });
      await h.repository.toggleComplete(r3.id);

      // Cold boot
      await h.reboot();

      const active = await h.repository.reconcileActiveReminders();
      expect(active.length).toBe(2);
      expect(active.map((x) => x.id)).toContain(r1.id);
      expect(active.map((x) => x.id)).toContain(r2.id);
      expect(active.map((x) => x.id).includes(r3.id)).toBe(false);
    });
  });
}
