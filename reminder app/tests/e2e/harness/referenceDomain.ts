/**
 * Authoritative Domain Reference Engine & Mathematical Oracle for Remy Reminders
 * Derived from PROJECT.md & ORIGINAL_REQUEST.md specifications
 */

import type {
  Reminder,
  ReminderStatus,
  SnoozePreset,
  CreateReminderInput,
  UpdateReminderInput,
  IReminderRepository,
  INotificationService,
} from './types.ts';
import {
  STORAGE_KEY,
  NOTIFICATION_CATEGORY,
  ACTION_COMPLETE,
  ACTION_SNOOZE_15M,
  ACTION_SNOOZE_1H,
  ACTION_SNOOZE_TOMORROW,
} from './types.ts';
import type { IAsyncStorage } from './mockStorage.ts';
import { MockClock } from './mockClock.ts';
import { MockNotificationEngine } from './mockNotifications.ts';

// Simple RFC4122 v4 UUID generator without external dependencies
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Snooze calculation math based on T_base = max(T_now, T_due)
 * Seconds and milliseconds are always normalized to 00.
 */
export function calculateSnoozeTime(
  preset: SnoozePreset,
  dueDate: Date | string,
  now: Date,
  customOffsetMinutes?: number,
  customTargetDate?: Date
): Date {
  const due = new Date(dueDate);
  // T_base = max(T_now, T_due)
  const baseMs = Math.max(now.getTime(), due.getTime());
  const base = new Date(baseMs);

  switch (preset) {
    case '15m': {
      const target = new Date(base.getTime() + 15 * 60 * 1000);
      target.setSeconds(0, 0);
      return target;
    }

    case '1h': {
      const target = new Date(base.getTime() + 60 * 60 * 1000);
      target.setSeconds(0, 0);
      return target;
    }

    case 'evening': {
      // 19:00 today, or tomorrow if past 18:30
      const target = new Date(base);
      const hours = base.getHours();
      const minutes = base.getMinutes();

      if (hours > 18 || (hours === 18 && minutes >= 30)) {
        // Past 18:30, move to tomorrow 19:00
        target.setDate(target.getDate() + 1);
      }
      target.setHours(19, 0, 0, 0);
      return target;
    }

    case 'tomorrow_morning': {
      // Next day 09:00 local time
      const target = new Date(base);
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
      return target;
    }

    case 'weekend': {
      // Advances calendar to upcoming Saturday at 09:00 local time
      const target = new Date(base);
      const day = base.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      let daysUntilSaturday = 0;

      if (day === 6) {
        // Today is Saturday
        if (base.getHours() < 9) {
          daysUntilSaturday = 0;
        } else {
          daysUntilSaturday = 7;
        }
      } else if (day === 0) {
        // Today is Sunday -> upcoming Saturday is in 6 days
        daysUntilSaturday = 6;
      } else {
        // Monday (1) to Friday (5) -> 6 - day
        daysUntilSaturday = 6 - day;
      }

      target.setDate(target.getDate() + daysUntilSaturday);
      target.setHours(9, 0, 0, 0);
      return target;
    }

    case 'custom': {
      if (customTargetDate) {
        const target = new Date(customTargetDate);
        target.setSeconds(0, 0);
        return target;
      }
      if (customOffsetMinutes !== undefined) {
        const target = new Date(base.getTime() + customOffsetMinutes * 60 * 1000);
        target.setSeconds(0, 0);
        return target;
      }
      throw new Error('Custom snooze requires either customTargetDate or customOffsetMinutes');
    }

    default:
      throw new Error(`Unknown snooze preset: ${preset}`);
  }
}

/**
 * Authoritative Reference Repository with Hydrated In-Memory Cache
 */
export class ReferenceReminderRepository implements IReminderRepository {
  private cache: Map<string, Reminder> = new Map();
  private storage: IAsyncStorage;
  private clock: MockClock;

