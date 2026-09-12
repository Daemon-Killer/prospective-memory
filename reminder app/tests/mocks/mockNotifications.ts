/**
 * Zero-dependency In-Memory Mock for expo-notifications and expo-task-manager
 * For use in Jest tests without native binaries or Metro bundling.
 * Location: tests/mocks/mockNotifications.ts
 */

export interface MockScheduledNotification {
  identifier: string;
  content: {
    title: string | null;
    body: string | null;
    categoryIdentifier: string | null;
    data: Record<string, any>;
    sound?: string | boolean | null;
    badge?: number | null;
  };
  trigger: {
    date: Date | number;
    type?: string;
    channelId?: string;
  };
}

export interface MockNotificationChannel {
  id: string;
  name: string | null;
  importance: number;
  vibrationPattern?: number[] | null;
  sound?: string | null;
  enableVibrate?: boolean;
  enableLights?: boolean;
  lightColor?: string;
  showBadge?: boolean;
  bypassDnd?: boolean;
  description?: string | null;
  lockscreenVisibility?: number;
}

export interface MockNotificationCategory {
  identifier: string;
  actions: Array<{
    identifier: string;
    buttonTitle: string;
    options?: {
      opensAppToForeground?: boolean;
      isDestructive?: boolean;
      isAuthenticationRequired?: boolean;
    };
  }>;
  options?: Record<string, any>;
}

export interface MockNotificationResponse {
  actionIdentifier: string;
  userText?: string;
  notification: {
    date: number;
    request: {
      identifier: string;
      content: {
        title: string | null;
        body: string | null;
        categoryIdentifier: string | null;
        data: Record<string, any>;
      };
      trigger: any;
    };
  };
}

export enum MockBackgroundNotificationTaskResult {
  NewData = 0,
  NoData = 1,
  Failed = 2,
}

export class MockExpoNotifications {
  public AndroidImportance = {
    UNKNOWN: 0,
    UNSPECIFIED: 1,
    NONE: 2,
    MIN: 3,
    LOW: 4,
    DEFAULT: 5,
    HIGH: 6,
    MAX: 7,
  };

  public AndroidNotificationPriority = {
    MIN: 'min',
    LOW: 'low',
    DEFAULT: 'default',
    HIGH: 'high',
    MAX: 'max',
  };

  public SchedulableTriggerInputTypes = {
    DATE: 'date',
    TIME_INTERVAL: 'timeInterval',
    CALENDAR: 'calendar',
  };

  public DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

  public BackgroundNotificationTaskResult = {
    NewData: 0,
    NoData: 1,
    Failed: 2,
  };

  // Internal state stores
  private permissionsGranted = true;
  private permissionStatus: 'granted' | 'denied' | 'undetermined' = 'granted';
  private channels: Map<string, MockNotificationChannel> = new Map();
  private categories: Map<string, MockNotificationCategory> = new Map();
  private scheduled: Map<string, MockScheduledNotification> = new Map();
  private responseListeners: Set<(response: MockNotificationResponse) => void> = new Set();
  private notificationReceivedListeners: Set<(notification: any) => void> = new Set();
  private registeredTaskName: string | null = null;
  private lastNotificationResponse: MockNotificationResponse | null = null;
  private nextId = 1;

  // Jest Spies
  public getPermissionsAsync = jest.fn(async () => ({
    status: this.permissionStatus,
    granted: this.permissionsGranted,
    canAskAgain: true,
    expires: 'never',
  }));

  public requestPermissionsAsync = jest.fn(async () => ({
    status: this.permissionStatus,
    granted: this.permissionsGranted,
    canAskAgain: true,
    expires: 'never',
  }));

  public setNotificationChannelAsync = jest.fn(async (channelId: string, channelConfiguration: any) => {
    const channel: MockNotificationChannel = {
      id: channelId,
      ...channelConfiguration,
    };
    this.channels.set(channelId, channel);
    return channel;
  });

  public getNotificationChannelAsync = jest.fn(async (channelId: string) => {
    return this.channels.get(channelId) ?? null;
  });

