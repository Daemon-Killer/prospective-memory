import React from 'react';
import {
  StyleSheet,
  FlatList,
  RefreshControl,
  View,
} from 'react-native';
import { Reminder, isReminderArmed } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import { ReminderCard } from './ReminderCard';
import { EmptyState } from './EmptyState';
import { useTheme } from '../theme/ThemeContext';

export interface ReminderListProps {
  reminders: Reminder[];
  themeColors?: ThemeColors;
  onToggleComplete: (id: string) => void;
  onSnoozePress: (reminder: Reminder) => void;
  onDeletePress?: (id: string) => void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  currentTime?: Date;
  testID?: string;
}

export const ReminderList: React.FC<ReminderListProps> = ({
  reminders,
  themeColors: propColors,
  onToggleComplete,
  onSnoozePress,
  onDeletePress,
  onRefresh,
  isRefreshing = false,
  currentTime = new Date(),
  testID = 'reminder-list',
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  if (reminders.length === 0) {
    return (
      <View testID={testID} style={[styles.container, { backgroundColor: themeColors.background }]}>
        <EmptyState themeColors={themeColors} />
      </View>
    );
  }


  // Inbox (unarmed) first, then armed by dueDate, completed last
  const sortedReminders = [...reminders].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;

    const aInbox = !isReminderArmed(a);
    const bInbox = !isReminderArmed(b);
    if (aInbox && !bInbox) return -1;
    if (!aInbox && bInbox) return 1;
    if (aInbox && bInbox) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    const timeA = new Date(a.dueDate).getTime();
    const timeB = new Date(b.dueDate).getTime();
    return timeA - timeB;
  });

  return (
    <View testID={testID} style={[styles.container, { backgroundColor: themeColors.background }]}>
      <FlatList
        data={sortedReminders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ReminderCard
            reminder={item}
            themeColors={themeColors}
            onToggleComplete={onToggleComplete}
            onSnoozePress={onSnoozePress}
            onDeletePress={onDeletePress}
            currentTime={currentTime}
          />
        )}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={themeColors.textPrimary}
              colors={[themeColors.textPrimary]}
            />
          ) : undefined
        }
        contentContainerStyle={[styles.listContent, { backgroundColor: themeColors.background }]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
});

export default ReminderList;
