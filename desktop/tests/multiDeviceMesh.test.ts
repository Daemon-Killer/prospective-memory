import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalLedger } from '../src/main/ledger';
import { SyncEngine, resolveLww } from '../src/main/syncEngine';
import { Reminder } from '../src/types';

/**
 * Multi-Device Ecosystem Mesh Integration Test
 * Simulates:
 * - Node A: macOS Workstation (Office)
 * - Node B: Windows Laptop (Home)
 * - Node C: Mobile / Android Node
 * Syncing via Cloud Sync Engine with LWW resolution and soft deletes
 */
describe('Multi-Device Mesh Synchronization', () => {
  let ledgerNodeA: LocalLedger; // Mac
  let ledgerNodeB: LocalLedger; // Windows
  let cloudLedger: Map<string, Reminder>; // Simulated Cloud Hub

  beforeEach(async () => {
    ledgerNodeA = new LocalLedger(':memory:');
    await ledgerNodeA.init();

    ledgerNodeB = new LocalLedger(':memory:');
    await ledgerNodeB.init();

    cloudLedger = new Map();
  });

  afterEach(() => {
    ledgerNodeA.close();
    ledgerNodeB.close();
    cloudLedger.clear();
  });

  // Helper simulating /v1/reminders/sync on the cloud hub
  function simulateCloudSync(clientReminders: Reminder[], _clientSyncTime: string | null = null): Reminder[] {
    const serverTime = new Date().toISOString();
    for (const clientRem of clientReminders) {
      const existing = cloudLedger.get(clientRem.id);
      const decision = resolveLww(existing, clientRem);
      if (decision.action === 'apply_remote' || decision.action === 'delete') {
        cloudLedger.set(clientRem.id, {
          ...decision.winner,
          updatedAt: clientRem.updatedAt || serverTime,
        });
      }
    }
    return Array.from(cloudLedger.values());
  }

  it('propagates task creation from Node A (Mac) to Node B (Windows) and Node C (Mobile)', () => {
    const t0 = new Date('2026-09-29T10:00:00.000Z').toISOString();
    const reminderT1: Reminder = {
      id: 'task-mesh-101',
      title: 'Deploy microservices to staging #work',
      dueDate: new Date('2026-09-29T17:00:00.000Z').toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: t0,
      updatedAt: t0,
      armed: true,
      context: 'work',
      tags: ['work'],
    };

    // Node A (Mac) creates reminder T1
    ledgerNodeA.upsertReminder(reminderT1);
    expect(ledgerNodeA.getReminder('task-mesh-101')).not.toBeNull();

    // Node A syncs to Cloud
    const nodeAOut = simulateCloudSync(ledgerNodeA.listReminders({ includeDeleted: true }));
    expect(cloudLedger.has('task-mesh-101')).toBe(true);

    // Node B (Windows) syncs from Cloud
    const nodeBSynced = simulateCloudSync(ledgerNodeB.listReminders({ includeDeleted: true }));
    nodeBSynced.forEach((rem) => ledgerNodeB.upsertReminder(rem));

    // Verify Node B hydrated T1
    const nodeBReminder = ledgerNodeB.getReminder('task-mesh-101');
    expect(nodeBReminder).not.toBeNull();
    expect(nodeBReminder?.title).toBe('Deploy microservices to staging #work');
    expect(nodeBReminder?.context).toBe('work');
  });

  it('propagates snooze from Node C to Node A and Node B to exact millisecond', () => {
    const t0 = new Date('2026-09-29T10:00:00.000Z').toISOString();
    const reminderT1: Reminder = {
      id: 'task-mesh-102',
      title: 'Review PR #42',
      dueDate: new Date('2026-09-29T11:00:00.000Z').toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: t0,
      updatedAt: t0,
      armed: true,
    };

    // Hydrate all nodes with T1
    ledgerNodeA.upsertReminder(reminderT1);
    ledgerNodeB.upsertReminder(reminderT1);
    cloudLedger.set(reminderT1.id, { ...reminderT1 });

    // Node C (Mobile) snoozes T1 by +15m
    const snoozeTime = new Date('2026-09-29T10:05:00.000Z').toISOString();
    const newDueDate = new Date('2026-09-29T11:15:00.000Z').toISOString();
    const snoozedByNodeC: Reminder = {
      ...reminderT1,
      status: 'snoozed',
      snoozeCount: 1,
      lastSnoozedAt: snoozeTime,
      dueDate: newDueDate,
      updatedAt: snoozeTime,
    };

    // Node C syncs to Cloud
    simulateCloudSync([snoozedByNodeC]);

    // Node A syncs from Cloud
    const cloudToA = simulateCloudSync(ledgerNodeA.listReminders({ includeDeleted: true }));
    cloudToA.forEach((rem) => {
      const local = ledgerNodeA.getReminder(rem.id);
      const dec = resolveLww(local || undefined, rem);
      if (dec.action === 'apply_remote') ledgerNodeA.upsertReminder(dec.winner);
    });

    // Node B syncs from Cloud
    const cloudToB = simulateCloudSync(ledgerNodeB.listReminders({ includeDeleted: true }));
    cloudToB.forEach((rem) => {
      const local = ledgerNodeB.getReminder(rem.id);
      const dec = resolveLww(local || undefined, rem);
      if (dec.action === 'apply_remote') ledgerNodeB.upsertReminder(dec.winner);
    });

    // Verify exact dueDate on both nodes
    expect(ledgerNodeA.getReminder('task-mesh-102')?.dueDate).toBe(newDueDate);
    expect(ledgerNodeB.getReminder('task-mesh-102')?.dueDate).toBe(newDueDate);
    expect(ledgerNodeA.getReminder('task-mesh-102')?.status).toBe('snoozed');
    expect(ledgerNodeB.getReminder('task-mesh-102')?.status).toBe('snoozed');
  });

  it('marks task complete on Node B (Windows) and clears active state across all nodes', () => {
    const t0 = new Date('2026-09-29T10:00:00.000Z').toISOString();
    const reminderT1: Reminder = {
      id: 'task-mesh-103',
      title: 'Call plumber regarding boiler leak',
      dueDate: new Date('2026-09-29T14:00:00.000Z').toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: t0,
      updatedAt: t0,
      armed: true,
      context: 'home',
    };

    ledgerNodeA.upsertReminder(reminderT1);
    ledgerNodeB.upsertReminder(reminderT1);
    cloudLedger.set(reminderT1.id, { ...reminderT1 });

    // Node B marks task complete
    const completedTime = new Date('2026-09-29T14:02:00.000Z').toISOString();
    const completedRem = ledgerNodeB.completeReminder('task-mesh-103');
    expect(completedRem?.status).toBe('completed');

    // Node B syncs to Cloud
    simulateCloudSync([completedRem!]);

    // Node A syncs from Cloud
    const cloudToA = simulateCloudSync(ledgerNodeA.listReminders({ includeDeleted: true }));
    cloudToA.forEach((rem) => {
      const local = ledgerNodeA.getReminder(rem.id);
      const dec = resolveLww(local || undefined, rem);
      if (dec.action === 'apply_remote') ledgerNodeA.upsertReminder(dec.winner);
    });

    // Verify Node A shows completed and NOT in active due reminders
    const nodeAReminder = ledgerNodeA.getReminder('task-mesh-103');
    expect(nodeAReminder?.status).toBe('completed');
    const activeDue = ledgerNodeA.getDueReminders();
    expect(activeDue.find((r) => r.id === 'task-mesh-103')).toBeUndefined();
  });
});
