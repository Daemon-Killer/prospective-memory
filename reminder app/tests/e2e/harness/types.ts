/**
 * Domain Interfaces & Types for Remy Reminders E2E Test Suite
 * Conforming strictly to PROJECT.md § Interface Contracts
 */

export type ReminderStatus = 'pending' | 'snoozed' | 'completed';
export type SnoozePreset = '15m' | '1h' | 'evening' | 'tomorrow_morning' | 'weekend' | 'custom';

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  dueDate: string; // ISO 8601 string
  status: ReminderStatus;
  snoozeCount: number;
  lastSnoozedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  notificationId?: string | null;
}

export interface CreateReminderInput {
  title: string;
  notes?: string | null;
  dueDate: string;
}

export interface UpdateReminderInput {
  title?: string;
  notes?: string | null;
  dueDate?: string;
  status?: ReminderStatus;
  notificationId?: string | null;
}

export interface IReminderRepository {
  init(): Promise<void>;
  getAll(): Reminder[];
  getById(id: string): Reminder | undefined;
  create(input: CreateReminderInput): Promise<Reminder>;
  update(id: string, updates: UpdateReminderInput): Promise<Reminder>;
  snooze(id: string, targetDate: Date, preset?: SnoozePreset): Promise<Reminder>;
  toggleComplete(id: string): Promise<Reminder>;
  delete(id: string): Promise<boolean>;
  reconcileActiveReminders(): Promise<Reminder[]>;
}

export interface INotificationService {
  init(): Promise<void>;
  requestPermissions(): Promise<boolean>;
  scheduleReminderNotification(reminder: Reminder): Promise<string | null>;
  cancelReminderNotification(notificationId: string): Promise<void>;
  handleNotificationResponse(actionIdentifier: string, reminderId: string): Promise<void>;
}

export const NOTIFICATION_CATEGORY = 'remy_reminder_actions';
export const ACTION_COMPLETE = 'remy_action_complete';
export const ACTION_SNOOZE_15M = 'remy_action_snooze_15m';
export const ACTION_SNOOZE_1H = 'remy_action_snooze_1h';
export const ACTION_SNOOZE_TOMORROW = 'remy_action_snooze_tomorrow';
export const STORAGE_KEY = '@remy_reminders_v1';
