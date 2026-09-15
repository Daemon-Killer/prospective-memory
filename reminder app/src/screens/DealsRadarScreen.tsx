/**
 * Remy Reminders - Swiss Void Deals & Voucher Radar Screen
 * 
 * Dedicated surface for merchant promotions, voucher codes, and discount tracking:
 * - True #000000 AMOLED canvas with #FFFFFF crisp typography and #FF4500 signal accents.
 * - Active voucher cards featuring merchant name, discount badge, and promo code.
 * - 1-tap copy of promo code to clipboard with visual copied indicator and haptic feedback.
 * - Dynamic auto-expiry filtering and [EXPIRED] status badges.
 * - Clean Swiss Void empty state with zero visual clutter.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Clipboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { VoucherItem } from '../sensory/types';
import { ThemeColors } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';
import { padZero, formatTabularTime } from '../utils/dateFormatting';

export type DealsFilterMode = 'all' | 'active' | 'expired';

export interface DealsRadarScreenProps {
  vouchers?: VoucherItem[];
  onCopyVoucher?: (id: string) => Promise<void> | void;
  onPurgeExpired?: () => Promise<void> | void;
  onBack?: () => void;
  onClose?: () => void;
  currentTime?: Date;
  themeColors?: ThemeColors;
  testID?: string;
}

/**
 * Robust cross-platform clipboard copy helper supporting Web and React Native.
 */
