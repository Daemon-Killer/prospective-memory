import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Reminder,
  ReminderStatus,
  SnoozePreset,
  CreateReminderInput,
  UpdateReminderInput,
} from '../types/reminder';
import { generateUUID } from '../utils/idGenerator';

export const STORAGE_KEY = '@remy/reminders_v1';
export const STORAGE_VERSION = 1;

/**
 * Storage envelope wrapping reminder records for versioned persistence
 */
export interface StorageEnvelope {
  version: number;
  reminders: Reminder[];
  updatedAt: string;
}

/**
 * Repository interface defining full CRUD, synchronous reads, and reactive subscriptions
 */
export interface IReminderRepository {
  init(): Promise<void>;
  isReady(): boolean;
  getAll(): Reminder[];
  getById(id: string): Reminder | undefined;
  getPending(): Reminder[];
  getSnoozed(): Reminder[];
  getCompleted(): Reminder[];
  getActive(): Reminder[];
  create(input: CreateReminderInput): Promise<Reminder>;
  update(id: string, updates: UpdateReminderInput): Promise<Reminder>;
  snooze(id: string, targetDate: Date, preset?: SnoozePreset): Promise<Reminder>;
  toggleComplete(id: string): Promise<Reminder>;
  setNotificationId(id: string, notificationId: string | null): Promise<Reminder>;
  delete(id: string): Promise<boolean>;
  reconcileActiveReminders(): Promise<Reminder[]>;
  clear(): Promise<void>;
  subscribe(listener: () => void): () => void;
  applyRemoteSync(synced: Array<Reminder & { isDeleted?: boolean }>): Promise<boolean>;
  onMutation(listener: () => void): () => void;
}

/**
 * Fallback UUID generator if external generator is unavailable
 */
