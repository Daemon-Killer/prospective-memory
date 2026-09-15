import { NativeEventEmitter, NativeModules, Platform, AppState, AppStateStatus } from 'react-native';
import {
  SensoryFilterConfig,
  DEFAULT_FILTER_CONFIG,
  validateFilterConfig,
} from './sensoryFilterConfig';
import { RawNotificationPayload } from './types';

export { RawNotificationPayload };

export interface QuarantineStats {
  quarantinedCount: number;
  lastQuarantinedAt: number | null;
}

export interface ISensoryBridge {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getPendingNotifications(): Promise<RawNotificationPayload[]>;
  clearPendingNotifications(): Promise<boolean>;
  drainPendingNotifications(): Promise<RawNotificationPayload[]>;
  getFilterConfig(): Promise<SensoryFilterConfig>;
  updateFilterConfig(config: SensoryFilterConfig): Promise<boolean>;
  getQuarantineStats(): Promise<QuarantineStats>;
  clearQuarantineStats(): Promise<boolean>;
  simulateNotification(payload?: Partial<RawNotificationPayload> | null): Promise<{ status: string; reason?: string }>;
  onNotification(listener: (notification: RawNotificationPayload) => void): () => void;
  initResumeDrain(callback: (notifications: RawNotificationPayload[]) => void): () => void;
}

const EVENT_NOTIFICATION_CAPTURED = 'onNotificationCaptured';

export class SensoryBridgeService implements ISensoryBridge {
  private eventEmitter: NativeEventEmitter | null = null;
  private mockPendingQueue: RawNotificationPayload[] = [];
  private mockQuarantineStats: QuarantineStats = { quarantinedCount: 0, lastQuarantinedAt: null };
  private mockFilterConfig: SensoryFilterConfig = { ...DEFAULT_FILTER_CONFIG };
  private mockListeners: Set<(n: RawNotificationPayload) => void> = new Set();

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
      return { ...this.mockFilterConfig };
    }
    try {
      const res = await this.module.getFilterConfig();
      if (!res) return { ...DEFAULT_FILTER_CONFIG };
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      return validateFilterConfig(parsed);
    } catch {
      return { ...DEFAULT_FILTER_CONFIG };
    }
  }

  async updateFilterConfig(config: SensoryFilterConfig): Promise<boolean> {
    const validated = validateFilterConfig(config);
    if (Platform.OS !== 'android' || !this.module?.updateFilterConfig) {
      this.mockFilterConfig = validated;
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
    const fullPayload: RawNotificationPayload = {
      id: safePayload.id ? String(safePayload.id) : `sim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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
}

export const sensoryBridge = new SensoryBridgeService();
