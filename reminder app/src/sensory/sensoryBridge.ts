import { NativeEventEmitter, NativeModules, Platform, AppState, AppStateStatus } from 'react-native';
import {
  SensoryFilterConfig,
  DEFAULT_FILTER_CONFIG,
  validateFilterConfig,
} from './sensoryFilterConfig';
import { RawNotificationPayload, QuarantineStats, ISensoryBridge } from './types';

export { RawNotificationPayload, QuarantineStats, ISensoryBridge };

const EVENT_NOTIFICATION_CAPTURED = 'onNotificationCaptured';

export class SensoryBridgeService implements ISensoryBridge {
  private eventEmitter: NativeEventEmitter | null = null;
  private mockPendingQueue: RawNotificationPayload[] = [];
  private mockQuarantineStats: QuarantineStats = { quarantinedCount: 0, lastQuarantinedAt: null };
  private mockFilterConfig: SensoryFilterConfig = { ...DEFAULT_FILTER_CONFIG };
  private mockListeners: Set<(n: RawNotificationPayload) => void> = new Set();
  private mockDismissedKeys: string[] = [];
  private mockSnoozedKeys: Array<{ key: string; durationMs: number }> = [];
  private mockAutoClearPromos: boolean = true;
  private mockAutoSnoozeNoise: boolean = false;

  constructor() {
    if (Platform.OS === 'android' && NativeModules?.RemySensoryModule) {
      try {
        this.eventEmitter = new NativeEventEmitter(NativeModules.RemySensoryModule);
      } catch {
        this.eventEmitter = null;
      }
    }
  }

  private get module(): any {
    return NativeModules?.RemySensoryModule;
  }

