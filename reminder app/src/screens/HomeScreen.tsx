import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, AppState, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../theme/ThemeContext';
import { useReminders } from '../hooks/useReminders';
import { useNotifications } from '../hooks/useNotifications';
import { remyCaptureService } from '../services/remyCaptureService';
import { cloudSyncService } from '../services/cloudSyncService';
import { sensoryStorageService } from '../sensory/sensoryStorageService';
import { dealsStorageService } from '../sensory/dealsStorageService';
import { sensoryBridge } from '../sensory/sensoryBridge';
import { intentClassifier } from '../sensory/intentClassifier';
import { SensorySuggestion, VoucherItem } from '../sensory/types';
import { Masthead } from '../components/Masthead';
import { SensoryInboxShelf } from '../components/SensoryInboxShelf';
import { DealsRadarScreen } from './DealsRadarScreen';
import { ReminderList } from '../components/ReminderList';
import { QuickCaptureBar } from '../components/QuickCaptureBar';
import { SnoozeModal } from '../components/SnoozeModal';
import { Reminder, SnoozePreset } from '../types/reminder';
import { CapturePreset, compileMultiLineCapture, getStoredLingo } from '../utils/captureCompiler';

export interface HomeScreenProps {
  reminders?: Reminder[];
  onCreateReminder?: (input: {
    id?: string;
    title: string;
    dueDate: Date;
    preset?: CapturePreset;
    armed?: boolean;
    inkData?: string | null;
  }) => Promise<void> | void;
  onToggleComplete?: (id: string) => Promise<void> | void;
  onSnoozeReminder?: (reminder: Reminder) => void;
  onDeleteReminder?: (id: string) => Promise<void> | void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  suggestions?: SensorySuggestion[];
  onAcceptSuggestion?: (id: string) => Promise<void> | void;
  onDismissSuggestion?: (id: string) => Promise<void> | void;
  vouchers?: VoucherItem[];
  onOpenDealsRadar?: () => void;
  testID?: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  reminders: propReminders,
  onCreateReminder: propOnCreate,
  onToggleComplete: propOnToggleComplete,
  onSnoozeReminder: propOnSnooze,
  onDeleteReminder: propOnDelete,
  onRefresh: propOnRefresh,
  isRefreshing: propIsRefreshing,
  suggestions: propSuggestions,
  onAcceptSuggestion: propOnAcceptSuggestion,
  onDismissSuggestion: propOnDismissSuggestion,
  vouchers: propVouchers,
  onOpenDealsRadar: propOnOpenDealsRadar,
  testID = 'home-screen',
}) => {
  const { colors, mode, cycleTheme } = useTheme();
  const remindersHook = useReminders();

  const [selectedReminderForSnooze, setSelectedReminderForSnooze] = useState<Reminder | null>(null);
  const [snoozeModalVisible, setSnoozeModalVisible] = useState<boolean>(false);
  const [dealsRadarVisible, setDealsRadarVisible] = useState<boolean>(false);

  const [internalSuggestions, setInternalSuggestions] = useState<SensorySuggestion[]>(() =>
    sensoryStorageService.getPendingSuggestions()
  );
  const [internalVouchers, setInternalVouchers] = useState<VoucherItem[]>(() =>
    dealsStorageService.getVouchers()
  );

  const suggestions = propSuggestions ?? internalSuggestions;
  const vouchers = propVouchers ?? internalVouchers;

  // Initialize and subscribe to sensory and deals storage
  useEffect(() => {
    let isMounted = true;
    sensoryStorageService.init().then(() => {
      if (isMounted) {
        setInternalSuggestions(sensoryStorageService.getPendingSuggestions());
      }
    });
    dealsStorageService.init().then(() => {
      if (isMounted) {
        setInternalVouchers(dealsStorageService.getVouchers());
      }
    });

    const unsubSensory = sensoryStorageService.subscribe(() => {
      if (isMounted) {
        setInternalSuggestions(sensoryStorageService.getPendingSuggestions());
      }
    });
    const unsubDeals = dealsStorageService.subscribe(() => {
      if (isMounted) {
        setInternalVouchers(dealsStorageService.getVouchers());
      }
    });

    // Wire live incoming notification routing from sensoryBridge
    const routeNotification = async (payload: any) => {
      try {
        const result = intentClassifier.classify(payload);
        if (result.stream === 'actionable' && result.actionable) {
          await sensoryStorageService.addFromExtraction(result.actionable, payload);
        } else if (result.stream === 'deal' && result.deal) {
          await dealsStorageService.addFromExtraction(result.deal, payload);
        }
      } catch (err) {
        console.warn('HomeScreen: Error routing live sensory notification:', err);
      }
    };

    const unsubBridge = sensoryBridge.onNotification((payload) => {
      routeNotification(payload);
    });

    return () => {
      isMounted = false;
      unsubSensory();
      unsubDeals();
      unsubBridge();
    };
  }, []);

  const drainSensoryQueue = useCallback(async () => {
    try {
      const pending = await sensoryBridge.drainPendingNotifications();
      for (const payload of pending) {
        const result = intentClassifier.classify(payload);
        if (result.stream === 'actionable' && result.actionable) {
          await sensoryStorageService.addFromExtraction(result.actionable, payload);
        } else if (result.stream === 'deal' && result.deal) {
          await dealsStorageService.addFromExtraction(result.deal, payload);
        }
      }
    } catch (err) {
      console.warn('HomeScreen: Error draining sensory notifications:', err);
    }
  }, []);

  const handleAcceptSuggestion = useCallback(
    async (id: string) => {
      if (propOnAcceptSuggestion) {
        await propOnAcceptSuggestion(id);
      } else {
        await sensoryStorageService.acceptSuggestion(id);
      }
    },
    [propOnAcceptSuggestion]
  );

  const handleDismissSuggestion = useCallback(
    async (id: string) => {
      if (propOnDismissSuggestion) {
        await propOnDismissSuggestion(id);
      } else {
        await sensoryStorageService.dismissSuggestion(id);
      }
    },
    [propOnDismissSuggestion]
  );

  const handleOpenRadar = useCallback(() => {
    if (propOnOpenDealsRadar) {
      propOnOpenDealsRadar();
    } else {
      setDealsRadarVisible(true);
    }
  }, [propOnOpenDealsRadar]);

  const handleCreateReminder = useCallback(
    async (input: {
      id?: string;
      title: string;
      dueDate: Date;
      preset?: CapturePreset;
      armed?: boolean;
      inkData?: string | null;
    }) => {
      if (propOnCreate) {
        await propOnCreate(input);
      } else {
        await remindersHook.createReminder({
          id: input.id,
          title: input.title,
          dueDate: input.dueDate.toISOString(),
          armed: input.armed,
          inkData: input.inkData,
        });
      }
    },
    [propOnCreate, remindersHook]
  );

  // Handle notification body tap routing
  const handleOpenSnoozeModalFromNotification = useCallback(
    (reminderId: string) => {
      const target = remindersHook.reminders.find((r) => r.id === reminderId);
      if (target) {
        setSelectedReminderForSnooze(target);
        setSnoozeModalVisible(true);
      }
    },
    [remindersHook.reminders]
  );

  useNotifications({
    onOpenSnoozeModal: handleOpenSnoozeModalFromNotification,
  });

  // Check for incoming shared text from system-level ingress (Android Intent.ACTION_SEND)
  // and pending thought captures from QuickCaptureActivity
  useEffect(() => {
    let isMounted = true;
    const processIngress = async () => {
      try {
        // 1. Process shared text from ACTION_SEND
        const shared = await remyCaptureService.getSharedText();
        if (shared && shared.trim().length > 0 && isMounted) {
          const lingo = await getStoredLingo();
          const drafts = compileMultiLineCapture(shared.trim(), 'inbox', new Date(), lingo);
          for (const draft of drafts) {
            await handleCreateReminder({
              title: draft.title,
              dueDate: draft.dueDate,
              preset: draft.preset,
              armed: draft.armed,
            });
          }
          await remyCaptureService.clearSharedText();
        }

        // 2. Process pending thought captures from QuickCaptureActivity
        const pending = await remyCaptureService.getPendingCaptures();
        if (pending && pending.length > 0 && isMounted) {
          for (const item of pending) {
            await handleCreateReminder({
              id: item.id,
              title: item.title,
              dueDate: new Date(item.dueDate),
              armed: item.armed,
              inkData: item.inkData,
            });
          }
          await remyCaptureService.clearPendingCaptures();
        }
      } catch (err) {
        console.warn('HomeScreen: Error consuming ingress captures:', err);
      }
    };

    processIngress();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isMounted) {
        processIngress();
        drainSensoryQueue();
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [handleCreateReminder]);

  const reminders = propReminders ?? remindersHook.reminders;
  const activeCount = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed').length;
  const snoozedCount = reminders.filter((r) => r.snoozeCount > 0 && r.status !== 'completed').length;
  const completedCount = reminders.filter((r) => r.status === 'completed').length;


  const handleToggleComplete = async (id: string) => {
    if (propOnToggleComplete) {
      await propOnToggleComplete(id);
    } else {
      await remindersHook.toggleComplete(id);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    if (propOnDelete) {
      await propOnDelete(id);
    } else {
      await remindersHook.deleteReminder(id);
    }
  };

  const handleOpenSnooze = (reminder: Reminder) => {
    if (propOnSnooze) {
      propOnSnooze(reminder);
    } else {
      setSelectedReminderForSnooze(reminder);
      setSnoozeModalVisible(true);
    }
  };

  const handleCloseSnoozeModal = () => {
    setSnoozeModalVisible(false);
    setSelectedReminderForSnooze(null);
  };

  const handleConfirmSnooze = async (reminderId: string, targetDate: Date, preset?: SnoozePreset) => {
    await remindersHook.snoozeReminder(reminderId, targetDate, preset);
  };

  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const isRefreshing = propIsRefreshing ?? internalRefreshing;

  const handleRefresh = useCallback(async () => {
    if (propOnRefresh) {
      await propOnRefresh();
    } else {
      setInternalRefreshing(true);
      try {
        await Promise.all([
          cloudSyncService.syncNow(),
          drainSensoryQueue(),
        ]);
      } finally {
        setInternalRefreshing(false);
      }
    }
  }, [propOnRefresh, drainSensoryQueue]);

  return (
    <SafeAreaView testID={testID} style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <View style={styles.mainLayout}>
        <Masthead
          activeCount={activeCount}
          snoozedCount={snoozedCount}
          completedCount={completedCount}
          themeColors={colors}
          themeMode={mode}
          onCycleTheme={cycleTheme}
          onOpenDealsRadar={handleOpenRadar}
          voucherCount={vouchers.length}
        />

        <SensoryInboxShelf
          suggestions={suggestions}
          onAccept={handleAcceptSuggestion}
          onDismiss={handleDismissSuggestion}
          onOpenDealsRadar={handleOpenRadar}
          themeColors={colors}
        />

        <View style={styles.listWrapper}>
          <ReminderList
            reminders={reminders}
            themeColors={colors}
            onToggleComplete={handleToggleComplete}
            onSnoozePress={handleOpenSnooze}
            onDeletePress={handleDeleteReminder}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
          />
        </View>

        <QuickCaptureBar
          onCreateReminder={handleCreateReminder}
          themeColors={colors}
        />

        <SnoozeModal
          visible={snoozeModalVisible}
          reminder={selectedReminderForSnooze}
          onClose={handleCloseSnoozeModal}
          onSnooze={handleConfirmSnooze}
          themeColors={colors}
        />

        <Modal
          visible={dealsRadarVisible}
          animationType="slide"
          onRequestClose={() => setDealsRadarVisible(false)}
        >
          <DealsRadarScreen
            vouchers={vouchers}
            onCopyVoucher={async (id) => {
              await dealsStorageService.recordCopy(id);
            }}
            onPurgeExpired={async () => {
              await dealsStorageService.purgeExpired();
            }}
            onBack={() => setDealsRadarVisible(false)}
            onClose={() => setDealsRadarVisible(false)}
            themeColors={colors}
          />
        </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mainLayout: {
    flex: 1,
  },
  listWrapper: {
    flex: 1,
  },
});

export default HomeScreen;
