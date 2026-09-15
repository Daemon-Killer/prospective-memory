/**
 * Remy Reminders - Swiss Void Sensory Inbox Shelf
 * 
 * Non-intrusive prospective candidate review queue adhering to the Swiss Void aesthetic:
 * - True #000000 AMOLED canvas with #FF4500 International Orange subtle accents.
 * - Displays candidate to-dos (action verb, title, inferred time cue, source package badge).
 * - 1-tap [Accept] button: promotes candidate into the active reminder ledger with haptic feedback.
 * - 1-tap [Dismiss] button: permanently purges candidate suggestion.
 * - Calm, collapsible/expandable shelf that collapses to 0-height when empty.
 */

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SensorySuggestion } from '../sensory/types';
import { ThemeColors } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';
import { formatTabularReminderTime } from '../utils/dateFormatting';

export interface SensoryInboxShelfProps {
  suggestions: SensorySuggestion[];
  onAccept: (id: string) => Promise<void> | void;
  onDismiss: (id: string) => Promise<void> | void;
  onOpenDealsRadar?: () => void;
  initiallyExpanded?: boolean;
  themeColors?: ThemeColors;
  currentTime?: Date;
  testID?: string;
}

/**
 * Normalizes Android package names into clean, uppercase merchant/app badges.
 */
export function cleanPackageBadge(sourcePackage: string, sourceAppName?: string): string {
  if (sourceAppName && sourceAppName.trim().length > 0) {
    return sourceAppName.toUpperCase();
  }
  const clean = (sourcePackage || '').toLowerCase();
  if (clean.includes('swiggy')) return 'SWIGGY';
  if (clean.includes('zomato')) return 'ZOMATO';
  if (clean.includes('amazon')) return 'AMAZON';
  if (clean.includes('flipkart')) return 'FLIPKART';
  if (clean.includes('uber')) return 'UBER';
  if (clean.includes('ola')) return 'OLA';
  if (clean.includes('blinkit')) return 'BLINKIT';
  if (clean.includes('zepto')) return 'ZEPTO';
  if (clean.includes('airtel')) return 'AIRTEL';
  if (clean.includes('jio')) return 'JIO';
  if (clean.includes('whatsapp')) return 'WHATSAPP';
  if (clean.includes('telegram')) return 'TELEGRAM';
  if (clean.includes('gmail')) return 'GMAIL';

  const parts = clean.split('.');
  const last = parts[parts.length - 1];
  return (last && last.length > 2 ? last : sourcePackage || 'APP').toUpperCase().slice(0, 14);
}

/**
 * Formats inferred temporal cues with tabular alignment.
 */
export function formatInferredTimeCue(
  inferredDueDate: string,
  armed: boolean,
  now: Date = new Date()
): string {
  if (!armed) return 'INBOX QUEUE';
  const due = new Date(inferredDueDate);
  if (isNaN(due.getTime())) return 'TIME CUE ATTACHED';
  return formatTabularReminderTime(due, now);
}