  async isPermissionGranted(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.isPermissionGranted) {
      return false;
    }
    try {
      return await this.module.isPermissionGranted();
    } catch {
      return false;
    }
  }

  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.requestPermission) {
      return false;
    }
    try {
      return await this.module.requestPermission();
    } catch {
      return false;
    }
  }

  async getPendingNotifications(): Promise<RawNotificationPayload[]> {
    if (Platform.OS !== 'android' || !this.module?.getPendingNotifications) {
      return [...this.mockPendingQueue];
    }
    try {
      const res = await this.module.getPendingNotifications();
      if (!res) return [];
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async clearPendingNotifications(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.clearPendingNotifications) {
      this.mockPendingQueue = [];
      return true;
    }
    try {
      return await this.module.clearPendingNotifications();
    } catch {
      return false;
    }
  }

  async drainPendingNotifications(): Promise<RawNotificationPayload[]> {
    if (Platform.OS !== 'android' || !this.module?.drainPendingNotifications) {
      const drained = [...this.mockPendingQueue];
      this.mockPendingQueue = [];
      return drained;
    }
    try {
      const res = await this.module.drainPendingNotifications();
      if (!res) return [];
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async getFilterConfig(): Promise<SensoryFilterConfig> {
    if (Platform.OS !== 'android' || !this.module?.getFilterConfig) {
      return {
        ...this.mockFilterConfig,
        autoClearPromos: this.mockAutoClearPromos,
        autoSnoozeNoise: this.mockAutoSnoozeNoise,
      };
    }
    try {
      const res = await this.module.getFilterConfig();
      const parsed = res ? (typeof res === 'string' ? JSON.parse(res) : res) : {};
      const validated = validateFilterConfig(parsed);
      const autoClear = await this.getAutoClearPromos();
      const autoSnooze = await this.getAutoSnoozeNoise();
      return {
        ...validated,
        autoClearPromos: autoClear,
        autoSnoozeNoise: autoSnooze,
      };
    } catch {
      return {
        ...DEFAULT_FILTER_CONFIG,
        autoClearPromos: await this.getAutoClearPromos(),
        autoSnoozeNoise: await this.getAutoSnoozeNoise(),
      };
    }
  }

  async updateFilterConfig(config: SensoryFilterConfig): Promise<boolean> {
    const validated = validateFilterConfig(config);
    this.mockFilterConfig = validated;
    if (validated.autoClearPromos !== undefined) {
      this.mockAutoClearPromos = validated.autoClearPromos;
    }
    if (validated.autoSnoozeNoise !== undefined) {
      this.mockAutoSnoozeNoise = validated.autoSnoozeNoise;
    }

    if (Platform.OS !== 'android' || !this.module?.updateFilterConfig) {
      return true;
    }
    try {
      return await this.module.updateFilterConfig(JSON.stringify(validated));
    } catch {
      return false;
    }
  }

  async getQuarantineStats(): Promise<QuarantineStats> {
    if (Platform.OS !== 'android' || !this.module?.getQuarantineStats) {
      return { ...this.mockQuarantineStats };
    }
    try {
      const res = await this.module.getQuarantineStats();
      return {
        quarantinedCount: res?.quarantinedCount ?? 0,
        lastQuarantinedAt: res?.lastQuarantinedAt ?? null,
      };
    } catch {
      return { quarantinedCount: 0, lastQuarantinedAt: null };
    }
  }

  async clearQuarantineStats(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.clearQuarantineStats) {
      this.mockQuarantineStats = { quarantinedCount: 0, lastQuarantinedAt: null };
      return true;
    }
    try {
      return await this.module.clearQuarantineStats();
    } catch {
      return false;
    }
  }

  async simulateNotification(
    payload?: Partial<RawNotificationPayload> | null
  ): Promise<{ status: string; reason?: string }> {
    const safePayload = (payload && typeof payload === 'object') ? payload : {};
    const id = safePayload.id ? String(safePayload.id) : `sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const fullPayload: RawNotificationPayload = {
      id,
      key: safePayload.key ? String(safePayload.key) : `key-${id}`,
      packageName: safePayload.packageName ? String(safePayload.packageName) : 'com.simulation.alert',
      title: safePayload.title !== undefined && safePayload.title !== null
        ? (typeof safePayload.title === 'string' ? safePayload.title : String(safePayload.title))
        : '',
      text: safePayload.text !== undefined && safePayload.text !== null
        ? (typeof safePayload.text === 'string' ? safePayload.text : (typeof safePayload.text === 'object' ? JSON.stringify(safePayload.text) : String(safePayload.text)))
        : '',
      subText: safePayload.subText !== undefined && safePayload.subText !== null
        ? (typeof safePayload.subText === 'string' ? safePayload.subText : (typeof safePayload.subText === 'object' ? JSON.stringify(safePayload.subText) : String(safePayload.subText)))
        : null,
      timestamp: typeof safePayload.timestamp === 'number' ? safePayload.timestamp : Date.now(),
      postTime: typeof safePayload.postTime === 'number' ? safePayload.postTime : Date.now(),
    };

    if (Platform.OS !== 'android' || !this.module?.simulateNotification) {
      // Mock / non-Android simulation
      this.mockPendingQueue.push(fullPayload);
      if (this.mockPendingQueue.length > 100) {
        this.mockPendingQueue = this.mockPendingQueue.slice(-100);
      }
      for (const listener of this.mockListeners) {
        try {
          listener(fullPayload);
        } catch (err) {
          console.error('SensoryBridge listener error:', err);
        }
      }
      return { status: 'emitted' };
    }

    try {
      return await this.module.simulateNotification(JSON.stringify(fullPayload));
    } catch (e: any) {
      return { status: 'error', reason: e?.message || 'Simulation error' };
    }
  }

  /**
   * Subscribes to realtime incoming notifications emitted over the bridge.
   * Returns an unsubscribe teardown function.
   */
  onNotification(listener: (notification: RawNotificationPayload) => void): () => void {
    if (this.eventEmitter) {
      const subscription = this.eventEmitter.addListener(
        EVENT_NOTIFICATION_CAPTURED,
        listener
      );
      return () => {
        subscription.remove();
      };
    }

    // Fallback for mock / non-Android environments
    this.mockListeners.add(listener);
    return () => {
      this.mockListeners.delete(listener);
    };
  }

  /**
   * Hooks into AppState changes to drain the buffered SharedPreferences queue
   * whenever the app returns to the foreground ('active').
   */
  initResumeDrain(callback: (notifications: RawNotificationPayload[]) => void): () => void {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const drained = await this.drainPendingNotifications();
        if (drained.length > 0) {
          callback(drained);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Also trigger immediately upon initialization
    this.drainPendingNotifications().then((initial) => {
      if (initial.length > 0) {
        callback(initial);
      }
    });

    return () => {
      subscription.remove();
    };
  }

  /**
   * Actively cancels / dismisses a notification from the Android status bar tray.
   */
  async dismissNotification(key: string): Promise<boolean> {
    if (!key) return false;
    if (Platform.OS !== 'android' || !this.module?.dismissNotification) {
      this.mockDismissedKeys.push(key);
      return true;
    }
    try {
      return await this.module.dismissNotification(key);
    } catch {
      return false;
    }
  }

  /**
   * Snoozes a notification from the Android status bar tray for durationMs (default: 1 hour).
   */
  async snoozeNotification(key: string, durationMs: number = 3600000): Promise<boolean> {
    if (!key) return false;
    if (Platform.OS !== 'android' || !this.module?.snoozeNotification) {
      this.mockSnoozedKeys.push({ key, durationMs });
      return true;
    }
    try {
      return await this.module.snoozeNotification(key, durationMs);
    } catch {
      return false;
    }
  }

  /**
   * Dismisses all notifications from the status bar tray.
   */
  async dismissAllNotifications(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.dismissAllNotifications) {
      this.mockDismissedKeys.push('*all*');
      return true;
    }
    try {
      return await this.module.dismissAllNotifications();
    } catch {
      return false;
    }
  }

  /**
   * Enables or disables auto-clearing promotional notifications once stored to Deals Radar.
   */
  async setAutoClearPromos(enabled: boolean): Promise<boolean> {
    this.mockAutoClearPromos = enabled;
    this.mockFilterConfig = { ...this.mockFilterConfig, autoClearPromos: enabled };
    if (Platform.OS !== 'android' || !this.module?.setAutoClearPromos) {
      return true;
    }
    try {
      return await this.module.setAutoClearPromos(enabled);
    } catch {
      return false;
    }
  }

  /**
   * Checks whether auto-clearing promotional notifications is enabled.
   */
  async getAutoClearPromos(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.getAutoClearPromos) {
      return this.mockAutoClearPromos;
    }
    try {
      return await this.module.getAutoClearPromos();
    } catch {
      return this.mockAutoClearPromos;
    }
  }

  /**
   * Enables or disables auto-snoozing noise alerts.
   */
  async setAutoSnoozeNoise(enabled: boolean): Promise<boolean> {
    this.mockAutoSnoozeNoise = enabled;
    this.mockFilterConfig = { ...this.mockFilterConfig, autoSnoozeNoise: enabled };
    if (Platform.OS !== 'android' || !this.module?.setAutoSnoozeNoise) {
      return true;
    }
    try {
      return await this.module.setAutoSnoozeNoise(enabled);
    } catch {
      return false;
    }
  }

  /**
   * Checks whether auto-snoozing noise alerts is enabled.
   */
  async getAutoSnoozeNoise(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.getAutoSnoozeNoise) {
      return this.mockAutoSnoozeNoise;
    }
    try {
      return await this.module.getAutoSnoozeNoise();
    } catch {
      return this.mockAutoSnoozeNoise;
    }
  }

  getMockDismissedKeys(): string[] {
    return [...this.mockDismissedKeys];
  }

  getMockSnoozedKeys(): Array<{ key: string; durationMs: number }> {
    return [...this.mockSnoozedKeys];
  }

  clearMockTray(): void {
    this.mockDismissedKeys = [];
    this.mockSnoozedKeys = [];
  }
}

export const sensoryBridge = new SensoryBridgeService();
