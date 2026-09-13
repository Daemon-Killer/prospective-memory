import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Reminder,
  CreateReminderInput,
  UpdateReminderInput,
  SnoozePreset,
  isReminderArmed,
} from '../types/reminder';
import { storageService, IReminderRepository } from '../services/storageService';
import { notificationService, INotificationService } from '../services/notificationService';

export interface UseRemindersState {
  reminders: Reminder[];
  pendingReminders: Reminder[];
  snoozedReminders: Reminder[];
  completedReminders: Reminder[];
  activeReminders: Reminder[];
  overdueReminders: Reminder[];
  todayReminders: Reminder[];
  activeCount: number;
  snoozedCount: number;
  completedCount: number;
  overdueCount: number;
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
}

export interface UseRemindersActions {
  createReminder: (input: CreateReminderInput) => Promise<Reminder>;
  updateReminder: (id: string, updates: UpdateReminderInput) => Promise<Reminder>;
  snoozeReminder: (id: string, targetDate: Date, preset?: SnoozePreset) => Promise<Reminder>;
  toggleComplete: (id: string) => Promise<Reminder>;
  deleteReminder: (id: string) => Promise<boolean>;
  clearAll: () => Promise<void>;
  refresh: () => void;
}

export type UseRemindersResult = UseRemindersState & UseRemindersActions;

