/**
 * Remy Reminders - Sensory Storage Service
 * Isolated storage for AI/Pattern-inferred prospective memory suggestions.
 * Storage Key: @remy/sensory_suggestions_v1
 *
 * Features:
 * 1. 0ms in-memory cache with synchronous reads for UI shelves.
 * 2. Sequential Promise queue persistence preventing disk race conditions.
 * 3. State transition: acceptSuggestion(id) promotes to storageService.create and
 *    schedules notifications, cleanly purging candidate suggestion (zero orphans).
 * 4. State transition: dismissSuggestion(id) cleanly purges candidate suggestion.
 * 5. Reactive subscription model for UI synchronization.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService as defaultStorageService, IReminderRepository } from '../services/storageService';
import { notificationService as defaultNotificationService, INotificationService } from '../services/notificationService';
import { Reminder } from '../types/reminder';
import { generateUUID } from '../utils/idGenerator';
import {
  SensorySuggestion,
  SensorySuggestionsEnvelope,
  ActionableExtraction,
  RawNotificationPayload,
  ISensoryStorageService,
  SensoryCategory,
} from './types';

export const SENSORY_STORAGE_KEY = '@remy/sensory_suggestions_v1';
export const SENSORY_STORAGE_VERSION = 1;

/**
 * Safely parses unknown date value into an ISO 8601 string.
 * Returns null if invalid or corrupt.
 */