export const SensoryInboxShelf: React.FC<SensoryInboxShelfProps> = ({
  suggestions = [],
  onAccept,
  onDismiss,
  onOpenDealsRadar,
  initiallyExpanded = true,
  themeColors: propColors,
  currentTime = new Date(),
  testID = 'sensory-inbox-shelf',
}) => {
  const theme = useTheme();
  const colors = propColors ?? theme.colors;

  const [isExpanded, setIsExpanded] = useState<boolean>(initiallyExpanded);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Filter only pending candidates
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');

  const handleToggleExpand = useCallback(() => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.selectionAsync();
      } catch {
        // Safe fallback
      }
    }
    setIsExpanded((prev) => !prev);
  }, []);

  const handleAccept = useCallback(
    async (id: string) => {
      setProcessingId(id);
      if (Platform.OS !== 'web') {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Safe fallback
        }
      }
      try {
        await onAccept(id);
      } finally {
        setProcessingId((curr) => (curr === id ? null : curr));
      }
    },
    [onAccept]
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      setProcessingId(id);
      if (Platform.OS !== 'web') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // Safe fallback
        }
      }
      try {
        await onDismiss(id);
      } finally {
        setProcessingId((curr) => (curr === id ? null : curr));
      }
    },
    [onDismiss]
  );

  // If there are zero pending suggestions, do not pollute the prospective agenda
  if (pendingSuggestions.length === 0) {
    return null;
  }

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {/* Calm, Non-Intrusive Header Banner */}
      <TouchableOpacity
        testID="sensory-shelf-header"
        onPress={handleToggleExpand}
        activeOpacity={0.8}
        style={[
          styles.headerRow,
          {
            backgroundColor: colors.surfaceSubtle,
            borderBottomColor: isExpanded ? colors.border : 'transparent',
          },
        ]}
      >
        <View style={styles.headerLeftCluster}>
          <View style={[styles.sensoryDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.headerLabel, { color: colors.textPrimary }]}>
            INCOMING SUGGESTIONS
          </Text>
          <View
            testID="sensory-shelf-count"
            style={[styles.countBadge, { borderColor: colors.borderStrong }]}
          >
            <Text style={[styles.countText, { color: colors.accent }]}>
              {String(pendingSuggestions.length).padStart(2, '0')}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          testID="sensory-shelf-toggle"
          onPress={handleToggleExpand}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.toggleButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.toggleText, { color: colors.textMuted }]}>
            {isExpanded ? 'COLLAPSE ▲' : 'EXPAND ▼'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Collapsed State Summary Pill */}
      {!isExpanded && (
        <TouchableOpacity
          testID="sensory-shelf-collapsed-bar"
          onPress={handleToggleExpand}
          activeOpacity={0.7}
          style={[styles.collapsedBar, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.collapsedBarText, { color: colors.textSecondary }]}>
            [{pendingSuggestions.length} CANDIDATES WAITING] · TAP TO REVIEW INTENTIONS
          </Text>
        </TouchableOpacity>
      )}

      {/* Expanded Candidate Cards Stack */}
      {isExpanded && (
        <View style={styles.cardsStack}>
          {pendingSuggestions.map((suggestion) => {
            const timeCue = formatInferredTimeCue(
              suggestion.inferredDueDate,
              suggestion.armed,
              currentTime
            );
            const sourceBadge = cleanPackageBadge(
              suggestion.sourcePackage,
              suggestion.sourceAppName
            );
            const isProcessing = processingId === suggestion.id;

            return (
              <View
                key={suggestion.id}
                testID={`suggestion-card-${suggestion.id}`}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderLeftColor: colors.accent,
                  },
                ]}
              >
                {/* Meta Header: Action Verb + Source App Badge */}
                <View style={styles.cardMetaRow}>
                  <View
                    style={[
                      styles.verbBadge,
                      {
                        backgroundColor: colors.accentSubtle,
                        borderColor: colors.accent,
                      },
                    ]}
                  >
                    <Text
                      testID={`suggestion-verb-${suggestion.id}`}
                      style={[styles.verbText, { color: colors.accent }]}
                    >
                      {suggestion.actionVerb ? suggestion.actionVerb.toUpperCase() : 'TASK'}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.sourceBadge,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceSubtle,
                      },
                    ]}
                  >
                    <Text
                      testID={`suggestion-source-${suggestion.id}`}
                      style={[styles.sourceText, { color: colors.textSecondary }]}>
                      {sourceBadge}
                    </Text>
                  </View>
                </View>

                {/* Candidate Title & Inferred Time Cue */}
                <View style={styles.cardBody}>
                  <Text
                    testID={`suggestion-title-${suggestion.id}`}
                    style={[styles.cardTitle, { color: colors.textPrimary }]}
                    numberOfLines={2}
                  >
                    {suggestion.title}
                  </Text>

                  <View style={styles.timeCueRow}>
                    <Text
                      testID={`suggestion-time-${suggestion.id}`}
                      style={[styles.timeCueText, { color: colors.textMuted }]}
                    >
                      {suggestion.armed ? `⏰ ${timeCue}` : `📥 ${timeCue}`}
                    </Text>
                    {suggestion.category && (
                      <Text style={[styles.categoryTag, { color: colors.textMuted }]}>
                        // {suggestion.category.toUpperCase()}
                      </Text>
                    )}
                  </View>
                </View>

                {/* 1-Tap Action Row: [DISMISS] & [ACCEPT] */}
                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    testID={`dismiss-button-${suggestion.id}`}
                    onPress={() => handleDismiss(suggestion.id)}
                    disabled={isProcessing}
                    activeOpacity={0.7}
                    style={[
                      styles.actionButton,
                      styles.dismissButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceSubtle,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss suggestion: ${suggestion.title}`}
                  >
                    <Text style={[styles.dismissButtonText, { color: colors.textMuted }]}>
                      DISMISS
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID={`accept-button-${suggestion.id}`}
                    onPress={() => handleAccept(suggestion.id)}
                    disabled={isProcessing}
                    activeOpacity={0.7}
                    style={[
                      styles.actionButton,
                      styles.acceptButton,
                      {
                        borderColor: colors.accent,
                        backgroundColor: colors.accentSubtle,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Accept suggestion: ${suggestion.title}`}
                  >
                    <Text style={[styles.acceptButtonText, { color: colors.accent }]}>
                      + ACCEPT
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sensoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  countBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 0,
  },
  countText: {
    fontSize: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  toggleButton: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 0,
  },
  toggleText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  collapsedBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  collapsedBarText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cardsStack: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 0,
    padding: 12,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  verbBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
  },
  verbText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sourceBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
  },
  sourceText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardBody: {
    marginVertical: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    letterSpacing: -0.2,
  },
  timeCueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  timeCueText: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  categoryTag: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222222',
  },
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButton: {},
  dismissButtonText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  acceptButton: {},
  acceptButtonText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

export default SensoryInboxShelf;
