/**
 * Remy Extension Reminder Domain Types
 * Mirrors the prospective memory data contracts
 */

export type ReminderStatus = 'pending' | 'snoozed' | 'completed';

export interface Reminder {
  /** Unique UUID v4 or random string identifier */
  id: string;

  /** Title of the reminder */
  title: string;

  /** Optional descriptive notes or context */
  notes?: string | null;

  /** Target alert timestamp formatted as ISO 8601 UTC string */
  dueDate: string;

  /** Lifecycle state */
  status: ReminderStatus;

  /** Total number of times this reminder has been snoozed (>= 0) */
  snoozeCount: number;

  /** ISO 8601 timestamp of most recent snooze event, or null */
  lastSnoozedAt?: string | null;

  /** ISO 8601 timestamp of record creation */
  createdAt: string;

  /** ISO 8601 timestamp of last update */
  updatedAt: string;

  /** ISO 8601 timestamp when marked complete, or null */
  completedAt?: string | null;

  /** Local OS-level notification trigger identifier */
  notificationId?: string | null;

  /** Soft-delete tombstone used for cross-device sync */
  isDeleted?: boolean;

  /** False = inbox dump with no alarm. Missing/true = scheduled alarm */
  armed?: boolean;
}

export function isReminderArmed(reminder: { armed?: boolean }): boolean {
  return reminder.armed !== false;
}

export interface CreateReminderInput {
  title: string;
  notes?: string | null;
  dueDate?: string;
  armed?: boolean;
}

export interface UserConfig {
  apiUrl: string;
  token: string;
  customLingo: string;
  syncEnabled: boolean;
}

export const DEFAULT_API_URL = 'https://prospective-memory-api.onrender.com';
export const DEFAULT_TOKEN = 'd/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=';
export const DEFAULT_SYNC_ENABLED = true;

export const DEFAULT_CONFIG: UserConfig = {
  apiUrl: DEFAULT_API_URL,
  token: DEFAULT_TOKEN,
  customLingo: '',
  syncEnabled: DEFAULT_SYNC_ENABLED,
};