  public getNotificationChannelsAsync = jest.fn(async () => {
    return Array.from(this.channels.values());
  });

  public deleteNotificationChannelAsync = jest.fn(async (channelId: string) => {
    this.channels.delete(channelId);
  });

  public setNotificationCategoryAsync = jest.fn(async (identifier: string, actions: any[], options?: any) => {
    const category: MockNotificationCategory = {
      identifier,
      actions,
      options,
    };
    this.categories.set(identifier, category);
    return category;
  });

  public getNotificationCategoriesAsync = jest.fn(async () => {
    return Array.from(this.categories.values());
  });

  public deleteNotificationCategoryAsync = jest.fn(async (identifier: string) => {
    return this.categories.delete(identifier);
  });

  public scheduleNotificationAsync = jest.fn(async (request: {
    content: {
      title?: string | null;
      body?: string | null;
      categoryIdentifier?: string | null;
      data?: Record<string, any>;
      sound?: string | boolean | null;
    };
    trigger: {
      date?: Date | number;
      type?: string;
      channelId?: string;
    };
  }): Promise<string> => {
    if (!this.permissionsGranted) {
      throw new Error('Notification permissions not granted');
    }

    const identifier = `mock_notif_${this.nextId++}_${Date.now()}`;
    const scheduledItem: MockScheduledNotification = {
      identifier,
      content: {
        title: request.content.title ?? null,
        body: request.content.body ?? null,
        categoryIdentifier: request.content.categoryIdentifier ?? null,
        data: request.content.data ?? {},
        sound: request.content.sound,
      },
      trigger: {
        date: request.trigger.date ?? Date.now(),
        type: request.trigger.type,
        channelId: request.trigger.channelId,
      },
    };

    this.scheduled.set(identifier, scheduledItem);
    return identifier;
  });

  public cancelScheduledNotificationAsync = jest.fn(async (identifier: string): Promise<void> => {
    this.scheduled.delete(identifier);
  });

  public cancelAllScheduledNotificationsAsync = jest.fn(async (): Promise<void> => {
    this.scheduled.clear();
  });

  public getAllScheduledNotificationsAsync = jest.fn(async (): Promise<MockScheduledNotification[]> => {
    return Array.from(this.scheduled.values());
  });

  public addNotificationResponseReceivedListener = jest.fn((listener: (response: MockNotificationResponse) => void) => {
    this.responseListeners.add(listener);
    return {
      remove: jest.fn(() => {
        this.responseListeners.delete(listener);
      }),
    };
  });

  public addNotificationReceivedListener = jest.fn((listener: (notification: any) => void) => {
    this.notificationReceivedListeners.add(listener);
    return {
      remove: jest.fn(() => {
        this.notificationReceivedListeners.delete(listener);
      }),
    };
  });

  public registerTaskAsync = jest.fn(async (taskName: string): Promise<null> => {
    this.registeredTaskName = taskName;
    return null;
  });

  public unregisterTaskAsync = jest.fn(async (taskName: string): Promise<null> => {
    if (this.registeredTaskName === taskName) {
      this.registeredTaskName = null;
    }
    return null;
  });

  public setNotificationHandler = jest.fn();

  public getLastNotificationResponseAsync = jest.fn(async (): Promise<MockNotificationResponse | null> => {
    return this.lastNotificationResponse;
  });

  public clearLastNotificationResponseAsync = jest.fn(async (): Promise<void> => {
    this.lastNotificationResponse = null;
  });

  // Test Simulation Helpers
  public __setPermissions(
    granted: boolean,
    status: 'granted' | 'denied' | 'undetermined' = granted ? 'granted' : 'denied'
  ): void {
    this.permissionsGranted = granted;
    this.permissionStatus = status;
  }

  public __getScheduled(): MockScheduledNotification[] {
    return Array.from(this.scheduled.values());
  }

  public __getScheduledForReminder(reminderId: string): MockScheduledNotification[] {
    return Array.from(this.scheduled.values()).filter(
      (item) => item.content.data?.reminderId === reminderId
    );
  }

