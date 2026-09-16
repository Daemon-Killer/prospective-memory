import React from 'react';
import {
  StyleSheet,
  FlatList,
  RefreshControl,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Reminder, isReminderArmed } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import { ReminderCard } from './ReminderCard';
import { EmptyState } from './EmptyState';
import { useTheme } from '../theme/ThemeContext';

export type ReminderFilter = 'all' | 'inbox' | 'watchlist' | 'armed';

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
  initialFilter?: ReminderFilter;
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
  initialFilter = 'all',
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  const [activeFilter, setActiveFilter] = React.useState<ReminderFilter>(initialFilter);

  const filteredReminders = React.useMemo(() => {
    return reminders.filter((item) => {
      if (activeFilter === 'inbox') {
        return !isReminderArmed(item) && !item.culturalMetadata;
      }
      if (activeFilter === 'watchlist') {
        return Boolean(item.culturalMetadata);
      }
      if (activeFilter === 'armed') {
        return isReminderArmed(item);
      }
      return true;
    });
  }, [reminders, activeFilter]);

  if (reminders.length === 0) {
    return (
      <View testID={testID} style={[styles.container, { backgroundColor: themeColors.background }]}>
        <EmptyState themeColors={themeColors} />
      </View>
    );
  }

  // Inbox (unarmed) first, then armed by dueDate, completed last
  const sortedReminders = [...filteredReminders].sort((a, b) => {
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

  const watchlistCount = reminders.filter((r) => Boolean(r.culturalMetadata)).length;

  return (
    <View testID={testID} style={[styles.container, { backgroundColor: themeColors.background }]}>
      {/* Swiss Void Filter Bar */}
      <View testID="reminder-filter-bar" style={[styles.filterBar, { borderBottomColor: themeColors.border }]}>
        {(['all', 'inbox', 'watchlist', 'armed'] as ReminderFilter[]).map((filter) => {
          const isSelected = activeFilter === filter;
          const label =
            filter === 'watchlist' && watchlistCount > 0
              ? `WATCH (${watchlistCount})`
              : filter.toUpperCase();

          return (
            <TouchableOpacity
              key={filter}
              testID={`filter-chip-${filter}`}
              style={[
                styles.filterChip,
                {
                  borderColor: isSelected ? themeColors.textPrimary : themeColors.border,
                  backgroundColor: isSelected ? themeColors.surface : 'transparent',
                },
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: isSelected ? themeColors.textPrimary : themeColors.textSecondary,
                    fontWeight: isSelected ? '900' : '700',
                  },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {sortedReminders.length === 0 ? (
        <View testID="filter-empty-state" style={styles.filterEmptyBox}>
          <EmptyState themeColors={themeColors} />
        </View>
      ) : (
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
      )}
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
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 2,
  },
  filterChipText: {
    fontSize: 10,
    letterSpacing: 1,
  },
  filterEmptyBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default ReminderList;
