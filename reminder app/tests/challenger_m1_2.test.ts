import { AppState, NativeModules, Platform } from 'react-native';
import {
  sensoryBridge,
  SensoryBridgeService,
  RawNotificationPayload,
  SensoryFilterConfig,
  DEFAULT_FILTER_CONFIG,
} from '../src/sensory';

describe('Milestone 1 Challenger 2 - Adversarial Ingress Bridge & Concurrency Battery', () => {
  let bridge: SensoryBridgeService;

  beforeEach(async () => {
    bridge = new SensoryBridgeService();
    await bridge.clearPendingNotifications();
    await bridge.clearQuarantineStats();
  });

  // =========================================================================
  // 1. Queue Bounds & FIFO Eviction (Max 100 entries)
  // =========================================================================
  describe('Queue Bounds & FIFO Eviction', () => {
    test('CHALLENGE-1.1: Simulating exactly 100 notifications fills queue to 100', async () => {
      for (let i = 0; i < 100; i++) {
        await bridge.simulateNotification({
          id: `alert-${i}`,
          title: `Alert ${i}`,
          text: `Message content ${i}`,
        });
      }

      const pending = await bridge.getPendingNotifications();
      expect(pending.length).toBe(100);
      expect(pending[0].id).toBe('alert-0');
      expect(pending[99].id).toBe('alert-99');
    });

    test('CHALLENGE-1.2: Simulating >100 notifications enforces FIFO cap (max 100 entries)', async () => {
      // Simulate 150 notifications (0 to 149)
      for (let i = 0; i < 150; i++) {
        await bridge.simulateNotification({
          id: `alert-${i}`,
          title: `Alert ${i}`,
          text: `Message content ${i}`,
        });
      }

      const pending = await bridge.getPendingNotifications();

      // EMPIRICAL CHECK: The queue bound contract dictates max 100 entries in FIFO order.
      // If the queue has >100 entries, it fails the bounded queue invariant.
      expect(pending.length).toBeLessThanOrEqual(100);

      if (pending.length === 100) {
        // FIFO eviction check: oldest 50 items (0..49) must have been evicted, items 50..149 retained
        expect(pending[0].id).toBe('alert-50');
        expect(pending[99].id).toBe('alert-149');
      }
    });

    test('CHALLENGE-1.3: Extreme burst (300 notifications) maintains queue bound and memory stability', async () => {
      const burstSize = 300;
      for (let i = 0; i < burstSize; i++) {
        await bridge.simulateNotification({
          id: `burst-${i}`,
          title: `Burst Title ${i}`,
          text: `Burst message ${i}`,
        });
      }

      const pending = await bridge.getPendingNotifications();
      expect(pending.length).toBeLessThanOrEqual(100);

      const drained = await bridge.drainPendingNotifications();
      expect(drained.length).toBeLessThanOrEqual(100);

      const afterDrain = await bridge.getPendingNotifications();
      expect(afterDrain.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. Atomic Queue Draining & Concurrency Under High-Frequency Ingress
  // =========================================================================
  describe('Atomic Queue Draining & High-Frequency Ingress', () => {
    test('CHALLENGE-2.1: Concurrent drain calls never duplicate notifications', async () => {
      // Enqueue 20 notifications
      for (let i = 0; i < 20; i++) {
        await bridge.simulateNotification({
          id: `concurrent-${i}`,
          title: `Concurrent ${i}`,
        });
      }

      // Fire 5 concurrent drain calls simultaneously
      const drainPromises = [
        bridge.drainPendingNotifications(),
        bridge.drainPendingNotifications(),
        bridge.drainPendingNotifications(),
        bridge.drainPendingNotifications(),
        bridge.drainPendingNotifications(),
      ];

      const drainResults = await Promise.all(drainPromises);
      const allDrained = drainResults.flat();

      // Total drained items must equal exactly 20 (zero duplicates, zero losses)
      expect(allDrained.length).toBe(20);

      // Verify all IDs are unique (no double-processing)
      const ids = allDrained.map((n) => n.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(20);

      // Queue must remain completely drained
      const remaining = await bridge.getPendingNotifications();
      expect(remaining.length).toBe(0);
    });

    test('CHALLENGE-2.2: Interleaved high-frequency concurrent enqueue and drain', async () => {
      const collected: RawNotificationPayload[] = [];
      const totalToEnqueue = 60;

      // Run enqueuing and draining concurrently in separate asynchronous loops
      const enqueueTask = async () => {
        for (let i = 0; i < totalToEnqueue; i++) {
          await bridge.simulateNotification({
            id: `interleaved-${i}`,
            title: `Item ${i}`,
          });
        }
      };

      const drainTask = async () => {
        while (collected.length < totalToEnqueue) {
          const batch = await bridge.drainPendingNotifications();
          if (batch.length > 0) {
            collected.push(...batch);
          }
          // Small yield to allow interleaved scheduling
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      };

      await Promise.all([enqueueTask(), drainTask()]);

      expect(collected.length).toBe(totalToEnqueue);
      const uniqueIds = new Set(collected.map((c) => c.id));
      expect(uniqueIds.size).toBe(totalToEnqueue);
    });

    test('CHALLENGE-2.3: clearPendingNotifications immediately resets pending queue', async () => {
      for (let i = 0; i < 15; i++) {
        await bridge.simulateNotification({ title: `ClearMe ${i}` });
      }

      expect((await bridge.getPendingNotifications()).length).toBe(15);
      const cleared = await bridge.clearPendingNotifications();
      expect(cleared).toBe(true);
      expect((await bridge.getPendingNotifications()).length).toBe(0);
      expect((await bridge.drainPendingNotifications()).length).toBe(0);
    });
  });

  // =========================================================================
  // 3. Null, Empty, or Corrupted Alert Bundles
  // =========================================================================
  describe('Resilience Against Null, Empty, or Corrupted Bundles', () => {
    test('CHALLENGE-3.1: simulateNotification with null or undefined does not throw uncaught TypeError', async () => {
      // Must not crash or throw unhandled exceptions
      await expect(bridge.simulateNotification(null as any)).resolves.not.toThrow();
      await expect(bridge.simulateNotification(undefined as any)).resolves.not.toThrow();
    });

    test('CHALLENGE-3.2: simulateNotification with empty object populates safe fallback defaults', async () => {
      const res = await bridge.simulateNotification({});
      expect(res.status).toBe('emitted');

      const pending = await bridge.getPendingNotifications();
      expect(pending.length).toBe(1);
      expect(typeof pending[0].id).toBe('string');
      expect(pending[0].id.length).toBeGreaterThan(0);
      expect(pending[0].title).toBe('');
      expect(pending[0].text).toBe('');
      expect(pending[0].subText).toBeNull();
      expect(typeof pending[0].timestamp).toBe('number');
    });

    test('CHALLENGE-3.3: simulateNotification with extreme / weird payloads (non-string types)', async () => {
      const weirdPayload = {
        title: 123456 as any,
        text: { nested: 'object' } as any,
        subText: [1, 2, 3] as any,
        packageName: false as any,
      };

      await expect(bridge.simulateNotification(weirdPayload)).resolves.not.toThrow();
      const pending = await bridge.getPendingNotifications();
      expect(pending.length).toBe(1);
    });

    test('CHALLENGE-3.4: Corrupted JSON strings from native module do not crash getPendingNotifications or drain', async () => {
      // Simulate native module returning corrupted or unexpected JSON strings
      const mockModule = {
        getPendingNotifications: jest.fn().mockResolvedValue('{ invalid json syntax !!!'),
        drainPendingNotifications: jest.fn().mockResolvedValue('not json at all'),
        clearPendingNotifications: jest.fn().mockResolvedValue(true),
        getFilterConfig: jest.fn().mockResolvedValue('<<<not-json>>>'),
        getQuarantineStats: jest.fn().mockResolvedValue(null),
      };

      // Temporarily inject mockModule into NativeModules
      (NativeModules as any).RemySensoryModule = mockModule;
      const nativeBridge = new SensoryBridgeService();

      // In tests Platform.OS is 'ios' or 'android' depending on mock; let's force Platform.OS = 'android'
      const originalOS = Platform.OS;
      (Platform as any).OS = 'android';

      try {
        const pending = await nativeBridge.getPendingNotifications();
        expect(pending).toEqual([]);

        const drained = await nativeBridge.drainPendingNotifications();
        expect(drained).toEqual([]);

        const config = await nativeBridge.getFilterConfig();
        expect(config).toEqual(DEFAULT_FILTER_CONFIG);

        const stats = await nativeBridge.getQuarantineStats();
        expect(stats).toEqual({ quarantinedCount: 0, lastQuarantinedAt: null });
      } finally {
        (Platform as any).OS = originalOS;
        delete (NativeModules as any).RemySensoryModule;
      }
    });

    test('CHALLENGE-3.5: Non-array JSON objects from native module fallback to empty array', async () => {
      const mockModule = {
        getPendingNotifications: jest.fn().mockResolvedValue(JSON.stringify({ notAnArray: true })),
        drainPendingNotifications: jest.fn().mockResolvedValue(JSON.stringify(12345)),
      };

      (NativeModules as any).RemySensoryModule = mockModule;
      const nativeBridge = new SensoryBridgeService();
      const originalOS = Platform.OS;
      (Platform as any).OS = 'android';

      try {
        const pending = await nativeBridge.getPendingNotifications();
        expect(pending).toEqual([]);

        const drained = await nativeBridge.drainPendingNotifications();
        expect(drained).toEqual([]);
      } finally {
        (Platform as any).OS = originalOS;
        delete (NativeModules as any).RemySensoryModule;
      }
    });
  });

  // =========================================================================
  // 4. Event Listener Lifecycle & AppState Background/Foreground Transitions
  // =========================================================================
  describe('Event Listener Lifecycle & AppState Transitions', () => {
    test('CHALLENGE-4.1: Listener throwing an exception does not break subsequent listeners', async () => {
      const results: string[] = [];

      const failingListener = () => {
        throw new Error('Listener crash explosion!');
      };

      const successfulListener = (n: RawNotificationPayload) => {
        results.push(n.title);
      };

      bridge.onNotification(failingListener);
      bridge.onNotification(successfulListener);

      // simulateNotification should ideally isolate listener exceptions or not leave subsequent listeners starved
      try {
        await bridge.simulateNotification({ title: 'Resilience Test' });
      } catch {
        // Even if simulateNotification threw because of listener 1:
      }

      // Check whether successful listener received the event
      expect(results).toContain('Resilience Test');
    });

    test('CHALLENGE-4.2: Multiple listener registrations and selective unsubscriptions', async () => {
      const l1Results: string[] = [];
      const l2Results: string[] = [];

      const unsub1 = bridge.onNotification((n) => l1Results.push(n.id));
      const unsub2 = bridge.onNotification((n) => l2Results.push(n.id));

      await bridge.simulateNotification({ id: 'msg-1', title: 'M1' });
      expect(l1Results).toEqual(['msg-1']);
      expect(l2Results).toEqual(['msg-1']);

      // Unsubscribe listener 1
      unsub1();
      // Calling unsub1 again (idempotency check)
      expect(() => unsub1()).not.toThrow();

      await bridge.simulateNotification({ id: 'msg-2', title: 'M2' });
      expect(l1Results).toEqual(['msg-1']); // Not called
      expect(l2Results).toEqual(['msg-1', 'msg-2']); // Still called

      unsub2();
      await bridge.simulateNotification({ id: 'msg-3', title: 'M3' });
      expect(l2Results).toEqual(['msg-1', 'msg-2']); // Not called
    });

    test('CHALLENGE-4.3: AppState transitions drain queue only on active state', async () => {
      const drainedBatches: RawNotificationPayload[][] = [];
      const unsub = bridge.initResumeDrain((notifications) => {
        drainedBatches.push(notifications);
      });

      // Clear initial drain triggered at mount
      drainedBatches.length = 0;

      // Add a pending notification
      await bridge.simulateNotification({ id: 'queued-1', title: 'Queued while backgrounded' });

      // In Jest preset, AppState.addEventListener is a jest.fn
      // Find the listener registered by initResumeDrain
      const addListenerMock = AppState.addEventListener as jest.Mock;
      const changeCall = addListenerMock.mock.calls
        .slice()
        .reverse()
        .find((call) => call[0] === 'change');
      const listener = changeCall ? changeCall[1] : null;
      expect(typeof listener).toBe('function');

      // Transition to 'background' -> should NOT drain
      if (listener) await listener('background');
      expect(drainedBatches.length).toBe(0);

      // Transition to 'inactive' -> should NOT drain
      if (listener) await listener('inactive');
      expect(drainedBatches.length).toBe(0);

      // Transition to 'active' -> MUST drain
      if (listener) await listener('active');
      expect(drainedBatches.length).toBe(1);
      expect(drainedBatches[0][0].id).toBe('queued-1');

      // Subsequent active transition with empty queue -> does NOT call callback
      if (listener) await listener('active');
      expect(drainedBatches.length).toBe(1);

      unsub();
    });

    test('CHALLENGE-4.4: AppState listener unsubscribe stops further resume draining', async () => {
      const drainedBatches: RawNotificationPayload[][] = [];
      const unsub = bridge.initResumeDrain((notifications) => {
        drainedBatches.push(notifications);
      });

      drainedBatches.length = 0;

      // Unsubscribe immediately
      unsub();

      await bridge.simulateNotification({ id: 'queued-2', title: 'Queued after unsub' });

      const appStateListeners: Array<(state: string) => void> =
        (AppState as any)._listeners || [];

      for (const fn of appStateListeners) {
        if (typeof fn === 'function') await fn('active');
      }

      // Should not have received callback since unsubscribed
      expect(drainedBatches.length).toBe(0);
    });
  });

  // =========================================================================
  // 5. Filter Configuration Edge Cases
  // =========================================================================
  describe('Filter Configuration Boundary Testing', () => {
    test('CHALLENGE-5.1: updateFilterConfig with invalid or null inputs does not crash', async () => {
      await expect(bridge.updateFilterConfig(null as any)).resolves.toBe(true);
      const conf = await bridge.getFilterConfig();
      expect(conf.mode).toBe('blacklist');

      await expect(bridge.updateFilterConfig({} as any)).resolves.toBe(true);
    });

    test('CHALLENGE-5.2: updateFilterConfig sanitizes package lists containing whitespace and empty strings', async () => {
      await bridge.updateFilterConfig({
        mode: 'whitelist',
        packages: ['  ', '', 'com.valid.app', '   com.another.app  ', null as any, 42 as any],
        enableOtpQuarantine: true,
        ignoreOngoing: true,
      });

      const conf = await bridge.getFilterConfig();
      expect(conf.mode).toBe('whitelist');
      expect(conf.packages).toContain('com.valid.app');
      expect(conf.packages).toContain('   com.another.app  ');
      // Empty string and whitespace-only items should be filtered
      expect(conf.packages).not.toContain('');
      expect(conf.packages).not.toContain('  ');
    });
  });
});