  constructor(storage: IAsyncStorage, clock: MockClock) {
    this.storage = storage;
    this.clock = clock;
  }

  public async init(): Promise<void> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    this.cache.clear();
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.title) {
            this.cache.set(item.id, item);
          }
        }
      }
    } catch {
      // Invariant: Storage corruption recovers gracefully without fatal crash
      this.cache.clear();
    }
  }

  public getAll(): Reminder[] {
    // Zero-latency synchronous read from in-memory cache
    return Array.from(this.cache.values()).sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );
  }

  public getById(id: string): Reminder | undefined {
    const found = this.cache.get(id);
    return found ? { ...found } : undefined;
  }

  public async create(input: CreateReminderInput): Promise<Reminder> {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('Validation Error: Reminder title cannot be empty or whitespace');
    }

    const parsedDue = new Date(input.dueDate);
    if (isNaN(parsedDue.getTime())) {
      throw new Error(`Validation Error: Invalid ISO 8601 date string '${input.dueDate}'`);
    }

    const id = generateUUID();
    const nowIso = this.clock.toISOString();

    const reminder: Reminder = {
      id,
      title: input.title.trim(),
      notes: input.notes !== undefined ? input.notes : null,
      dueDate: parsedDue.toISOString(),
      status: 'pending',
      snoozeCount: 0,
      lastSnoozedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
      notificationId: null,
    };

    this.cache.set(id, reminder);
    await this.persist();
    return { ...reminder };
  }

  public async update(id: string, updates: UpdateReminderInput): Promise<Reminder> {
    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id '${id}' not found`);
    }

    if (updates.title !== undefined) {
      if (!updates.title || updates.title.trim().length === 0) {
        throw new Error('Validation Error: Reminder title cannot be empty or whitespace');
      }
      existing.title = updates.title.trim();
    }

    if (updates.notes !== undefined) {
      existing.notes = updates.notes;
    }

    if (updates.dueDate !== undefined) {
      const parsed = new Date(updates.dueDate);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Validation Error: Invalid ISO 8601 date string '${updates.dueDate}'`);
      }
      existing.dueDate = parsed.toISOString();
    }

    if (updates.status !== undefined) {
      existing.status = updates.status;
      if (updates.status === 'completed' && !existing.completedAt) {
        existing.completedAt = this.clock.toISOString();
      } else if (updates.status !== 'completed') {
        existing.completedAt = null;
      }
    }

    if (updates.notificationId !== undefined) {
      existing.notificationId = updates.notificationId;
    }

    existing.updatedAt = this.clock.toISOString();
    this.cache.set(id, existing);
    await this.persist();
    return { ...existing };
  }

  public async snooze(id: string, targetDate: Date, preset?: SnoozePreset): Promise<Reminder> {
    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id '${id}' not found`);
    }

    if (isNaN(targetDate.getTime())) {
      throw new Error('Validation Error: Invalid targetDate for snooze');
    }

    const nowIso = this.clock.toISOString();
    existing.status = 'snoozed';
    existing.snoozeCount += 1;
    existing.lastSnoozedAt = nowIso;
    existing.dueDate = targetDate.toISOString();
    existing.updatedAt = nowIso;

    this.cache.set(id, existing);
    await this.persist();
    return { ...existing };
  }

  public async toggleComplete(id: string): Promise<Reminder> {
    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id '${id}' not found`);
    }

    const nowIso = this.clock.toISOString();
    if (existing.status === 'completed') {
      existing.status = 'pending';
      existing.completedAt = null;
    } else {
      existing.status = 'completed';
      existing.completedAt = nowIso;
    }
    existing.updatedAt = nowIso;

    this.cache.set(id, existing);
    await this.persist();
    return { ...existing };
  }

  public async delete(id: string): Promise<boolean> {
    const exists = this.cache.has(id);
    if (!exists) {
      return false;
    }
    this.cache.delete(id);
    await this.persist();
    return true;
  }

  public async reconcileActiveReminders(): Promise<Reminder[]> {
    const active = Array.from(this.cache.values()).filter((r) => r.status !== 'completed');
    return active.map((r) => ({ ...r }));
  }

  private async persist(): Promise<void> {
    const array = Array.from(this.cache.values());
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(array));
  }
}

