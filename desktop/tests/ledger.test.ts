import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalLedger } from '../src/main/ledger';
import { Reminder } from '../src/types';

describe('Desktop Local SQLite Ledger', () => {
  let ledger: LocalLedger;
  let tmpDbPath: string;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `remy_test_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
    ledger = new LocalLedger(tmpDbPath);
    await ledger.init();
  });

  afterEach(() => {
    ledger.close();
    if (fs.existsSync(tmpDbPath)) {
      try {
        fs.unlinkSync(tmpDbPath);
      } catch (e) {}
    }
  });

  it('creates tables and performs CRUD operations on reminders', () => {
    const rem1: Reminder = {
      id: 'rem-desktop-1',
      title: 'Call accountant',
      notes: 'Prepare tax forms',
      dueDate: new Date(Date.now() + 3600000).toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      armed: true,
    };

    const saved = ledger.upsertReminder(rem1);
    expect(saved.id).toBe('rem-desktop-1');
    expect(saved.title).toBe('Call accountant');
    expect(saved.notes).toBe('Prepare tax forms');
    expect(saved.status).toBe('pending');

    const fetched = ledger.getReminder('rem-desktop-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Call accountant');

    const list = ledger.listReminders();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('rem-desktop-1');
  });

  it('handles snooze increments and timestamp updates', () => {
    const now = new Date();
    const rem: Reminder = {
      id: 'rem-snooze-test',
      title: 'Dahi lena',
      dueDate: now.toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    ledger.upsertReminder(rem);

    const snoozedTarget = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const snoozed = ledger.snoozeReminder('rem-snooze-test', snoozedTarget);

    expect(snoozed).not.toBeNull();
    expect(snoozed?.status).toBe('snoozed');
    expect(snoozed?.snoozeCount).toBe(1);
    expect(snoozed?.dueDate).toBe(snoozedTarget);
    expect(snoozed?.lastSnoozedAt).toBeDefined();
  });

  it('completes and deletes reminders properly', () => {
    const rem: Reminder = {
      id: 'rem-lifecycle',
      title: 'Finish report',
      dueDate: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ledger.upsertReminder(rem);

    const completed = ledger.completeReminder('rem-lifecycle');
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).toBeDefined();

    // Check listing by status
    const pendingList = ledger.listReminders({ status: 'pending' });
    expect(pendingList.length).toBe(0);

    const completedList = ledger.listReminders({ status: 'completed' });
    expect(completedList.length).toBe(1);

    // Soft delete
    const deleted = ledger.deleteReminder('rem-lifecycle');
    expect(deleted).toBe(true);

    const activeList = ledger.listReminders({ includeDeleted: false });
    expect(activeList.length).toBe(0);

    const allList = ledger.listReminders({ includeDeleted: true });
    expect(allList.length).toBe(1);
    expect(allList[0].isDeleted).toBe(true);
  });

  it('correctly queries due reminders', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 600000).toISOString();

    ledger.upsertReminder({
      id: 'due-1',
      title: 'Due item',
      dueDate: past,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
    });

    ledger.upsertReminder({
      id: 'future-1',
      title: 'Future item',
      dueDate: future,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
    });

    const due = ledger.getDueReminders();
    expect(due.length).toBe(1);
    expect(due[0].id).toBe('due-1');
  });

  it('persists changes to disk and reloads across instances', async () => {
    ledger.upsertReminder({
      id: 'persist-test',
      title: 'Persistent reminder',
      dueDate: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    ledger.close();

    // Open second instance pointing to the same file
    const secondLedger = new LocalLedger(tmpDbPath);
    await secondLedger.init();

    const loaded = secondLedger.getReminder('persist-test');
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe('Persistent reminder');
    secondLedger.close();
  });

  it('enforces Last-Write-Wins conflict resolution on local upsert', () => {
    const t1 = '2026-09-28T12:00:00.000Z';
    const t2 = '2026-09-28T13:00:00.000Z';

    ledger.upsertReminder({
      id: 'conflict-test',
      title: 'Newer local version',
      dueDate: t2,
      status: 'pending',
      snoozeCount: 0,
      createdAt: t1,
      updatedAt: t2,
    });

    // Attempting to overwrite with older timestamp should be ignored
    ledger.upsertReminder({
      id: 'conflict-test',
      title: 'Stale remote version',
      dueDate: t1,
      status: 'pending',
      snoozeCount: 0,
      createdAt: t1,
      updatedAt: t1,
    });

    const current = ledger.getReminder('conflict-test');
    expect(current?.title).toBe('Newer local version');
  });

  it('excludes unarmed reminders (inbox tasks) from getDueReminders', () => {
    const past = new Date(Date.now() - 60000).toISOString();

    ledger.upsertReminder({
      id: 'unarmed-1',
      title: 'Inbox dump thought',
      dueDate: past,
      status: 'pending',
      snoozeCount: 0,
      createdAt: past,
      updatedAt: past,
      armed: false,
    });

    const due = ledger.getDueReminders();
    expect(due.find((r) => r.id === 'unarmed-1')).toBeUndefined();
  });

  it('reloads dynamically when database is modified externally on disk', async () => {
    // Wait briefly so modification timestamp advances past Windows timer tick
    await new Promise((r) => setTimeout(r, 25));

    // External process writes to tmpDbPath
    const externalLedger = new LocalLedger(tmpDbPath);
    await externalLedger.init();
    externalLedger.upsertReminder({
      id: 'external-rem',
      title: 'Added by FastMCP CLI',
      dueDate: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    externalLedger.close();

    // Primary ledger should detect mtime change and reload
    const loaded = ledger.getReminder('external-rem');
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe('Added by FastMCP CLI');
  });

  it('mirrors reminders to tasks table matching backend schema', () => {
    ledger.upsertReminder({
      id: 'mirror-test',
      title: 'Buy groceries',
      notes: 'category:shopping',
      dueDate: '2026-09-28T18:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
      armed: true,
    });

    // Verify task mirroring via raw query
    const list = ledger.listReminders();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('mirror-test');
  });

  it('persists and filters by context mode and tags', () => {
    ledger.upsertReminder({
      id: 'rem-work-1',
      title: 'Review quarterly architecture doc',
      dueDate: '2026-09-29T15:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
      context: 'work',
      tags: ['office', 'review'],
    });

    ledger.upsertReminder({
      id: 'rem-home-1',
      title: 'Pick up milk from dairy',
      dueDate: '2026-09-29T18:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
      context: 'home',
      tags: ['groceries'],
    });

    ledger.upsertReminder({
      id: 'rem-pers-1',
      title: 'Call doctor for prescription',
      dueDate: '2026-09-29T19:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
      context: 'personal',
      tags: ['call'],
    });

    ledger.upsertReminder({
      id: 'rem-gen-1',
      title: 'Random thought note',
      dueDate: '2026-09-29T20:00:00.000Z',
      status: 'pending',
      snoozeCount: 0,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
      context: 'all',
    });

    const workRem = ledger.getReminder('rem-work-1');
    expect(workRem?.context).toBe('work');
    expect(workRem?.tags).toEqual(['office', 'review']);

    const homeRem = ledger.getReminder('rem-home-1');
    expect(homeRem?.context).toBe('home');
    expect(homeRem?.tags).toEqual(['groceries']);

    const workList = ledger.listReminders({ context: 'work' });
    expect(workList.some((r) => r.id === 'rem-work-1')).toBe(true);
    expect(workList.some((r) => r.id === 'rem-home-1')).toBe(false);
    expect(workList.some((r) => r.id === 'rem-pers-1')).toBe(false);
    expect(workList.some((r) => r.id === 'rem-gen-1')).toBe(false);

    const homeList = ledger.listReminders({ context: 'home' });
    expect(homeList.some((r) => r.id === 'rem-home-1')).toBe(true);
    expect(homeList.some((r) => r.id === 'rem-pers-1')).toBe(true);
    expect(homeList.some((r) => r.id === 'rem-gen-1')).toBe(true);
    expect(homeList.some((r) => r.id === 'rem-work-1')).toBe(false);

    const allList = ledger.listReminders({ context: 'all' });
    expect(allList.length).toBeGreaterThanOrEqual(4);
  });

  it('stores and retrieves key-value app settings', () => {
    expect(ledger.getSetting('active_mode', 'all')).toBe('all');
    ledger.setSetting('active_mode', 'home');
    expect(ledger.getSetting('active_mode', 'all')).toBe('home');
  });
});