function createUUID(): string {
  try {
    if (typeof generateUUID === 'function') {
      return generateUUID();
    }
  } catch {
    // fallback below
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Safely parses an unknown date value into an ISO 8601 string.
 * Returns null if the value is missing, empty, or an invalid date.
 * Guaranteed never to throw RangeError: Invalid time value.
 */
function parseSafeISO(val: unknown): string | null {
  if (typeof val !== 'string' && typeof val !== 'number' && !(val instanceof Date)) {
    return null;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * StorageService:
 * Offline-first persistent reminder repository featuring:
 * 1. In-memory Map<string, Reminder> hydrated cache for 0ms synchronous reads
 * 2. Optimistic mutations with synchronous cache updates and reactive notifications
 * 3. Asynchronous write-through flush with sequential Promise queueing to eliminate race conditions
 */
export class StorageService implements IReminderRepository {
  private cache: Map<string, Reminder> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();
  private listeners: Set<() => void> = new Set();
  private mutationListeners: Set<() => void> = new Set();

  /**
   * Initializes and hydrates the cache from AsyncStorage.
   * Safe to call multiple times (idempotent, deduplicated).
   */
  init(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        // Non-destructive: do NOT clear this.cache here; preserve any mutations
        // registered while awaiting AsyncStorage.getItem()

        if (raw) {
          const parsed = JSON.parse(raw);
          let items: Reminder[] = [];

          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && Array.isArray(parsed.reminders)) {
            items = parsed.reminders;
          }

          for (const item of items) {
            try {
              if (!item || typeof item !== 'object' || !item.id || !item.title) {
                continue;
              }

              const isoDueDate = parseSafeISO(item.dueDate);
              if (!isoDueDate) {
                console.warn(`StorageService: Skipping corrupted reminder "${item.id}" due to invalid dueDate:`, item.dueDate);
                continue;
              }

              const nowIso = new Date().toISOString();
              const isoLastSnoozedAt = item.lastSnoozedAt ? parseSafeISO(item.lastSnoozedAt) : null;
              const isoCreatedAt = item.createdAt ? (parseSafeISO(item.createdAt) ?? nowIso) : nowIso;
              const isoUpdatedAt = item.updatedAt ? (parseSafeISO(item.updatedAt) ?? nowIso) : nowIso;
              const isoCompletedAt = item.completedAt ? parseSafeISO(item.completedAt) : null;

              const reminder: Reminder = {
                id: String(item.id),
                title: String(item.title).trim(),
                notes: item.notes !== undefined && item.notes !== null ? String(item.notes) : null,
                dueDate: isoDueDate,
                status: (item.status as ReminderStatus) || 'pending',
                snoozeCount: typeof item.snoozeCount === 'number' && item.snoozeCount >= 0 && Number.isFinite(item.snoozeCount)
                  ? Math.floor(item.snoozeCount)
                  : 0,
                lastSnoozedAt: isoLastSnoozedAt,
                createdAt: isoCreatedAt,
                updatedAt: isoUpdatedAt,
                completedAt: isoCompletedAt,
                notificationId: item.notificationId !== undefined && item.notificationId !== null ? String(item.notificationId) : null,
              };

              // Non-destructive: Only insert disk record if key is not already populated in memory
              if (!this.cache.has(reminder.id)) {
                this.cache.set(reminder.id, reminder);
              }
            } catch (itemError) {
              console.warn(`StorageService: Skipping corrupted reminder item during hydration:`, itemError);
            }
          }
        }

        this.initialized = true;
        this.notifyListeners();
      } catch (error) {
        console.error('StorageService: Error hydrating cache from storage', error);
        // Non-destructive: do NOT clear this.cache on hydration error
        this.initialized = true;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns whether the cache has completed initial hydration
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Synchronous 0ms read: Returns all reminders sorted by dueDate ascending
   */
  getAll(): Reminder[] {
    return Array.from(this.cache.values())
      .map((r) => ({ ...r }))
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }

  /**
   * Synchronous 0ms read: Retrieves a single reminder by ID
   */
  getById(id: string): Reminder | undefined {
    const item = this.cache.get(id);
    return item ? { ...item } : undefined;
  }

  /**
   * Synchronous 0ms read: Returns active pending reminders sorted by dueDate ascending
   */
  getPending(): Reminder[] {
    return this.getAll().filter((r) => r.status === 'pending');
  }

  /**
   * Synchronous 0ms read: Returns snoozed reminders sorted by dueDate ascending
   */
  getSnoozed(): Reminder[] {
    return this.getAll().filter((r) => r.status === 'snoozed');
  }

  /**
   * Synchronous 0ms read: Returns completed reminders sorted by completedAt descending
   */
  getCompleted(): Reminder[] {
    return this.getAll()
      .filter((r) => r.status === 'completed')
      .sort((a, b) => {
        const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return timeB - timeA;
      });
  }

  /**
   * Synchronous 0ms read: Returns all active (pending or snoozed) reminders
   */
  getActive(): Reminder[] {
    return this.getAll().filter((r) => r.status === 'pending' || r.status === 'snoozed');
  }

  /**
   * Creates and persists a new reminder with validation and optimistic cache update
   */
  async create(input: CreateReminderInput): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    if (!input || typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new Error('Reminder title cannot be empty');
    }

    const trimmedTitle = input.title.trim();
    if (trimmedTitle.length > 255) {
      throw new Error('Reminder title cannot exceed 255 characters');
    }

    const parsedDue = new Date(input.dueDate);
    if (isNaN(parsedDue.getTime())) {
      throw new Error(`Invalid dueDate: "${input.dueDate}" is not a valid ISO 8601 date string`);
    }

    const now = new Date().toISOString();
    const id = createUUID();

    const reminder: Reminder = {
      id,
      title: trimmedTitle,
      notes: input.notes !== undefined && input.notes !== null ? String(input.notes) : null,
      dueDate: parsedDue.toISOString(),
      status: 'pending',
      snoozeCount: 0,
      lastSnoozedAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      notificationId: null,
    };

    // Optimistic cache update & immediate UI notification
    this.cache.set(reminder.id, reminder);
    this.notifyListeners();
    this.notifyMutation();

    // Asynchronous write-through flush
    await this.persist();

    return { ...reminder };
  }

  /**
   * Updates an existing reminder with validation and optimistic cache update
   */
  async update(id: string, updates: UpdateReminderInput): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id "${id}" not found`);
    }

    let trimmedTitle = existing.title;
    if (updates.title !== undefined) {
      if (typeof updates.title !== 'string' || updates.title.trim().length === 0) {
        throw new Error('Reminder title cannot be empty');
      }
      trimmedTitle = updates.title.trim();
      if (trimmedTitle.length > 255) {
        throw new Error('Reminder title cannot exceed 255 characters');
      }
    }

    let dueDate = existing.dueDate;
    if (updates.dueDate !== undefined) {
      const parsed = new Date(updates.dueDate);
      if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid dueDate: "${updates.dueDate}" is not a valid ISO 8601 date string`);
      }
      dueDate = parsed.toISOString();
    }

    const notes = updates.notes !== undefined
      ? (updates.notes !== null ? String(updates.notes) : null)
      : existing.notes;

    const now = new Date().toISOString();
    let status = existing.status;
    let completedAt = existing.completedAt;

    if (updates.status !== undefined) {
      status = updates.status;
      if (updates.status === 'completed' && existing.status !== 'completed') {
        completedAt = now;
      } else if (updates.status !== 'completed') {
        completedAt = null;
      }
    }

    const updated: Reminder = {
      ...existing,
      title: trimmedTitle,
      notes,
      dueDate,
      status,
      completedAt,
      updatedAt: now,
    };

    this.cache.set(id, updated);
    this.notifyListeners();
    this.notifyMutation();

    await this.persist();

    return { ...updated };
  }

  /**
   * Snoozes an existing reminder to targetDate, incrementing snoozeCount
   */
  async snooze(id: string, targetDate: Date, _preset?: SnoozePreset): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id "${id}" not found`);
    }

    if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) {
      throw new Error('Invalid targetDate: must be a valid Date object');
    }

    const now = new Date().toISOString();
    const updated: Reminder = {
      ...existing,
      dueDate: targetDate.toISOString(),
      status: 'snoozed',
      snoozeCount: existing.snoozeCount + 1,
      lastSnoozedAt: now,
      completedAt: null,
      updatedAt: now,
    };

    this.cache.set(id, updated);
    this.notifyListeners();
    this.notifyMutation();

    await this.persist();

    return { ...updated };
  }

  /**
   * Toggles completion status between completed and pending
   */
  async toggleComplete(id: string): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id "${id}" not found`);
    }

    const now = new Date().toISOString();
    let updated: Reminder;

    if (existing.status === 'completed') {
      updated = {
        ...existing,
        status: 'pending',
        completedAt: null,
        updatedAt: now,
      };
    } else {
      updated = {
        ...existing,
        status: 'completed',
        completedAt: now,
        notificationId: null,
        updatedAt: now,
      };
    }

    this.cache.set(id, updated);
    this.notifyListeners();
    this.notifyMutation();

    await this.persist();

    return { ...updated };
  }

  /**
   * Sets or clears the OS scheduled notification ID for a reminder
   */
  async setNotificationId(id: string, notificationId: string | null): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    const existing = this.cache.get(id);
    if (!existing) {
      throw new Error(`Reminder with id "${id}" not found`);
    }

    const updated: Reminder = {
      ...existing,
      notificationId,
      updatedAt: new Date().toISOString(),
    };

    this.cache.set(id, updated);
    this.notifyListeners();

    await this.persist();

    return { ...updated };
  }

  /**
   * Deletes a reminder from cache and storage
   */
  async delete(id: string): Promise<boolean> {
    if (!this.initialized) {
      await this.init();
    }

    if (!this.cache.has(id)) {
      return false;
    }

    this.cache.delete(id);
    this.notifyListeners();
    this.notifyMutation();

    await this.persist();

    return true;
  }

  /**
   * Cold boot reconciliation: returns all active reminders (pending/snoozed) for notification re-registration
   */
  async reconcileActiveReminders(): Promise<Reminder[]> {
    if (!this.initialized) {
      await this.init();
    }
    return this.getActive();
  }

  /**
   * Completely clears cache and deletes the storage key (useful for tests or app reset)
   */
  async clear(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    this.cache.clear();
    this.initialized = true;
    this.notifyListeners();

    const currentClear = this.flushPromise
      .catch(() => {})
      .then(async () => {
        await AsyncStorage.removeItem(STORAGE_KEY);
      });

    this.flushPromise = currentClear.catch((error) => {
      console.error('StorageService: Error clearing storage', error);
    });

    await currentClear;
  }

  /**
   * Subscribes a listener callback to cache mutations (called synchronously on every mutation)
   * Returns an unbind cleanup function
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribes a listener to local user mutations (create, update, snooze, toggle, delete)
   */
  onMutation(listener: () => void): () => void {
    this.mutationListeners.add(listener);
    return () => {
      this.mutationListeners.delete(listener);
    };
  }

  private notifyMutation(): void {
    this.mutationListeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('StorageService: Mutation listener error', e);
      }
    });
  }

  /**
   * Applies changes received from cloud sync using Last-Write-Wins (LWW) conflict resolution
   */
  async applyRemoteSync(syncedReminders: Array<Reminder & { isDeleted?: boolean }>): Promise<boolean> {
    if (!this.initialized) {
      await this.init();
    }

    let changed = false;

    for (const item of syncedReminders) {
      if (item.isDeleted) {
        if (this.cache.has(item.id)) {
          this.cache.delete(item.id);
          changed = true;
        }
      } else {
        const existing = this.cache.get(item.id);
        if (!existing) {
          this.cache.set(item.id, {
            id: item.id,
            title: item.title,
            notes: item.notes,
            dueDate: item.dueDate,
            status: item.status,
            snoozeCount: item.snoozeCount,
            lastSnoozedAt: item.lastSnoozedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            completedAt: item.completedAt,
            notificationId: null,
          });
          changed = true;
        } else {
          const serverTime = new Date(item.updatedAt).getTime();
          const localTime = new Date(existing.updatedAt).getTime();
          if (serverTime >= localTime) {
            this.cache.set(item.id, {
              ...existing,
              title: item.title,
              notes: item.notes,
              dueDate: item.dueDate,
              status: item.status,
              snoozeCount: item.snoozeCount,
              lastSnoozedAt: item.lastSnoozedAt,
              updatedAt: item.updatedAt,
              completedAt: item.completedAt,
            });
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.notifyListeners();
      await this.persist();
    }

    return changed;
  }

  /**
   * Sequential promise chain persistence: ensures disk writes are strictly serialized
   * and never interleave or overwrite with stale cache snapshots
   */
  private persist(): Promise<void> {
    const currentWrite = this.flushPromise
      .catch(() => {})
      .then(async () => {
        const envelope: StorageEnvelope = {
          version: STORAGE_VERSION,
          reminders: Array.from(this.cache.values()),
          updatedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      });

    this.flushPromise = currentWrite.catch((error) => {
      console.error('StorageService: Error persisting to AsyncStorage', error);
    });

    return currentWrite;
  }

  /**
   * Synchronously notifies all subscribed listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('StorageService: Listener error', e);
      }
    });
  }
}

export const storageService = new StorageService();
export default storageService;
