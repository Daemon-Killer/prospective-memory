/**
 * Simulated Expo Notifications Driver for E2E Testing
 */

import { NOTIFICATION_CATEGORY, ACTION_COMPLETE, ACTION_SNOOZE_15M, ACTION_SNOOZE_1H, ACTION_SNOOZE_TOMORROW } from './types.ts';

export interface ScheduledAlert {
  id: string;
  reminderId: string;
  triggerDate: Date;
  title: string;
  body?: string;
  categoryIdentifier: string;
  data: Record<string, any>;
}

export class MockNotificationEngine {
  public permissionsGranted = true;
  public registeredCategories = new Map<string, any[]>();
  public scheduledAlerts = new Map<string, ScheduledAlert>();
  public eventHistory: Array<{
    type: 'register_category' | 'schedule' | 'cancel' | 'action_fired';
    timestamp: Date;
    details: any;
  }> = [];

  private nextNotificationNum = 1;

  public async setNotificationCategoryAsync(categoryIdentifier: string, actions: any[]): Promise<void> {
    this.registeredCategories.set(categoryIdentifier, actions);
    this.eventHistory.push({
      type: 'register_category',
      timestamp: new Date(),
      details: { categoryIdentifier, actionsCount: actions.length },
    });
  }

  public async scheduleNotificationAsync(request: {
    content: {
      title: string;
      body?: string;
      categoryIdentifier?: string;
      data?: Record<string, any>;
    };
    trigger: {
      date: Date | number;
    };
  }): Promise<string> {
    if (!this.permissionsGranted) {
      throw new Error('Notification permissions not granted');
    }

    const id = `notif_${this.nextNotificationNum++}_${Date.now()}`;
    const triggerDate = request.trigger.date instanceof Date ? request.trigger.date : new Date(request.trigger.date);

    const alert: ScheduledAlert = {
      id,
      reminderId: request.content.data?.reminderId || '',
      triggerDate,
      title: request.content.title,
      body: request.content.body,
      categoryIdentifier: request.content.categoryIdentifier || NOTIFICATION_CATEGORY,
      data: request.content.data || {},
    };

    this.scheduledAlerts.set(id, alert);
    this.eventHistory.push({
      type: 'schedule',
      timestamp: new Date(),
      details: { id, reminderId: alert.reminderId, triggerDate: alert.triggerDate.toISOString() },
    });

    return id;
  }

  public async cancelScheduledNotificationAsync(identifier: string): Promise<void> {
    const existed = this.scheduledAlerts.delete(identifier);
    this.eventHistory.push({
      type: 'cancel',
      timestamp: new Date(),
      details: { identifier, existed },
    });
  }

  public async cancelAllScheduledNotificationsAsync(): Promise<void> {
    this.scheduledAlerts.clear();
    this.eventHistory.push({
      type: 'cancel',
      timestamp: new Date(),
      details: { all: true },
    });
  }

  public getScheduledForReminder(reminderId: string): ScheduledAlert[] {
    const list: ScheduledAlert[] = [];
    for (const alert of this.scheduledAlerts.values()) {
      if (alert.reminderId === reminderId) {
        list.push(alert);
      }
    }
    return list;
  }

  public clear(): void {
    this.registeredCategories.clear();
    this.scheduledAlerts.clear();
    this.eventHistory = [];
    this.permissionsGranted = true;
    this.nextNotificationNum = 1;
  }
}