export function useReminders(
  repo: IReminderRepository = storageService,
  notifier: INotificationService = notificationService
): UseRemindersResult {
  // Synchronous 0ms read from hydrated cache if ready
  const isInitiallyReady = repo.isReady();
  const [reminders, setReminders] = useState<Reminder[]>(() =>
    isInitiallyReady ? repo.getAll() : []
  );
  const [isReady, setIsReady] = useState<boolean>(isInitiallyReady);
  const [isLoading, setIsLoading] = useState<boolean>(!isInitiallyReady);
  const [error, setError] = useState<Error | null>(null);

  // Sync state from repository cache
  const syncState = useCallback(() => {
    try {
      const all = repo.getAll();
      setReminders(all);
      setIsReady(true);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [repo]);

  // Initial hydration and storage subscription
  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      try {
        if (!repo.isReady()) {
          setIsLoading(true);
          await repo.init();
        }
        if (isMounted) {
          syncState();
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    }

    initialize();

    // Subscribe to synchronous cache updates
    const unsubscribe = repo.subscribe(() => {
      if (isMounted) {
        syncState();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [repo, syncState]);

  // Derived selectors
  const nowTs = Date.now();

  const pendingReminders = useMemo(
    () => reminders.filter((r) => r.status === 'pending'),
    [reminders]
  );

  const snoozedReminders = useMemo(
    () => reminders.filter((r) => r.status === 'snoozed'),
    [reminders]
  );

  const completedReminders = useMemo(
    () =>
      reminders
        .filter((r) => r.status === 'completed')
        .sort((a, b) => {
          const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return timeB - timeA;
        }),
    [reminders]
  );

  const activeReminders = useMemo(
    () => reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed'),
    [reminders]
  );

  const overdueReminders = useMemo(
    () =>
      activeReminders.filter(
        (r) => isReminderArmed(r) && new Date(r.dueDate).getTime() < nowTs
      ),
    [activeReminders, nowTs]
  );

  const todayReminders = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    return activeReminders.filter((r) => {
      if (!isReminderArmed(r)) return false;
      const dt = new Date(r.dueDate);
      return (
        dt.getFullYear() === y &&
        dt.getMonth() === m &&
        dt.getDate() === d
      );
    });
  }, [activeReminders]);

  // Mutations
  const createReminder = useCallback(
    async (input: CreateReminderInput): Promise<Reminder> => {
      try {
        setError(null);
        // 1. Optimistic creation in storage repository
        const created = await repo.create(input);

        // 2. Schedule OS notification if armed and due in future
        if (isReminderArmed(created) && new Date(created.dueDate).getTime() > Date.now()) {
          const notifId = await notifier.scheduleReminderNotification(created);
          if (notifId && notifId !== created.notificationId) {
            await repo.setNotificationId(created.id, notifId);
          }
        }
        return created;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        syncState();
        throw errorObj;
      }
    },
    [repo, notifier, syncState]
  );

  const updateReminder = useCallback(
    async (id: string, updates: UpdateReminderInput): Promise<Reminder> => {
      try {
        setError(null);
        const existing = repo.getById(id);
        const updated = await repo.update(id, updates);

        // Synchronize notification scheduling
        if (updates.status === 'completed' && existing?.notificationId) {
          await notifier.cancelReminderNotification(existing.notificationId);
          await repo.setNotificationId(id, null);
        } else if (
          (updates.dueDate || updates.status || updates.armed) &&
          updated.status !== 'completed' &&
          isReminderArmed(updated) &&
          new Date(updated.dueDate).getTime() > Date.now()
        ) {
          if (existing?.notificationId) {
            await notifier.cancelReminderNotification(existing.notificationId);
          }
          const notifId = await notifier.scheduleReminderNotification(updated);
          if (notifId) {
            await repo.setNotificationId(id, notifId);
          }
        }

        return updated;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        syncState();
        throw errorObj;
      }
    },
    [repo, notifier, syncState]
  );

  const snoozeReminder = useCallback(
    async (id: string, targetDate: Date, preset?: SnoozePreset): Promise<Reminder> => {
      try {
        setError(null);
        const existing = repo.getById(id);
        if (existing?.notificationId) {
          await notifier.cancelReminderNotification(existing.notificationId);
        }

        // Optimistic storage snooze
        const snoozed = await repo.snooze(id, targetDate, preset);

        // Schedule new alert
        const notifId = await notifier.scheduleReminderNotification(snoozed);
        if (notifId) {
          await repo.setNotificationId(id, notifId);
        }

        return snoozed;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        syncState();
        throw errorObj;
      }
    },
    [repo, notifier, syncState]
  );

  const toggleComplete = useCallback(
    async (id: string): Promise<Reminder> => {
      try {
        setError(null);
        const existing = repo.getById(id);
        const toggled = await repo.toggleComplete(id);

        if (toggled.status === 'completed') {
          // Cancel active notification
          if (existing?.notificationId) {
            await notifier.cancelReminderNotification(existing.notificationId);
          }
        } else {
          // Reopened: reschedule if due in future
          if (isReminderArmed(toggled) && new Date(toggled.dueDate).getTime() > Date.now()) {
            const notifId = await notifier.scheduleReminderNotification(toggled);
            if (notifId) {
              await repo.setNotificationId(id, notifId);
            }
          }
        }

        return toggled;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        syncState();
        throw errorObj;
      }
    },
    [repo, notifier, syncState]
  );

  const deleteReminder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        setError(null);
        const existing = repo.getById(id);
        if (existing?.notificationId) {
          await notifier.cancelReminderNotification(existing.notificationId);
        }
        return await repo.delete(id);
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        syncState();
        throw errorObj;
      }
    },
    [repo, notifier, syncState]
  );

  const clearAll = useCallback(async () => {
    try {
      setError(null);
      const active = repo.getActive();
      for (const r of active) {
        if (r.notificationId) {
          await notifier.cancelReminderNotification(r.notificationId);
        }
      }
      await repo.clear();
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      syncState();
      throw errorObj;
    }
  }, [repo, notifier, syncState]);

  return {
    reminders,
    pendingReminders,
    snoozedReminders,
    completedReminders,
    activeReminders,
    overdueReminders,
    todayReminders,
    activeCount: activeReminders.length,
    snoozedCount: snoozedReminders.length,
    completedCount: completedReminders.length,
    overdueCount: overdueReminders.length,
    isReady,
    isLoading,
    error,
    createReminder,
    updateReminder,
    snoozeReminder,
    toggleComplete,
    deleteReminder,
    clearAll,
    refresh: syncState,
  };
}

export default useReminders;
