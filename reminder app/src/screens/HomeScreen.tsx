import React, { useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../theme/ThemeContext';
import { useReminders } from '../hooks/useReminders';
import { useNotifications } from '../hooks/useNotifications';
import { Masthead } from '../components/Masthead';
import { ReminderList } from '../components/ReminderList';
import { QuickCaptureBar } from '../components/QuickCaptureBar';
import { SnoozeModal } from '../components/SnoozeModal';
import { Reminder, SnoozePreset } from '../types/reminder';

export interface HomeScreenProps {
  reminders?: Reminder[];
  onCreateReminder?: (input: { title: string; dueDate: Date; preset?: SnoozePreset }) => Promise<void> | void;
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

  const reminders = propReminders ?? remindersHook.reminders;
  const activeCount = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed').length;
  const snoozedCount = reminders.filter((r) => r.snoozeCount > 0 && r.status !== 'completed').length;
  const completedCount = reminders.filter((r) => r.status === 'completed').length;

  const handleCreateReminder = async (input: { title: string; dueDate: Date; preset?: SnoozePreset }) => {
    if (propOnCreate) {
      await propOnCreate(input);
    } else {
      await remindersHook.createReminder({
        title: input.title,
        dueDate: input.dueDate.toISOString(),
      });
    }
  };

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
            onRefresh={propOnRefresh}
            isRefreshing={propIsRefreshing}
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
