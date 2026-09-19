/**
 * Remy Reminders - Core Domain Types & Schema Invariants
 * Milestone 1 Specification
 */

export type ReminderStatus = 'pending' | 'snoozed' | 'completed';

export type SnoozePreset =
  | '15m'
  | '1h'
  | 'evening'
  | 'tomorrow_morning'
  | 'weekend'
  | 'custom';

export type CustomIntervalUnit = 'minutes' | 'hours' | 'days';

export interface CustomIntervalInput {
  value: number;
  unit: CustomIntervalUnit;
}

export interface SnoozeCalculationOptions {
  now?: Date;
  dueDate?: Date | string | null;
  customInterval?: CustomIntervalInput;
  customDate?: Date | string;
}

export interface Reminder {
  /** Unique RFC 4122 UUID v4 identifier */
  id: string;

  /** Title of the reminder (1..255 characters, trimmed) */
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

  /** OS-level notification trigger identifier from expo-notifications */
  notificationId?: string | null;

  /** Soft-delete tombstone used for cross-device sync. Live records omit this. */
  isDeleted?: boolean;

  /**
   * False = inbox dump with no alarm. Missing/true = scheduled (legacy records).
   * dueDate stays required for Wear/cloud; unarmed items must not notify or show overdue.
   */
  armed?: boolean;

  /**
   * @deprecated Handwritten ink feature has been retired from active capture in favor of home/lockscreen widgets.
   * Retained strictly for backward compatibility with historical reminders.
   */
  inkData?: string | null;

  /** Priority level for sorting and triage */
  priority?: ReminderPriority | null;

  /** Optional cultural / leisure recommendation metadata (movies, shows, books, docs) */
  culturalMetadata?: CulturalMetadata | null;
}

export type ReminderPriority = 'low' | 'medium' | 'high';

export type CulturalMediaType = 'movie' | 'show' | 'documentary' | 'book' | 'other';

export interface CulturalMetadata {
  mediaType: CulturalMediaType;
  platform?: string | null;
  releaseYear?: number | null;
  runtime?: string | null;
  genres?: string[];
  recommendedBy?: string | null;
  creator?: string | null;
}

/** Legacy reminders omit `armed`; treat them as scheduled. */
export function isReminderArmed(reminder: { armed?: boolean }): boolean {
  return reminder.armed !== false;
}

export interface CreateReminderInput {
  id?: string;
  title: string;
  notes?: string | null;
  dueDate: string;
  armed?: boolean;
  priority?: ReminderPriority | null;
  /** @deprecated Retired from active capture */
  inkData?: string | null;
  culturalMetadata?: CulturalMetadata | null;
}

export interface UpdateReminderInput {
  title?: string;
  notes?: string | null;
  dueDate?: string;
  status?: ReminderStatus;
  armed?: boolean;
  priority?: ReminderPriority | null;
  /** @deprecated Retired from active capture */
  inkData?: string | null;
  culturalMetadata?: CulturalMetadata | null;
}

export interface SnoozeReminderOptions {
  reminderId: string;
  targetDate: Date;
  preset?: SnoozePreset;
}

export interface ReminderValidationResult {
  isValid: boolean;
  errors: string[];
}
