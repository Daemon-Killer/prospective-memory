import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CloudSyncService,
  DEFAULT_API_URL,
  DEFAULT_TOKEN,
} from '../src/services/cloudSyncService';
import { storageService } from '../src/services/storageService';

describe('CloudSyncService', () => {
  let service: CloudSyncService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await storageService.clear();
    await storageService.init();

    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    service = new CloudSyncService();
  });

  afterEach(() => {
    service.destroy();
    jest.restoreAllMocks();
  });

  function mockSyncResponse(synced: unknown[] = [], serverSyncTime = '2026-09-12T12:00:00.000Z') {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ synced, serverSyncTime }),
      text: async () => JSON.stringify({ synced, serverSyncTime }),
    });
  }

  it('posts local reminders including tombstones to the Render sync endpoint', async () => {
    mockSyncResponse([]);
    await service.init();

    const created = await storageService.create({
      title: 'Buy milk',
      dueDate: '2026-09-12T18:00:00.000Z',
    });
    await storageService.delete(created.id);

    const result = await service.syncNow();
    expect(result.success).toBe(true);

    expect(fetchMock).toHaveBeenCalled();
    const [url, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe(`${DEFAULT_API_URL}/v1/reminders/sync`);
    expect(options.method).toBe('POST');
    expect(options.headers['X-PMEM-TOKEN']).toBe(DEFAULT_TOKEN);

    const body = JSON.parse(options.body);
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0].id).toBe(created.id);
    expect(body.reminders[0].isDeleted).toBe(true);
    expect(body.reminders[0].notificationId).toBeUndefined();
  });

  it('applies remote upserts without looping through mutation listeners', async () => {
    mockSyncResponse([
      {
        id: 'srv-1',
        title: 'From cloud',
        notes: null,
        dueDate: '2026-09-12T15:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        lastSnoozedAt: null,
        createdAt: '2026-09-12T10:00:00.000Z',
        updatedAt: '2026-09-12T10:00:00.000Z',
        completedAt: null,
        isDeleted: false,
      },
    ]);

    const mutation = jest.fn();
    storageService.onMutation(mutation);
    await service.init();
    mutation.mockClear();

    const result = await service.syncNow();
    expect(result.success).toBe(true);
    expect(result.syncedCount).toBe(1);
    expect(storageService.getById('srv-1')?.title).toBe('From cloud');
    expect(mutation).not.toHaveBeenCalled();
  });

  it('returns an error and keeps local data when the server rejects the token', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'missing or bad X-PMEM-TOKEN' }),
      text: async () => 'missing or bad X-PMEM-TOKEN',
    });

    await service.init();
    const created = await storageService.create({
      title: 'Offline capture',
      dueDate: '2026-09-12T18:00:00.000Z',
    });

    const result = await service.syncNow();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/401/);
    expect(service.getState()).toBe('error');
    expect(storageService.getById(created.id)?.title).toBe('Offline capture');
  });

  it('can be disabled from cloud settings', async () => {
    await service.init();
    await service.updateConfig({ enabled: false });
    const result = await service.syncNow();
    expect(result.success).toBe(false);
    expect(service.getState()).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forceFullSync resets lastSyncTime and sends clientSyncTime as null', async () => {
    mockSyncResponse([], '2026-09-12T12:00:00.000Z');
    await service.init();

    await service.syncNow();
    expect(service.getConfig().lastSyncTime).toBe('2026-09-12T12:00:00.000Z');

    await storageService.create({
      title: 'Existing item',
      dueDate: '2026-09-12T18:00:00.000Z',
    });

    mockSyncResponse(
      [
        {
          id: 'full-sync-item',
          title: 'Full sync recovered item',
          dueDate: '2026-09-12T19:00:00.000Z',
          status: 'pending',
          snoozeCount: 0,
          createdAt: '2026-09-12T10:00:00.000Z',
          updatedAt: '2026-09-12T10:00:00.000Z',
        },
      ],
      '2026-09-12T13:00:00.000Z'
    );

    const fullResult = await service.forceFullSync();
    expect(fullResult.success).toBe(true);
    expect(fullResult.syncedCount).toBe(1);

    const [, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const body = JSON.parse(options.body);
    expect(body.clientSyncTime).toBeNull();
    expect(storageService.getById('full-sync-item')?.title).toBe('Full sync recovered item');
  });

  it('automatically performs full sync when local storage cache is empty', async () => {
    mockSyncResponse([
      {
        id: 'srv-empty-fallback',
        title: 'Hydrated item',
        dueDate: '2026-09-12T19:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-12T10:00:00.000Z',
        updatedAt: '2026-09-12T10:00:00.000Z',
      },
    ]);

    await service.init();
    expect(storageService.getAll()).toHaveLength(0);

    await service.syncNow();
    const [, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const body = JSON.parse(options.body);
    expect(body.clientSyncTime).toBeNull();
    expect(storageService.getById('srv-empty-fallback')?.title).toBe('Hydrated item');
  });
});
