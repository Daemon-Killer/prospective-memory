import { NativeModules, Platform } from 'react-native';

export interface PendingCaptureItem {
  id: string;
  title: string;
  dueDate: string;
  armed: boolean;
  createdAt?: string;
  status?: string;
  inkData?: string | null;
}

export interface IRemyCaptureService {
  canDrawOverlays(): Promise<boolean>;
  requestOverlayPermission(): Promise<boolean>;
  startBubble(): Promise<boolean>;
  stopBubble(): Promise<boolean>;
  isBubbleRunning(): Promise<boolean>;
  getSharedText(): Promise<string | null>;
  clearSharedText(): Promise<boolean>;
  getPendingCaptures(): Promise<PendingCaptureItem[]>;
  clearPendingCaptures(): Promise<boolean>;
  syncCloudConfig(apiUrl: string, token: string): Promise<boolean>;
  setLingoTable(lingo: string): Promise<boolean>;
  getLingoTable(): Promise<string | null>;
}

export class RemyCaptureService implements IRemyCaptureService {
  private get module(): any {
    return NativeModules?.RemyCaptureModule;
  }

  async canDrawOverlays(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.canDrawOverlays) {
      return false;
    }
    try {
      return await this.module.canDrawOverlays();
    } catch {
      return false;
    }
  }

  async requestOverlayPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.requestOverlayPermission) {
      return false;
    }
    try {
      return await this.module.requestOverlayPermission();
    } catch {
      return false;
    }
  }

  async startBubble(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.startBubble) {
      return false;
    }
    try {
      return await this.module.startBubble();
    } catch {
      return false;
    }
  }

  async stopBubble(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.stopBubble) {
      return false;
    }
    try {
      return await this.module.stopBubble();
    } catch {
      return false;
    }
  }

  async isBubbleRunning(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.isBubbleRunning) {
      return false;
    }
    try {
      return await this.module.isBubbleRunning();
    } catch {
      return false;
    }
  }

  async getSharedText(): Promise<string | null> {
    if (Platform.OS !== 'android' || !this.module?.getSharedText) {
      return null;
    }
    try {
      return await this.module.getSharedText();
    } catch {
      return null;
    }
  }

  async clearSharedText(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.clearSharedText) {
      return false;
    }
    try {
      return await this.module.clearSharedText();
    } catch {
      return false;
    }
  }

  async getPendingCaptures(): Promise<PendingCaptureItem[]> {
    if (Platform.OS !== 'android' || !this.module?.getPendingCaptures) {
      return [];
    }
    try {
      const res = await this.module.getPendingCaptures();
      if (!res) return [];
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async clearPendingCaptures(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.clearPendingCaptures) {
      return false;
    }
    try {
      return await this.module.clearPendingCaptures();
    } catch {
      return false;
    }
  }

  async syncCloudConfig(apiUrl: string, token: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.syncCloudConfig) {
      return false;
    }
    try {
      return await this.module.syncCloudConfig(apiUrl, token);
    } catch {
      return false;
    }
  }

  async setLingoTable(lingo: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.module?.setLingoTable) {
      return false;
    }
    try {
      return await this.module.setLingoTable(lingo);
    } catch {
      return false;
    }
  }

  async getLingoTable(): Promise<string | null> {
    if (Platform.OS !== 'android' || !this.module?.getLingoTable) {
      return null;
    }
    try {
      return await this.module.getLingoTable();
    } catch {
      return null;
    }
  }
}

export const remyCaptureService = new RemyCaptureService();