/**
 * Authoritative Reference Notification Service
 */
export class ReferenceNotificationService implements INotificationService {
  private engine: MockNotificationEngine;
  private repository: IReminderRepository;
  private clock: MockClock;

  constructor(engine: MockNotificationEngine, repository: IReminderRepository, clock: MockClock) {
    this.engine = engine;
    this.repository = repository;
    this.clock = clock;
  }

  public async init(): Promise<void> {
    await this.engine.setNotificationCategoryAsync(NOTIFICATION_CATEGORY, [
      { identifier: ACTION_COMPLETE, buttonTitle: 'Complete', options: { opensAppToForeground: false } },
      { identifier: ACTION_SNOOZE_15M, buttonTitle: '+15m', options: { opensAppToForeground: false } },
      { identifier: ACTION_SNOOZE_1H, buttonTitle: '+1h', options: { opensAppToForeground: false } },
      { identifier: ACTION_SNOOZE_TOMORROW, buttonTitle: 'Tomorrow', options: { opensAppToForeground: false } },
    ]);
  }

  public async requestPermissions(): Promise<boolean> {
    return this.engine.permissionsGranted;
  }

  public async scheduleReminderNotification(reminder: Reminder): Promise<string | null> {
    if (!this.engine.permissionsGranted || reminder.status === 'completed') {
      return null;
    }

    // Cancel any previous notification associated with this reminder
    if (reminder.notificationId) {
      await this.cancelReminderNotification(reminder.notificationId);
    }

    const notificationId = await this.engine.scheduleNotificationAsync({
      content: {
        title: reminder.title,
        body: reminder.notes || undefined,
        categoryIdentifier: NOTIFICATION_CATEGORY,
        data: { reminderId: reminder.id },
      },
      trigger: {
        date: new Date(reminder.dueDate),
      },
    });

    reminder.notificationId = notificationId;
    await this.repository.update(reminder.id, { notificationId });
    return notificationId;
  }

  public async cancelReminderNotification(notificationId: string): Promise<void> {
    if (notificationId) {
      await this.engine.cancelScheduledNotificationAsync(notificationId);
    }
  }

  public async handleNotificationResponse(actionIdentifier: string, reminderId: string): Promise<void> {
    const reminder = this.repository.getById(reminderId);
    if (!reminder) {
      // Ignored safely without crashing
      return;
    }

    switch (actionIdentifier) {
      case ACTION_COMPLETE: {
        if (reminder.status !== 'completed') {
          await this.repository.toggleComplete(reminderId);
        }
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
          await this.repository.update(reminder.id, { notificationId: null });
        }
        break;
      }

      case ACTION_SNOOZE_15M: {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculateSnoozeTime('15m', reminder.dueDate, this.clock.now());
        const updated = await this.repository.snooze(reminderId, target, '15m');
        await this.scheduleReminderNotification(updated);
        break;
      }

      case ACTION_SNOOZE_1H: {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculateSnoozeTime('1h', reminder.dueDate, this.clock.now());
        const updated = await this.repository.snooze(reminderId, target, '1h');
        await this.scheduleReminderNotification(updated);
        break;
      }

      case ACTION_SNOOZE_TOMORROW: {
        if (reminder.notificationId) {
          await this.cancelReminderNotification(reminder.notificationId);
        }
        const target = calculateSnoozeTime('tomorrow_morning', reminder.dueDate, this.clock.now());
        const updated = await this.repository.snooze(reminderId, target, 'tomorrow_morning');
        await this.scheduleReminderNotification(updated);
        break;
      }

      default:
        // Unknown action identifier gracefully ignored
        break;
    }
  }
}
