/**
 * Test Harness Context & Factory for Remy Reminders E2E Tests
 */

import { MockClock } from './mockClock.ts';
import { MockStorage } from './mockStorage.ts';
import { MockNotificationEngine } from './mockNotifications.ts';
import {
  ReferenceReminderRepository,
  ReferenceNotificationService,
  calculateSnoozeTime,
} from './referenceDomain.ts';
import type { IReminderRepository, INotificationService } from './types.ts';

export interface TestContext {
  clock: MockClock;
  storage: MockStorage;
  notificationEngine: MockNotificationEngine;
  repository: IReminderRepository;
  notificationService: INotificationService;
  reboot: () => Promise<TestContext>;
}

/**
 * Creates an isolated, clean test harness instance with fresh storage,
 * virtual clock, and notification engine.
 */
export async function createTestHarness(initialDate: string = '2026-09-10T08:00:00.000Z'): Promise<TestContext> {
  const clock = new MockClock(initialDate);
  const storage = new MockStorage();
  const notificationEngine = new MockNotificationEngine();

  const repository = new ReferenceReminderRepository(storage, clock);
  await repository.init();

  const notificationService = new ReferenceNotificationService(notificationEngine, repository, clock);
  await notificationService.init();

  const context: TestContext = {
    clock,
    storage,
    notificationEngine,
    repository,
    notificationService,
    reboot: async () => {
      // Simulate app cold boot: new repository and service instances against same persistent storage
      const newRepo = new ReferenceReminderRepository(storage, clock);
      await newRepo.init();
      const newNotifService = new ReferenceNotificationService(notificationEngine, newRepo, clock);
      await newNotifService.init();
      context.repository = newRepo;
      context.notificationService = newNotifService;
      return context;
    },
  };

  return context;
}
