import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../src/main/notifications';
import { LocalLedger } from '../src/main/ledger';
import { SyncEngine } from '../src/main/syncEngine';

// Mock electron Notification module
vi.mock('electron', () => {
  return {
    app: { getAppPath: () => process.cwd() },
    Notification: class MockNotification {
      static isSupported() {
        return true;
      }
      on() {}
      show() {}
    },
  };
});

describe('Desktop Notifications Service', () => {
  let ledger: LocalLedger;
  let syncEngine: SyncEngine;
  let notifService: NotificationService;
  let calledCount = 0;

  beforeEach(async () => {
    ledger = new LocalLedger(':memory:');
    await ledger.init();
    syncEngine = new SyncEngine(ledger);
    calledCount = 0;
    notifService = new NotificationService(ledger, syncEngine, () => {
      calledCount++;
    });
  });

  afterEach(() => {
    notifService.stop();
    ledger.close();
    vi.restoreAllMocks();
  });

  it('detects due reminders and triggers notification', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    ledger.upsertReminder({
      id: 'due-notif-1',
      title: 'Take medication',
      dueDate: past,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
    });

    const triggered = notifService.checkDueReminders();
    expect(triggered.length).toBe(1);
    expect(triggered[0].id).toBe('due-notif-1');

    // Second check should not duplicate notification for the same item
    const secondCheck = notifService.checkDueReminders();
    expect(secondCheck.length).toBe(0);
  });

  it('snoozes a reminder by 15 minutes when action is triggered', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    ledger.upsertReminder({
      id: 'snooze-action-1',
      title: 'Call doctor',
      dueDate: past,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
    });

    notifService.snoozeReminder15m('snooze-action-1');

    const updated = ledger.getReminder('snooze-action-1');
    expect(updated?.status).toBe('snoozed');
    expect(updated?.snoozeCount).toBe(1);
    const newDueMs = new Date(updated!.dueDate).getTime();
    expect(newDueMs).toBeGreaterThan(Date.now() + 10 * 60 * 1000);
  });

  it('completes a reminder when action is triggered', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    ledger.upsertReminder({
      id: 'complete-action-1',
      title: 'Email client',
      dueDate: past,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
    });

    notifService.completeReminder('complete-action-1');

    const updated = ledger.getReminder('complete-action-1');
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeDefined();
  });

  it('re-notifies when a reminder is snoozed to a new due date that becomes due', () => {
    const t1 = new Date(Date.now() - 20000).toISOString();
    ledger.upsertReminder({
      id: 'rescheduled-1',
      title: 'Water plants',
      dueDate: t1,
      status: 'pending',
      snoozeCount: 0,
      createdAt: t1,
      updatedAt: t1,
    });

    // First check triggers notification
    const check1 = notifService.checkDueReminders();
    expect(check1.length).toBe(1);

    // Reminder is snoozed to a new due date (also in the past for testing)
    const t2 = new Date(Date.now() - 5000).toISOString();
    ledger.upsertReminder({
      id: 'rescheduled-1',
      title: 'Water plants',
      dueDate: t2,
      status: 'snoozed',
      snoozeCount: 1,
      createdAt: t1,
      updatedAt: t2,
    });

    // Check should detect new due date and trigger notification again
    const check2 = notifService.checkDueReminders();
    expect(check2.length).toBe(1);
    expect(check2[0].id).toBe('rescheduled-1');
  });
});
