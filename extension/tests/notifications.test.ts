import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NOTIFICATION_BUTTONS,
  createNotificationOptions,
  showNotification,
  handleNotificationButtonClick,
  handleNotificationClick,
  registerSyncTrigger,
} from '../src/services/notificationService';
import { storageService } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';

describe('Actionable Notifications & Chromium 2-Button Limit (R4)', () => {
  beforeEach(() => {
    storageService.clearCache();
    vi.clearAllMocks();
  });

  describe('Chromium 2-Button Layout Constraint', () => {
    it('strictly satisfies Chromium limit of at most 2 buttons', () => {
      expect(NOTIFICATION_BUTTONS.length).toBeLessThanOrEqual(2);
      expect(NOTIFICATION_BUTTONS[0].title).toBe('+15m');
      expect(NOTIFICATION_BUTTONS[1].title).toBe('Complete');
    });

    it('creates notification options with compliant buttons and icons', () => {
      const reminder: Reminder = {
        id: 'notif-test-1',
        title: 'Review PR',
        notes: 'Priority high',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
        armed: true,
      };

      const opts = createNotificationOptions(reminder);

      expect(opts.buttons).toBeDefined();
      expect(opts.buttons?.length).toBe(2);
      expect(opts.buttons?.[0].title).toBe('+15m');
      expect(opts.buttons?.[1].title).toBe('Complete');
      expect(opts.title).toBe('Review PR');
      expect(opts.message).toContain('Due now');
      expect(opts.message).toContain('Priority high');
    });

    it('calls chrome.notifications.create with reminder ID and options', async () => {
      const reminder: Reminder = {
        id: 'notif-create-test',
        title: 'Call electrician',
        dueDate: '2026-09-14T11:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
        armed: true,
      };

      const notifId = await showNotification(reminder);
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'notif-create-test',
        expect.objectContaining({
          title: 'Call electrician',
          buttons: expect.arrayContaining([{ title: '+15m' }, { title: 'Complete' }]),
        }),
        expect.any(Function)
      );
      expect(notifId).toBe('notif-create-test');
    });
  });

  describe('Button 0: Snooze +15m Action', () => {
    it('snoozes reminder by 15 minutes, reschedules alarm, and clears notification', async () => {
      const originalDueDate = '2026-09-14T10:00:00.000Z';
      const reminder: Reminder = {
        id: 'snooze-test-rem',
        title: 'Submit invoice',
        dueDate: originalDueDate,
        status: 'pending',
        snoozeCount: 0,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
        armed: true,
      };

      await storageService.saveReminder(reminder);

      const syncSpy = vi.fn().mockResolvedValue(undefined);
      registerSyncTrigger(syncSpy);

      const beforeClick = Date.now();
      const result = await handleNotificationButtonClick('snooze-test-rem', 0);
      const afterClick = Date.now();

      expect(result.action).toBe('snoozed');

      const updated = storageService.getById('snooze-test-rem');
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('snoozed');
      expect(updated?.snoozeCount).toBe(1);
      expect(updated?.lastSnoozedAt).toBeDefined();

      const newDueMs = new Date(updated!.dueDate).getTime();
      expect(newDueMs).toBeGreaterThanOrEqual(beforeClick + 15 * 60 * 1000 - 1000);
      expect(newDueMs).toBeLessThanOrEqual(afterClick + 15 * 60 * 1000 + 1000);

      expect(chrome.alarms.create).toHaveBeenCalledWith('snooze-test-rem', { when: newDueMs });
      expect(chrome.notifications.clear).toHaveBeenCalledWith('snooze-test-rem');
      expect(syncSpy).toHaveBeenCalled();
    });
  });

  describe('Button 1: Complete Action', () => {
    it('marks reminder complete, clears alarm and notification, and triggers sync', async () => {
      const reminder: Reminder = {
        id: 'complete-test-rem',
        title: 'Drink water',
        dueDate: '2026-09-14T10:00:00.000Z',
        status: 'pending',
        snoozeCount: 1,
        createdAt: '2026-09-14T09:00:00.000Z',
        updatedAt: '2026-09-14T09:00:00.000Z',
        armed: true,
      };

      await storageService.saveReminder(reminder);

      const syncSpy = vi.fn().mockResolvedValue(undefined);
      registerSyncTrigger(syncSpy);

      const result = await handleNotificationButtonClick('complete-test-rem', 1);

      expect(result.action).toBe('completed');

      const updated = storageService.getById('complete-test-rem');
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeDefined();

      expect(chrome.alarms.clear).toHaveBeenCalledWith('complete-test-rem');
      expect(chrome.notifications.clear).toHaveBeenCalledWith('complete-test-rem');
      expect(syncSpy).toHaveBeenCalled();
    });
  });

  describe('Notification Body Click', () => {
    it('clears notification and sends TOGGLE_HUD message to active tab', async () => {
      await handleNotificationClick('notif-click-test');

      expect(chrome.notifications.clear).toHaveBeenCalledWith('notif-click-test');
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'TOGGLE_HUD' });
    });
  });
});
