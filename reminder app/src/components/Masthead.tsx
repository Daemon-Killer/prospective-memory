import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors, ThemeMode } from '../types/theme';
import { formatMastheadDate } from '../utils/dateFormatting';
import { useTheme } from '../theme/ThemeContext';
import { ThemeToggle } from './ThemeToggle';

export interface MastheadProps {
  activeCount: number;
  snoozedCount: number;
  completedCount: number;
  currentDate?: Date;
  themeColors?: ThemeColors;
  themeMode?: ThemeMode;
  onCycleTheme?: () => void;
  testID?: string;
}

export const Masthead: React.FC<MastheadProps> = ({
  activeCount,
  snoozedCount,
  completedCount,
  currentDate = new Date(),
  themeColors: propColors,
  themeMode: propMode,
  onCycleTheme: propCycleTheme,
  testID = 'masthead',
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;
  const themeMode = propMode ?? theme.mode;
  const onCycleTheme = propCycleTheme ?? theme.cycleTheme;

  const dateFormatted = formatMastheadDate(currentDate);

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: themeColors.background,
          borderBottomColor: themeColors.borderStrong,
        },
      ]}
    >
      {/* Top Utility Row */}
      <View style={styles.topRow}>
        <Text style={[styles.brandTitle, { color: themeColors.textMuted }]}>
          REMY // PROSPECTIVE MEMORY
        </Text>
        <ThemeToggle
          mode={themeMode}
          colors={themeColors}
          onCycle={onCycleTheme}
        />
      </View>

      {/* Massive Architectural Date Header */}
      <Text
        testID="masthead-date"
        style={[styles.dateTitle, { color: themeColors.textPrimary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {dateFormatted}
      </Text>

      {/* Live Counter Ledger Grid */}
      <View
        style={[
          styles.counterRow,
          {
            borderColor: themeColors.border,
            backgroundColor: themeColors.surface,
          },
        ]}
      >
        <View style={[styles.counterCell, { borderRightColor: themeColors.border }]}>
          <Text
            testID="count-active"
            style={[styles.counterValue, { color: themeColors.textPrimary }]}
          >
            {String(activeCount).padStart(2, '0')}
          </Text>
          <Text style={[styles.counterLabel, { color: themeColors.textSecondary }]}>
            ACTIVE
          </Text>
        </View>

        <View style={[styles.counterCell, { borderRightColor: themeColors.border }]}>
          <Text
            testID="count-snoozed"
            style={[styles.counterValue, { color: themeColors.warning }]}
          >
            {String(snoozedCount).padStart(2, '0')}
          </Text>
          <Text style={[styles.counterLabel, { color: themeColors.textSecondary }]}>
            SNOOZED
          </Text>
        </View>

        <View style={styles.counterCell}>
          <Text
            testID="count-completed"
            style={[styles.counterValue, { color: themeColors.success }]}
          >
            {String(completedCount).padStart(2, '0')}
          </Text>
          <Text style={[styles.counterLabel, { color: themeColors.textSecondary }]}>
            DONE
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  dateTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  counterRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 0,
  },
  counterCell: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
  },
  counterValue: {
    fontSize: 20,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    lineHeight: 24,
  },
  counterLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 2,
  },
});

export default Masthead;
