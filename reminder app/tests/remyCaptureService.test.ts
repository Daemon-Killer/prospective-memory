import { NativeModules, Platform } from 'react-native';
import { remyCaptureService } from '../src/services/remyCaptureService';

describe('remyCaptureService', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  describe('web and non-android fallback', () => {
    beforeEach(() => {
      Platform.OS = 'web';
    });

    it('returns false for canDrawOverlays on non-Android', async () => {
      expect(await remyCaptureService.canDrawOverlays()).toBe(false);
    });

    it('returns false for requestOverlayPermission on non-Android', async () => {
      expect(await remyCaptureService.requestOverlayPermission()).toBe(false);
    });

    it('returns false for startBubble on non-Android', async () => {
      expect(await remyCaptureService.startBubble()).toBe(false);
    });

    it('returns false for stopBubble on non-Android', async () => {
      expect(await remyCaptureService.stopBubble()).toBe(false);
    });

    it('returns false for isBubbleRunning on non-Android', async () => {
      expect(await remyCaptureService.isBubbleRunning()).toBe(false);
    });

    it('returns null for getSharedText on non-Android', async () => {
      expect(await remyCaptureService.getSharedText()).toBeNull();
    });

    it('returns empty array for getPendingCaptures on non-Android', async () => {
      expect(await remyCaptureService.getPendingCaptures()).toEqual([]);
    });

    it('returns false for clearPendingCaptures on non-Android', async () => {
      expect(await remyCaptureService.clearPendingCaptures()).toBe(false);
    });

    it('returns false for syncCloudConfig on non-Android', async () => {
      expect(await remyCaptureService.syncCloudConfig('https://api', 'token')).toBe(false);
    });

    it('returns false for setLingoTable on non-Android', async () => {
      expect(await remyCaptureService.setLingoTable('d=dahi lena')).toBe(false);
    });

    it('returns null for getLingoTable on non-Android', async () => {
      expect(await remyCaptureService.getLingoTable()).toBeNull();
    });
  });

  describe('Android with RemyCaptureModule mock', () => {
    beforeEach(() => {
      Platform.OS = 'android';
      NativeModules.RemyCaptureModule = {
        canDrawOverlays: jest.fn().mockResolvedValue(true),
        requestOverlayPermission: jest.fn().mockResolvedValue(true),
        startBubble: jest.fn().mockResolvedValue(true),
        stopBubble: jest.fn().mockResolvedValue(true),
        isBubbleRunning: jest.fn().mockResolvedValue(true),
        getSharedText: jest.fn().mockResolvedValue('Shared thought from browser'),
        clearSharedText: jest.fn().mockResolvedValue(true),
        getPendingCaptures: jest.fn().mockResolvedValue(
          JSON.stringify([
            { id: 'p-1', title: 'call mom', dueDate: '2026-09-14T09:00:00.000Z', armed: true },
          ])
        ),
        clearPendingCaptures: jest.fn().mockResolvedValue(true),
        syncCloudConfig: jest.fn().mockResolvedValue(true),
        setLingoTable: jest.fn().mockResolvedValue(true),
        getLingoTable: jest.fn().mockResolvedValue('d=dahi lena'),
      };
    });

    it('delegates canDrawOverlays to native module', async () => {
      const allowed = await remyCaptureService.canDrawOverlays();
      expect(allowed).toBe(true);
      expect(NativeModules.RemyCaptureModule.canDrawOverlays).toHaveBeenCalled();
    });

    it('delegates requestOverlayPermission to native module', async () => {
      const requested = await remyCaptureService.requestOverlayPermission();
      expect(requested).toBe(true);
      expect(NativeModules.RemyCaptureModule.requestOverlayPermission).toHaveBeenCalled();
    });

    it('delegates startBubble and stopBubble to native module', async () => {
      expect(await remyCaptureService.startBubble()).toBe(true);
      expect(NativeModules.RemyCaptureModule.startBubble).toHaveBeenCalled();

      expect(await remyCaptureService.stopBubble()).toBe(true);
      expect(NativeModules.RemyCaptureModule.stopBubble).toHaveBeenCalled();
    });

    it('delegates isBubbleRunning to native module', async () => {
      expect(await remyCaptureService.isBubbleRunning()).toBe(true);
      expect(NativeModules.RemyCaptureModule.isBubbleRunning).toHaveBeenCalled();
    });

    it('retrieves and clears incoming shared text', async () => {
      const text = await remyCaptureService.getSharedText();
      expect(text).toBe('Shared thought from browser');
      expect(NativeModules.RemyCaptureModule.getSharedText).toHaveBeenCalled();

      const cleared = await remyCaptureService.clearSharedText();
      expect(cleared).toBe(true);
      expect(NativeModules.RemyCaptureModule.clearSharedText).toHaveBeenCalled();
    });

    it('retrieves and clears pending captures from lockscreen queue', async () => {
      const pending = await remyCaptureService.getPendingCaptures();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('call mom');
      expect(pending[0].armed).toBe(true);
      expect(NativeModules.RemyCaptureModule.getPendingCaptures).toHaveBeenCalled();

      const cleared = await remyCaptureService.clearPendingCaptures();
      expect(cleared).toBe(true);
      expect(NativeModules.RemyCaptureModule.clearPendingCaptures).toHaveBeenCalled();
    });

    it('syncs cloud config and lingo table to native module', async () => {
      expect(await remyCaptureService.syncCloudConfig('https://api', 'token')).toBe(true);
      expect(NativeModules.RemyCaptureModule.syncCloudConfig).toHaveBeenCalledWith('https://api', 'token');

      expect(await remyCaptureService.setLingoTable('d=dahi lena')).toBe(true);
      expect(NativeModules.RemyCaptureModule.setLingoTable).toHaveBeenCalledWith('d=dahi lena');

      expect(await remyCaptureService.getLingoTable()).toBe('d=dahi lena');
      expect(NativeModules.RemyCaptureModule.getLingoTable).toHaveBeenCalled();
    });

    it('handles native module rejections gracefully without throwing', async () => {
      NativeModules.RemyCaptureModule.canDrawOverlays = jest
        .fn()
        .mockRejectedValue(new Error('Permission IPC error'));
      expect(await remyCaptureService.canDrawOverlays()).toBe(false);

      NativeModules.RemyCaptureModule.getSharedText = jest
        .fn()
        .mockRejectedValue(new Error('IPC read error'));
      expect(await remyCaptureService.getSharedText()).toBeNull();

      NativeModules.RemyCaptureModule.getPendingCaptures = jest
        .fn()
        .mockRejectedValue(new Error('Queue read error'));
      expect(await remyCaptureService.getPendingCaptures()).toEqual([]);
    });
  });
});