function parseSafeISO(val: unknown): string | null {
  if (typeof val !== 'string' && typeof val !== 'number' && !(val instanceof Date)) {
    return null;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * UUID generator with global crypto fallback
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

export class SensoryStorageService implements ISensoryStorageService {
  private cache: Map<string, SensorySuggestion> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();
  private listeners: Set<() => void> = new Set();

  constructor(
    private reminderRepository: IReminderRepository = defaultStorageService,
    private notificationService: INotificationService = defaultNotificationService,
    private storageKey: string = SENSORY_STORAGE_KEY
  ) {}

  /**
   * Initializes and hydrates cache from AsyncStorage.
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
        const raw = await AsyncStorage.getItem(this.storageKey);

        if (raw) {
          const parsed = JSON.parse(raw);
          let items: SensorySuggestion[] = [];

          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && Array.isArray(parsed.suggestions)) {
            items = parsed.suggestions;
          }

          for (const item of items) {
            try {
              if (!item || typeof item !== 'object' || !item.id || !item.title) {
                continue;
              }

              const isoDueDate = parseSafeISO(item.inferredDueDate) || new Date().toISOString();
              const isoCreatedAt = parseSafeISO(item.createdAt) || new Date().toISOString();

              const suggestion: SensorySuggestion = {
                id: String(item.id),
                key: item.key ? String(item.key) : undefined,
                title: String(item.title).trim(),
                actionVerb: item.actionVerb ? String(item.actionVerb).trim() : 'Review',
                originalText: item.originalText ? String(item.originalText) : '',
                notes: item.notes !== undefined && item.notes !== null ? String(item.notes) : null,
                inferredDueDate: isoDueDate,
                armed: item.armed !== false,
                sourcePackage: item.sourcePackage ? String(item.sourcePackage) : 'unknown',
                sourceAppName: item.sourceAppName ? String(item.sourceAppName) : undefined,
                category: (item.category as SensoryCategory) || 'general',
                confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
                tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
                createdAt: isoCreatedAt,
                status: item.status === 'accepted' || item.status === 'dismissed' ? item.status : 'pending',
              };

              // Non-destructive: Preserve any in-memory additions registered before disk read completed
              if (!this.cache.has(suggestion.id)) {
                this.cache.set(suggestion.id, suggestion);
              }
            } catch (itemErr) {
              console.warn('SensoryStorageService: Skipping corrupted suggestion item:', itemErr);
            }
          }
        }

        this.initialized = true;
        this.notifyListeners();
      } catch (error) {
        console.error('SensoryStorageService: Error hydrating cache from storage', error);
        this.initialized = true;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns whether cache has completed hydration.
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Synchronous 0ms read: Returns all pending candidate suggestions,
   * sorted by createdAt descending (newest incoming alert first).
   */
  getPendingSuggestions(): SensorySuggestion[] {
    return Array.from(this.cache.values())
      .filter((s) => s.status === 'pending')
      .map((s) => ({ ...s }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Alias for getPendingSuggestions() satisfying dispatch requirements.
   */
  getSuggestions(): SensorySuggestion[] {
    return this.getPendingSuggestions();
  }

  /**
   * Synchronous 0ms read: Returns all suggestions across all statuses.
   */
  getAllSuggestions(): SensorySuggestion[] {
    return Array.from(this.cache.values()).map((s) => ({ ...s }));
  }

  /**
   * Synchronous 0ms read: Retrieves a single suggestion by ID.
   */
  getSuggestionById(id: string): SensorySuggestion | undefined {
    const item = this.cache.get(id);
    return item ? { ...item } : undefined;
  }

  /**
   * Adds or updates a candidate suggestion.
   * Performs deduplication: if an existing pending suggestion has the identical
   * package and title, updates its metadata instead of creating duplicate clutter.
   */
  async addSuggestion(
    input: Omit<SensorySuggestion, 'id' | 'createdAt' | 'status'> &
      Partial<Pick<SensorySuggestion, 'id' | 'createdAt' | 'status'>>
  ): Promise<SensorySuggestion> {
    if (!this.initialized) {
      await this.init();
    }

    if (!input || typeof input.title !== 'string' || input.title.trim().length === 0) {
      throw new Error('Sensory suggestion title cannot be empty');
    }

    const trimmedTitle = input.title.trim();
    const sourcePackage = input.sourcePackage || 'unknown';

    // Deduplication check: Match pending suggestion with same title and package
    let existingMatch: SensorySuggestion | undefined;
    for (const item of this.cache.values()) {
      if (
        item.status === 'pending' &&
        item.sourcePackage === sourcePackage &&
        item.title.toLowerCase() === trimmedTitle.toLowerCase()
      ) {
        existingMatch = item;
        break;
      }
    }

    const nowIso = new Date().toISOString();
    const id = input.id || existingMatch?.id || createUUID();
    const key = input.key || existingMatch?.key;
    const createdAt = input.createdAt ? (parseSafeISO(input.createdAt) ?? nowIso) : (existingMatch?.createdAt ?? nowIso);
    const isoDueDate = parseSafeISO(input.inferredDueDate) || existingMatch?.inferredDueDate || nowIso;

    const suggestion: SensorySuggestion = {
      id,
      key,
      title: trimmedTitle,
      actionVerb: input.actionVerb?.trim() || existingMatch?.actionVerb || 'Review',
      originalText: input.originalText !== undefined ? String(input.originalText) : (existingMatch?.originalText ?? ''),
      notes: input.notes !== undefined && input.notes !== null ? String(input.notes) : (existingMatch?.notes ?? null),
      inferredDueDate: isoDueDate,
      armed: input.armed !== false,
      sourcePackage,
      sourceAppName: input.sourceAppName || existingMatch?.sourceAppName,
      category: input.category || existingMatch?.category || 'general',
      confidence: typeof input.confidence === 'number' ? input.confidence : (existingMatch?.confidence ?? 0.8),
      tags: Array.isArray(input.tags) ? input.tags : (existingMatch?.tags ?? []),
      createdAt,
      status: 'pending',
    };

    this.cache.set(id, suggestion);
    this.notifyListeners();
    await this.persist();

    return { ...suggestion };
  }

  /**
   * Ingests from classifier extraction and raw notification envelope.
   */
  async addFromExtraction(
    extraction: ActionableExtraction,
    raw: RawNotificationPayload
  ): Promise<SensorySuggestion> {
    const rawText = raw.text || raw.title || '';
    return this.addSuggestion({
      id: raw.id || createUUID(),
      key: raw.key,
      title: extraction.title,
      actionVerb: extraction.actionVerb,
      originalText: rawText,
      notes: extraction.notes || (rawText.length > 0 ? `Alert: ${rawText}` : null),
      inferredDueDate: extraction.inferredDueDate,
      armed: extraction.armed,
      sourcePackage: raw.packageName,
      sourceAppName: extraction.sourceAppName,
      category: extraction.category,
      confidence: extraction.confidence,
      tags: extraction.tags,
      createdAt: new Date(raw.timestamp || Date.now()).toISOString(),
    });
  }

  /**
   * Promotes candidate suggestion into the active reminder ledger:
   * 1. Creates active reminder via storageService.create({ title, notes, dueDate, armed })
   * 2. Schedules OS notification via notificationService.scheduleReminderNotification(reminder)
   * 3. Cleanly purges suggestion from cache & disk (zero orphaned records).
   */
  async acceptSuggestion(id: string): Promise<Reminder> {
    if (!this.initialized) {
      await this.init();
    }

    const suggestion = this.cache.get(id);
    if (!suggestion) {
      throw new Error(`Sensory suggestion with id "${id}" not found`);
    }

    // Step 1: Create active reminder in core storage
    const notesPayload = suggestion.notes || (suggestion.originalText ? `From: ${suggestion.sourcePackage}\n${suggestion.originalText}` : null);
    const reminder = await this.reminderRepository.create({
      title: suggestion.title,
      notes: notesPayload,
      dueDate: suggestion.inferredDueDate,
      armed: suggestion.armed !== false,
    });

    // Step 2: Schedule system notification if armed
    try {
      if (reminder.armed !== false) {
        await this.notificationService.scheduleReminderNotification(reminder);
      }
    } catch (notifError) {
      console.warn(`SensoryStorageService: Failed to schedule notification for accepted reminder "${reminder.id}":`, notifError);
    }

    // Step 3: Clean purge from sensory suggestion cache (zero orphans)
    this.cache.delete(id);
    this.notifyListeners();
    await this.persist();

    return reminder;
  }

  /**
   * Permanently purges candidate suggestion from storage without promoting (zero orphans).
   */
  async dismissSuggestion(id: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.cache.has(id)) {
      this.cache.delete(id);
      this.notifyListeners();
      await this.persist();
    }
  }

  /**
   * Completely clears cache and deletes the storage key (useful for tests or app reset).
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
        await AsyncStorage.removeItem(this.storageKey);
      });

    this.flushPromise = currentClear.catch((error) => {
      console.error('SensoryStorageService: Error clearing storage', error);
    });

    await currentClear;
  }

  /**
   * Subscribes reactive listener for UI updates.
   * Returns an unbind cleanup function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sequential promise chain persistence: ensures disk writes are strictly serialized.
   */
  private persist(): Promise<void> {
    const currentWrite = this.flushPromise
      .catch(() => {})
      .then(async () => {
        const envelope: SensorySuggestionsEnvelope = {
          version: SENSORY_STORAGE_VERSION,
          suggestions: Array.from(this.cache.values()),
          updatedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(this.storageKey, JSON.stringify(envelope));
      });

    this.flushPromise = currentWrite.catch((error) => {
      console.error('SensoryStorageService: Error persisting to AsyncStorage', error);
    });

    return currentWrite;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('SensoryStorageService: Listener error', e);
      }
    });
  }
}

export const sensoryStorageService = new SensoryStorageService();
export default sensoryStorageService;