export async function copyVoucherCodeToClipboard(code: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(code);
      return true;
    }
    Clipboard.setString(code);
    return true;
  } catch (err) {
    try {
      Clipboard.setString(code);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Checks whether a voucher is past its expiry date.
 */
export function isVoucherExpired(voucher: VoucherItem, now: Date = new Date()): boolean {
  if (voucher.isExpired !== undefined) {
    return voucher.isExpired;
  }
  if (!voucher.expiryDate) {
    return false;
  }
  const exp = new Date(voucher.expiryDate);
  if (isNaN(exp.getTime())) return false;
  return exp.getTime() < now.getTime();
}

/**
 * Formats voucher expiry with monospaced tabular clarity.
 */
export function formatVoucherExpiry(
  expiryDate: string | null | undefined,
  now: Date = new Date()
): string {
  if (!expiryDate) return 'NO EXPIRY';
  const exp = new Date(expiryDate);
  if (isNaN(exp.getTime())) return 'UNKNOWN';

  if (exp.getTime() < now.getTime()) {
    return 'EXPIRED';
  }

  const isToday =
    exp.getDate() === now.getDate() &&
    exp.getMonth() === now.getMonth() &&
    exp.getFullYear() === now.getFullYear();

  if (isToday) {
    return `EXPIRES TODAY ${formatTabularTime(exp)}`;
  }

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    exp.getDate() === tomorrow.getDate() &&
    exp.getMonth() === tomorrow.getMonth() &&
    exp.getFullYear() === tomorrow.getFullYear();

  if (isTomorrow) {
    return `EXPIRES TOMORROW ${formatTabularTime(exp)}`;
  }

  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayNum = padZero(exp.getDate());
  const monthName = months[exp.getMonth()];

  return `EXPIRES ${dayNum} ${monthName}`;
}

export const DealsRadarScreen: React.FC<DealsRadarScreenProps> = ({
  vouchers = [],
  onCopyVoucher,
  onPurgeExpired,
  onBack,
  onClose,
  currentTime = new Date(),
  themeColors: propColors,
  testID = 'deals-radar-screen',
}) => {
  const theme = useTheme();
  const colors = propColors ?? theme.colors;

  const [activeFilter, setActiveFilter] = useState<DealsFilterMode>('active');
  const [recentlyCopiedId, setRecentlyCopiedId] = useState<string | null>(null);

  const handleDismissScreen = onBack || onClose;

  // Compute expired status and counts
  const { activeVouchers, expiredVouchers, filteredVouchers } = useMemo(() => {
    const active: VoucherItem[] = [];
    const expired: VoucherItem[] = [];

    vouchers.forEach((v) => {
      const isExp = isVoucherExpired(v, currentTime);
      if (isExp) {
        expired.push({ ...v, isExpired: true });
      } else {
        active.push({ ...v, isExpired: false });
      }
    });

    let filtered: VoucherItem[] = [];
    if (activeFilter === 'all') {
      filtered = [...active, ...expired];
    } else if (activeFilter === 'active') {
      filtered = active;
    } else {
      filtered = expired;
    }

    return {
      activeVouchers: active,
      expiredVouchers: expired,
      filteredVouchers: filtered,
    };
  }, [vouchers, currentTime, activeFilter]);

  const handleCopyCode = useCallback(
    async (voucher: VoucherItem) => {
      if (Platform.OS !== 'web') {
        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {
          // Safe fallback
        }
      }

      await copyVoucherCodeToClipboard(voucher.code);
      setRecentlyCopiedId(voucher.id);

      if (onCopyVoucher) {
        try {
          await onCopyVoucher(voucher.id);
        } catch {
          // Safe fallback
        }
      }

      // Reset copied feedback after 2.5s
      setTimeout(() => {
        setRecentlyCopiedId((curr) => (curr === voucher.id ? null : curr));
      }, 2500);
    },
    [onCopyVoucher]
  );

  const handlePurge = useCallback(async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {
        // Safe fallback
      }
    }
    if (onPurgeExpired) {
      await onPurgeExpired();
    }
  }, [onPurgeExpired]);

  return (
    <SafeAreaView
      testID={testID}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar style="light" />

      {/* Swiss Broadsheet Masthead Header */}
      <View
        testID="deals-radar-header"
        style={[
          styles.headerContainer,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.borderStrong,
          },
        ]}
      >
        {/* Navigation & Utility Row */}
        <View style={styles.topUtilityRow}>
          {handleDismissScreen ? (
            <TouchableOpacity
              testID="deals-radar-back-btn"
              onPress={handleDismissScreen}
              style={[styles.backBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Navigate back"
            >
              <Text
                testID="deals-radar-close-btn"
                onPress={handleDismissScreen}
                style={[styles.backBtnText, { color: colors.textPrimary }]}
              >
                ← BACK
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.brandMeta, { color: colors.textMuted }]}>
              REMY // SENSORY ENGINE
            </Text>
          )}

          {expiredVouchers.length > 0 && onPurgeExpired && (
            <TouchableOpacity
              testID="purge-expired-btn"
              onPress={handlePurge}
              style={[styles.purgeBtn, { borderColor: colors.danger }]}
              accessibilityRole="button"
              accessibilityLabel="Purge expired vouchers"
            >
              <Text
                testID="purge-expired-button"
                onPress={handlePurge}
                style={[styles.purgeBtnText, { color: colors.danger }]}
              >
                PURGE EXPIRED [{expiredVouchers.length}]
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Screen Title */}
        <Text
          testID="deals-radar-title"
          style={[styles.screenTitle, { color: colors.textPrimary }]}
        >
          DEALS & VOUCHER RADAR
        </Text>

        {/* Filter Ledger Tabs */}
        <View
          style={[
            styles.filterTabsRow,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <TouchableOpacity
            testID="filter-tab-active"
            onPress={() => setActiveFilter('active')}
            style={[
              styles.filterTab,
              activeFilter === 'active' && [
                styles.filterTabActive,
                { backgroundColor: colors.textPrimary },
              ],
              { borderRightColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.filterTabText,
                {
                  color:
                    activeFilter === 'active'
                      ? colors.background
                      : colors.textSecondary,
                },
              ]}
            >
              ACTIVE [{activeVouchers.length}]
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="filter-tab-all"
            onPress={() => setActiveFilter('all')}
            style={[
              styles.filterTab,
              activeFilter === 'all' && [
                styles.filterTabActive,
                { backgroundColor: colors.textPrimary },
              ],
              { borderRightColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.filterTabText,
                {
                  color:
                    activeFilter === 'all'
                      ? colors.background
                      : colors.textSecondary,
                },
              ]}
            >
              ALL [{vouchers.length}]
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="filter-tab-expired"
            onPress={() => setActiveFilter('expired')}
            style={[
              styles.filterTab,
              activeFilter === 'expired' && [
                styles.filterTabActive,
                { backgroundColor: colors.textPrimary },
              ],
            ]}
          >
            <Text
              style={[
                styles.filterTabText,
                {
                  color:
                    activeFilter === 'expired'
                      ? colors.background
                      : colors.textSecondary,
                },
              ]}
            >
              EXPIRED [{expiredVouchers.length}]
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Voucher Scroll Area */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {filteredVouchers.length === 0 ? (
          <View
            testID="deals-empty-state"
            style={[styles.emptyContainer, { backgroundColor: colors.background }]}
          >
            <View style={styles.emptyCenterBlock}>
              <Text style={[styles.emptyHeadline, { color: colors.textPrimary }]}>
                RADAR CLEAR // NO VOUCHERS
              </Text>

              <View style={[styles.emptyDivider, { backgroundColor: colors.borderStrong }]} />

              <Text style={[styles.emptyManifesto, { color: colors.textSecondary }]}>
                The Deals Radar parses promotional discount notifications, capturing merchant
                codes, discount values, and deadlines directly onto your device with zero cloud tracking.
              </Text>

              <View style={[styles.emptyDivider, { backgroundColor: colors.borderStrong }]} />

              <View style={[styles.zeroPill, { borderColor: colors.border }]}>
                <Text style={[styles.zeroPillText, { color: colors.accent }]}>
                  [ 0 OFFERS IN {activeFilter.toUpperCase()} STACK ]
                </Text>
              </View>

              <Text style={[styles.emptyFootnote, { color: colors.textMuted }]}>
                ACTIVE PROMOS WILL POPULATE IN REAL-TIME ↓
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.voucherList}>
            {filteredVouchers.map((voucher) => {
              const isExp = isVoucherExpired(voucher, currentTime);
              const expiryLabel = formatVoucherExpiry(voucher.expiryDate, currentTime);
              const isCopied = recentlyCopiedId === voucher.id;

              return (
                <View
                  key={voucher.id}
                  testID={`voucher-card-${voucher.id}`}
                  style={[
                    styles.voucherCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: isExp ? colors.border : colors.borderStrong,
                      opacity: isExp ? 0.6 : 1.0,
                    },
                  ]}
                >
                  {/* Top Row: Merchant Title & Badges */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.merchantCluster}>
                      <Text
                        testID={`voucher-merchant-${voucher.id}`}
                        style={[styles.merchantName, { color: colors.textPrimary }]}
                      >
                        {voucher.merchant.toUpperCase()}
                      </Text>
                    </View>

                    <View style={styles.badgeCluster}>
                      {isExp ? (
                        <View
                          testID={`voucher-expired-badge-${voucher.id}`}
                          style={[
                            styles.expiredBadge,
                            { borderColor: colors.danger, backgroundColor: colors.surfaceSubtle },
                          ]}
                        >
                          <Text style={[styles.expiredBadgeText, { color: colors.danger }]}>
                            EXPIRED
                          </Text>
                        </View>
                      ) : (
                        <View
                          testID={`voucher-discount-${voucher.id}`}
                          style={[
                            styles.discountBadge,
                            {
                              borderColor: colors.accent,
                              backgroundColor: colors.accentSubtle,
                            },
                          ]}
                        >
                          <Text style={[styles.discountBadgeText, { color: colors.accent }]}>
                            {voucher.discount ? voucher.discount.toUpperCase() : 'OFFER'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Description / Terms */}
                  {voucher.description ? (
                    <Text
                      testID={`voucher-description-${voucher.id}`}
                      style={[styles.descriptionText, { color: colors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {voucher.description}
                    </Text>
                  ) : null}

                  {/* Expiry Timestamp Line */}
                  <View style={styles.expiryRow}>
                    <Text
                      testID={`voucher-expiry-${voucher.id}`}
                      style={[
                        styles.expiryText,
                        { color: isExp ? colors.danger : colors.textMuted },
                      ]}
                    >
                      {expiryLabel}
                    </Text>
                    {voucher.copiedCount > 0 && (
                      <Text style={[styles.copiedCountMeta, { color: colors.textMuted }]}>
                        // COPIED ×{voucher.copiedCount}
                      </Text>
                    )}
                  </View>

                  {/* Promo Code Box & 1-Tap Copy Action */}
                  <View
                    style={[
                      styles.codeBoxContainer,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceSubtle,
                      },
                    ]}
                  >
                    <View style={styles.codeCluster}>
                      <Text style={[styles.codeLabel, { color: colors.textMuted }]}>
                        CODE:
                      </Text>
                      <Text
                        testID={`voucher-code-${voucher.id}`}
                        style={[styles.codeString, { color: colors.textPrimary }]}
                        selectable
                      >
                        {voucher.code}
                      </Text>
                    </View>

                    <View style={styles.actionCluster}>
                      {isCopied ? (
                        <View
                          testID={`voucher-copied-badge-${voucher.id}`}
                          style={[
                            styles.copiedPill,
                            {
                              backgroundColor: colors.success,
                              borderColor: colors.success,
                            },
                          ]}
                        >
                          <Text style={styles.copiedPillText}>COPIED! ✓</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          testID={`copy-code-button-${voucher.id}`}
                          onPress={() => handleCopyCode(voucher)}
                          activeOpacity={0.7}
                          style={[
                            styles.copyButton,
                            {
                              borderColor: isExp ? colors.border : colors.accent,
                              backgroundColor: isExp ? colors.surface : colors.accentSubtle,
                            },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Copy coupon code: ${voucher.code}`}
                        >
                          <Text
                            testID={`copy-button-${voucher.id}`}
                            onPress={() => handleCopyCode(voucher)}
                            style={[
                              styles.copyButtonText,
                              { color: isExp ? colors.textMuted : colors.accent },
                            ]}
                          >
                            [ ⧉ COPY CODE ]
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 2,
  },
  topUtilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtn: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  backBtnText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandMeta: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  purgeBtn: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0,
  },
  purgeBtnText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  filterTabsRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 0,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
  },
  filterTabActive: {},
  filterTabText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  voucherList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },
  voucherCard: {
    borderWidth: 1,
    borderRadius: 0,
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  merchantCluster: {
    flex: 1,
  },
  merchantName: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  badgeCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  discountBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 0,
  },
  discountBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  expiredBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 0,
  },
  expiredBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  descriptionText: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  expiryText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  copiedCountMeta: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  codeBoxContainer: {
    borderWidth: 1,
    borderRadius: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  codeCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  codeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  codeString: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  actionCluster: {
    marginLeft: 8,
  },
  copyButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 0,
  },
  copyButtonText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  copiedPill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 0,
  },
  copiedPillText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  emptyContainer: {
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyCenterBlock: {
    maxWidth: 420,
    width: '100%',
    alignItems: 'center',
  },
  emptyHeadline: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  emptyDivider: {
    width: '100%',
    height: 1,
    marginVertical: 16,
  },
  emptyManifesto: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  zeroPill: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    marginBottom: 16,
  },
  zeroPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  emptyFootnote: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});

export default DealsRadarScreen;
