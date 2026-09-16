import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ThemeColors, ThemeMode } from '../types/theme';
import { formatMastheadDate } from '../utils/dateFormatting';
import { useTheme } from '../theme/ThemeContext';
import { ThemeToggle } from './ThemeToggle';
import { CloudSyncModal } from './CloudSyncModal';
import { cloudSyncService, CloudSyncState } from '../services/cloudSyncService';

export interface MastheadProps {
  activeCount: number;
  snoozedCount: number;
  completedCount: number;
  currentDate?: Date;
  themeColors?: ThemeColors;
  themeMode?: ThemeMode;
  onCycleTheme?: () => void;
  onOpenDealsRadar?: () => void;
  voucherCount?: number;
  onOpenWatchlist?: () => void;
  watchlistCount?: number;
  onOpenBubbleSettings?: () => void;
  isBubbleActive?: boolean;
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
  onOpenDealsRadar,
  voucherCount = 0,
  onOpenWatchlist,
  watchlistCount = 0,
  onOpenBubbleSettings,
  isBubbleActive = false,
  testID = 'masthead',
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;
  const themeMode = propMode ?? theme.mode;
  const onCycleTheme = propCycleTheme ?? theme.cycleTheme;

  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [syncState, setSyncState] = useState<CloudSyncState>(cloudSyncService.getState());

  useEffect(() => {
    cloudSyncService.init();
    const unsubscribe = cloudSyncService.subscribe((state) => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  const dateFormatted = formatMastheadDate(currentDate);

  const getDotColor = (state: CloudSyncState) => {
    switch (state) {
      case 'syncing':
        return '#3B82F6';
      case 'synced':
        return '#10B981';
      case 'error':
        return '#EF4444';
      case 'disabled':
        return '#6B7280';
      default:
        return '#10B981';
    }
  };

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
        <View style={styles.utilityActions}>
          {onOpenDealsRadar && (
            <TouchableOpacity
              testID="deals-radar-btn"
              style={[
                styles.cloudBtn,
                { borderColor: themeColors.border, backgroundColor: themeColors.surface },
              ]}
              onPress={onOpenDealsRadar}
              accessibilityLabel="Open Deals & Voucher Radar"
            >
              <View
                style={[
                  styles.cloudDot,
                  { backgroundColor: voucherCount > 0 ? themeColors.accent : '#6B7280' },
                ]}
              />
              <Text style={[styles.cloudText, { color: themeColors.textMuted }]}>RADAR</Text>
            </TouchableOpacity>
          )}
          {onOpenWatchlist && (
            <TouchableOpacity
              testID="watchlist-btn"
              style={[
                styles.cloudBtn,
                { borderColor: themeColors.border, backgroundColor: themeColors.surface },
              ]}
              onPress={onOpenWatchlist}
              accessibilityLabel="Open Cultural Watchlist"
            >
              <View
                style={[
                  styles.cloudDot,
                  { backgroundColor: watchlistCount > 0 ? '#38BDF8' : '#6B7280' },
                ]}
              />
              <Text style={[styles.cloudText, { color: themeColors.textMuted }]}>WATCH</Text>
            </TouchableOpacity>
          )}
          {onOpenBubbleSettings && (
            <TouchableOpacity
              testID="bubble-settings-btn"
              style={[
                styles.cloudBtn,
                { borderColor: themeColors.border, backgroundColor: themeColors.surface },
              ]}
              onPress={onOpenBubbleSettings}
              accessibilityLabel="Floating Bubble Overlay Settings"
            >
              <View
                style={[
                  styles.cloudDot,
                  { backgroundColor: isBubbleActive ? '#10B981' : '#6B7280' },
                ]}
              />
              <Text style={[styles.cloudText, { color: themeColors.textMuted }]}>BUBBLE</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            testID="cloud-sync-btn"
            style={[
              styles.cloudBtn,
              { borderColor: themeColors.border, backgroundColor: themeColors.surface },
            ]}
            onPress={() => setModalVisible(true)}
            accessibilityLabel="Cloud Sync Settings"
          >
            <View style={[styles.cloudDot, { backgroundColor: getDotColor(syncState) }]} />
            <Text style={[styles.cloudText, { color: themeColors.textMuted }]}>CLOUD</Text>
          </TouchableOpacity>
          <ThemeToggle
            mode={themeMode}
            colors={themeColors}
            onCycle={onCycleTheme}
          />
        </View>
      </View>

      <CloudSyncModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        colors={themeColors}
      />

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
  utilityActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cloudBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  cloudDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  cloudText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
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
