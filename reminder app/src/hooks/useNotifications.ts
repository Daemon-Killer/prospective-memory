/**
 * Remy Reminders - Notification Hook
 * Milestone 2 Implementation
 *
 * Provides:
 * 1. Permissions querying and requesting
 * 2. Response listener routing (DEFAULT_ACTION_IDENTIFIER -> open snooze modal, action buttons -> handleNotificationResponse)
 * 3. Cold boot notification response check
 * 4. Cold boot alarm reconciliation sweep
 * 5. Safe platform degradation on Web
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notificationService } from '../services/notificationService';

export interface UseNotificationsOptions {
  onOpenSnoozeModal?: (reminderId: string) => void;
  autoRequestPermissions?: boolean;
}

export interface UseNotificationsResult {
  hasPermission: boolean | null;
  requestPermissions: () => Promise<boolean>;
  reconcile: () => Promise<{ activeCount: number; rescheduledCount: number; purgedCount: number }>;
}

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsResult {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const granted = await notificationService.requestPermissions();
    setHasPermission(granted);
    return granted;
  }, []);

  const reconcile = useCallback(async () => {
    return notificationService.reconcileActiveReminders();
  }, []);

  useEffect(() => {
    let responseSubscription: { remove: () => void } | null = null;
    let receivedSubscription: { remove: () => void } | null = null;
    let isMounted = true;

    async function setup() {
      await notificationService.init();

      if (optionsRef.current.autoRequestPermissions !== false) {
        const granted = await notificationService.requestPermissions();
        if (isMounted) {
          setHasPermission(granted);
        }
      }

      await notificationService.reconcileActiveReminders();

      if (Platform.OS !== 'web') {
        // Notification response listener (action buttons & body tap)
        if (typeof Notifications.addNotificationResponseReceivedListener === 'function') {
          responseSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
            const actionId = response.actionIdentifier;
            const reminderId =
              (response.notification?.request?.content?.data?.reminderId as string | undefined) ||
              (response.notification?.request?.content?.data as any)?.id;

            if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
              // Body tap -> route to target reminder and open snooze modal
              if (reminderId && optionsRef.current.onOpenSnoozeModal) {
                optionsRef.current.onOpenSnoozeModal(reminderId);
              }
            } else if (reminderId) {
              // Foreground action button tap
              await notificationService.handleNotificationResponse(actionId, reminderId);
            }
          });
        }

        // Cold-boot notification response check
        if (typeof Notifications.getLastNotificationResponseAsync === 'function') {
          try {
            const lastResponse = await Notifications.getLastNotificationResponseAsync();
            if (lastResponse) {
              const actionId = lastResponse.actionIdentifier;
              const reminderId =
                (lastResponse.notification?.request?.content?.data?.reminderId as string | undefined) ||
                (lastResponse.notification?.request?.content?.data as any)?.id;

              if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER && reminderId) {
                if (optionsRef.current.onOpenSnoozeModal) {
                  optionsRef.current.onOpenSnoozeModal(reminderId);
                }
              } else if (reminderId && actionId) {
                await notificationService.handleNotificationResponse(actionId, reminderId);
              }

              if (typeof Notifications.clearLastNotificationResponseAsync === 'function') {
                await Notifications.clearLastNotificationResponseAsync();
              }
            }
          } catch {
            // Safe fallback
          }
        }

        // Foreground notification arrival
        if (typeof Notifications.addNotificationReceivedListener === 'function') {
          receivedSubscription = Notifications.addNotificationReceivedListener((_notification) => {
            // Event hook for foreground reception
          });
        }
      }
    }

    setup();

    return () => {
      isMounted = false;
      responseSubscription?.remove();
      receivedSubscription?.remove();
    };
  }, []);

  return {
    hasPermission,
    requestPermissions,
    reconcile,
  };
}

export default useNotifications;
