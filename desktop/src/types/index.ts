export type ReminderStatus = 'pending' | 'snoozed' | 'completed';

export type SnoozePreset =
  | '15m'
  | '1h'
  | 'evening'
  | 'tomorrow_morning'
  | 'weekend'
  | 'custom';

export type ContextMode = 'all' | 'work' | 'home';

export type RecollectionCategory = 'call' | 'grocery' | 'chore' | 'general';

export interface RecollectionItem {
  id: string;
  title: string;
  category: RecollectionCategory;
  dueDate: string;
  notes?: string | null;
  tags?: string[] | null;
  reminder: Reminder;
}

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  dueDate: string;
  status: ReminderStatus;
  snoozeCount: number;
  lastSnoozedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  isDeleted?: boolean;
  armed?: boolean;
  inkData?: string | null;
  culturalMetadata?: string | null;
  priority?: string | null;
  context?: ContextMode | 'personal' | 'general' | null;
  tags?: string[] | null;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  serverSyncTime?: string;
  error?: string;
  statusCode?: number;
}

export interface SyncBatchIn {
  reminders: Omit<Reminder, 'notificationId'>[];
  clientSyncTime: string | null;
}

export interface SyncBatchOut {
  synced: Reminder[];
  serverSyncTime: string;
}

export interface CompileResult {
  raw: string;
  title: string;
  lingoKey: string | null;
  preset: string;
  dueDate: string;
  armed: boolean;
  musicIntent?: {
    action: string;
    cleanQuery: string;
    confidence: number;
  };
}

export interface AppConfig {
  apiUrl: string;
  token: string;
  dbPath: string;
  globalHotkey: string;
  autoSyncIntervalMs: number;
}