  public __getRegisteredCategories(): MockNotificationCategory[] {
    return Array.from(this.categories.values());
  }

  public __getChannels(): MockNotificationChannel[] {
    return Array.from(this.channels.values());
  }

  public __getRegisteredTaskName(): string | null {
    return this.registeredTaskName;
  }

  public __setLastNotificationResponse(response: MockNotificationResponse | null): void {
    this.lastNotificationResponse = response;
  }

  public async __triggerNotificationResponse(response: MockNotificationResponse): Promise<void> {
    for (const listener of Array.from(this.responseListeners)) {
      await listener(response);
    }
  }

  public async __triggerNotificationReceived(notification: any): Promise<void> {
    for (const listener of Array.from(this.notificationReceivedListeners)) {
      await listener(notification);
    }
  }

  public __reset(): void {
    this.permissionsGranted = true;
    this.permissionStatus = 'granted';
    this.channels.clear();
    this.categories.clear();
    this.scheduled.clear();
    this.responseListeners.clear();
    this.notificationReceivedListeners.clear();
    this.registeredTaskName = null;
    this.lastNotificationResponse = null;
    this.nextId = 1;

    this.getPermissionsAsync.mockClear();
    this.requestPermissionsAsync.mockClear();
    this.setNotificationChannelAsync.mockClear();
    this.getNotificationChannelAsync.mockClear();
    this.getNotificationChannelsAsync.mockClear();
    this.deleteNotificationChannelAsync.mockClear();
    this.setNotificationCategoryAsync.mockClear();
    this.getNotificationCategoriesAsync.mockClear();
    this.deleteNotificationCategoryAsync.mockClear();
    this.scheduleNotificationAsync.mockClear();
    this.cancelScheduledNotificationAsync.mockClear();
    this.cancelAllScheduledNotificationsAsync.mockClear();
    this.getAllScheduledNotificationsAsync.mockClear();
    this.addNotificationResponseReceivedListener.mockClear();
    this.addNotificationReceivedListener.mockClear();
    this.registerTaskAsync.mockClear();
    this.unregisterTaskAsync.mockClear();
    this.setNotificationHandler.mockClear();
    this.getLastNotificationResponseAsync.mockClear();
    this.clearLastNotificationResponseAsync.mockClear();
  }
}

export class MockTaskManager {
  private taskExecutors: Map<string, (body: any) => Promise<any>> = new Map();

  public defineTask = jest.fn((taskName: string, executor: (body: any) => Promise<any>) => {
    this.taskExecutors.set(taskName, executor);
  });

  public isTaskDefined = jest.fn((taskName: string): boolean => {
    return this.taskExecutors.has(taskName);
  });

  public isTaskRegisteredAsync = jest.fn(async (taskName: string): Promise<boolean> => {
    return this.taskExecutors.has(taskName);
  });

  public unregisterTaskAsync = jest.fn(async (taskName: string): Promise<void> => {
    this.taskExecutors.delete(taskName);
  });

  public unregisterAllTasksAsync = jest.fn(async (): Promise<void> => {
    this.taskExecutors.clear();
  });

  public isAvailableAsync = jest.fn(async (): Promise<boolean> => true);

  // Test Simulation Helpers
  public async __executeTask(taskName: string, body: any): Promise<any> {
    const executor = this.taskExecutors.get(taskName);
    if (!executor) {
      throw new Error(`Task ${taskName} is not defined`);
    }
    return await executor(body);
  }

  public __getTaskExecutor(taskName: string): ((body: any) => Promise<any>) | undefined {
    return this.taskExecutors.get(taskName);
  }

  public __reset(): void {
    this.taskExecutors.clear();
    this.defineTask.mockClear();
    this.isTaskDefined.mockClear();
    this.isTaskRegisteredAsync.mockClear();
    this.unregisterTaskAsync.mockClear();
    this.unregisterAllTasksAsync.mockClear();
    this.isAvailableAsync.mockClear();
  }
}

export const mockNotifications = new MockExpoNotifications();
export const mockTaskManager = new MockTaskManager();
export default mockNotifications;
