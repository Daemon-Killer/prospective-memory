import { AppState } from 'react-native';
import { sensoryBridge, SensoryBridgeService, RawNotificationPayload } from '../src/sensory';

describe('Remy Notification Sensory Engine - Sensory Bridge', () => {
  beforeEach(async () => {
    await sensoryBridge.clearPendingNotifications();
    await sensoryBridge.clearQuarantineStats();
  });

  describe('Permission Handlers', () => {
    test('isPermissionGranted returns boolean safely without throwing', async () => {
      const granted = await sensoryBridge.isPermissionGranted();
      expect(typeof granted).toBe('boolean');
    });

    test('requestPermission returns boolean safely without throwing', async () => {
      const result = await sensoryBridge.requestPermission();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Notification Queue & Drain Pipeline', () => {
    test('enqueues simulated notification and drains atomically', async () => {
      const simPayload: Partial<RawNotificationPayload> = {
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Your food is arriving in 10 mins!',
      };

      const simResult = await sensoryBridge.simulateNotification(simPayload);
      expect(simResult.status).toBe('emitted');

      const pendingBefore = await sensoryBridge.getPendingNotifications();
      expect(pendingBefore.length).toBe(1);
      expect(pendingBefore[0].packageName).toBe('com.swiggy.android');
      expect(pendingBefore[0].text).toContain('arriving in 10 mins');

      // Atomic drain purges the queue and returns buffered records
      const drained = await sensoryBridge.drainPendingNotifications();
      expect(drained.length).toBe(1);
      expect(drained[0].packageName).toBe('com.swiggy.android');

      // Queue is now empty
      const pendingAfter = await sensoryBridge.getPendingNotifications();
      expect(pendingAfter.length).toBe(0);
    });

    test('clearPendingNotifications purges queue manually', async () => {
      await sensoryBridge.simulateNotification({
        title: 'Zomato',
        text: 'Use code TASTY50',
      });
      let pending = await sensoryBridge.getPendingNotifications();
      expect(pending.length).toBe(1);

      const cleared = await sensoryBridge.clearPendingNotifications();
      expect(cleared).toBe(true);

      pending = await sensoryBridge.getPendingNotifications();
      expect(pending.length).toBe(0);
    });
  });

  describe('Filter Configuration Bridge', () => {
    test('reads default filter config and updates dynamically', async () => {
      const initialConfig = await sensoryBridge.getFilterConfig();
      expect(initialConfig.mode).toBe('blacklist');
      expect(Array.isArray(initialConfig.packages)).toBe(true);

      const updated = await sensoryBridge.updateFilterConfig({
        mode: 'whitelist',
        packages: ['com.swiggy.android'],
        enableOtpQuarantine: true,
        ignoreOngoing: true,
      });
      expect(updated).toBe(true);

      const fetchedConfig = await sensoryBridge.getFilterConfig();
      expect(fetchedConfig.mode).toBe('whitelist');
      expect(fetchedConfig.packages).toEqual(['com.swiggy.android']);
    });
  });

  describe('Quarantine Statistics', () => {
    test('reads and clears quarantine statistics', async () => {
      const stats = await sensoryBridge.getQuarantineStats();
      expect(typeof stats.quarantinedCount).toBe('number');

      const cleared = await sensoryBridge.clearQuarantineStats();
      expect(cleared).toBe(true);
      const afterClear = await sensoryBridge.getQuarantineStats();
      expect(afterClear.quarantinedCount).toBe(0);
    });
  });

  describe('Active Notification Tray Management', () => {
    beforeEach(() => {
      if (typeof sensoryBridge.clearMockTray === 'function') {
        sensoryBridge.clearMockTray();
      }
    });

    test('dismissNotification records dismissed key', async () => {
      const result = await sensoryBridge.dismissNotification('0|com.swiggy.android|101|null|10001');
      expect(result).toBe(true);
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain('0|com.swiggy.android|101|null|10001');
      }
    });

    test('snoozeNotification records snoozed key with durationMs', async () => {
      const result = await sensoryBridge.snoozeNotification('0|com.zomato.android|102|null|10002', 1800000);
      expect(result).toBe(true);
      if (sensoryBridge.getMockSnoozedKeys) {
        const snoozed = sensoryBridge.getMockSnoozedKeys();
        expect(snoozed).toEqual(
          expect.arrayContaining([
            { key: '0|com.zomato.android|102|null|10002', durationMs: 1800000 },
          ])
        );
      }
    });

    test('dismissAllNotifications clears all status bar notifications', async () => {
      const result = await sensoryBridge.dismissAllNotifications();
      expect(result).toBe(true);
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain('*all*');
      }
    });

    test('setAutoClearPromos and getAutoClearPromos toggle preferences', async () => {
      await sensoryBridge.setAutoClearPromos(false);
      expect(await sensoryBridge.getAutoClearPromos()).toBe(false);

      await sensoryBridge.setAutoClearPromos(true);
      expect(await sensoryBridge.getAutoClearPromos()).toBe(true);
    });

    test('setAutoSnoozeNoise and getAutoSnoozeNoise toggle preferences', async () => {
      await sensoryBridge.setAutoSnoozeNoise(true);
      expect(await sensoryBridge.getAutoSnoozeNoise()).toBe(true);

      await sensoryBridge.setAutoSnoozeNoise(false);
      expect(await sensoryBridge.getAutoSnoozeNoise()).toBe(false);
    });

    test('simulateNotification attaches notification key if omitted', async () => {
      await sensoryBridge.simulateNotification({
        title: 'Deal Alert',
        text: '50% off with DEAL50',
      });
      const pending = await sensoryBridge.getPendingNotifications();
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].key).toBeDefined();
      expect(typeof pending[0].key).toBe('string');
    });
  });

  describe('Event Listeners & Lifecycle Hooks', () => {
    test('onNotification listener receives live emitted notifications and unsubscribes cleanly', async () => {
      const received: RawNotificationPayload[] = [];
      const unsubscribe = sensoryBridge.onNotification((notification) => {
        received.push(notification);
      });

      await sensoryBridge.simulateNotification({
        title: 'Alert 1',
        text: 'First test notification',
      });
      expect(received.length).toBe(1);
      expect(received[0].title).toBe('Alert 1');

      // Unsubscribe listener
      unsubscribe();

      await sensoryBridge.simulateNotification({
        title: 'Alert 2',
        text: 'Second test notification',
      });
      // Should not have received the second alert
      expect(received.length).toBe(1);
    });

    test('initResumeDrain auto-drains notifications when AppState becomes active', async () => {
      const drainedBatches: RawNotificationPayload[][] = [];
      const unsubscribe = sensoryBridge.initResumeDrain((notifications) => {
        drainedBatches.push(notifications);
      });

      // Clear any initial drain triggered at mount
      drainedBatches.length = 0;

      // Buffer a notification
      await sensoryBridge.simulateNotification({
        title: 'Background Alert',
        text: 'Arrived while sleeping',
      });

      // Extract the change listener registered by initResumeDrain on AppState
      const addListenerMock = AppState.addEventListener as jest.Mock;
      const changeCall = addListenerMock.mock.calls
        .slice()
        .reverse()
        .find((call) => call[0] === 'change');
      const listener = changeCall ? changeCall[1] : null;
      expect(typeof listener).toBe('function');

      // Simulate app foregrounding (AppState -> 'active')
      if (listener) {
        await listener('active');
      }

      // Assert that the buffered notification was drained and delivered to callback
      expect(drainedBatches.length).toBe(1);
      expect(drainedBatches[0][0].title).toBe('Background Alert');

      // Assert queue is now empty
      const pendingAfter = await sensoryBridge.getPendingNotifications();
      expect(pendingAfter.length).toBe(0);

      unsubscribe();
    });
  });
});
