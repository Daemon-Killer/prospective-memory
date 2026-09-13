import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../theme/ThemeContext';
import { useReminders } from '../hooks/useReminders';
import { useNotifications } from '../hooks/useNotifications';
import { remyCaptureService } from '../services/remyCaptureService';
import { cloudSyncService } from '../services/cloudSyncService';
import { Masthead } from '../components/Masthead';
import { ReminderList } from '../components/ReminderList';
import { QuickCaptureBar } from '../components/QuickCaptureBar';
import { SnoozeModal } from '../components/SnoozeModal';
import { Reminder, SnoozePreset } from '../types/reminder';
import { CapturePreset, compileMultiLineCapture, getStoredLingo } from '../utils/captureCompiler';

export interface HomeScreenProps {
  reminders?: Reminder[];
  onCreateReminder?: (input: {
    title: string;
    dueDate: Date;
    preset?: CapturePreset;
    armed?: boolean;
  }) => Promise<void> | void;
  onToggleComplete?: (id: string) => Promise<void> | void;
  onSnoozeReminder?: (reminder: Reminder) => void;
  onDeleteReminder?: (id: string) => Promise<void> | void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
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
  testID = 'home-screen',
}) => {
  const { colors, mode, cycleTheme } = useTheme();
  const remindersHook = useReminders();

  const [selectedReminderForSnooze, setSelectedReminderForSnooze] = useState<Reminder | null>(null);
  const [snoozeModalVisible, setSnoozeModalVisible] = useState<boolean>(false);

  const handleCreateReminder = useCallback(
    async (input: {
      title: string;
      dueDate: Date;
      preset?: CapturePreset;
      armed?: boolean;
    }) => {
      if (propOnCreate) {
        await propOnCreate(input);
      } else {
        await remindersHook.createReminder({
          title: input.title,
          dueDate: input.dueDate.toISOString(),
          armed: input.armed,
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
              title: item.title,
              dueDate: new Date(item.dueDate),
              armed: item.armed,
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
        await cloudSyncService.syncNow();
      } finally {
        setInternalRefreshing(false);
      }
    }
  }, [propOnRefresh]);

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
