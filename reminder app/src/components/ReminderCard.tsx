import React, { useRef, useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  PanResponder,
  Animated,
  Platform,
  Modal,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Reminder, isReminderArmed } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import {
  formatTabularReminderTime,
  getOverdueAnalysis,
} from '../utils/dateFormatting';
import { useTheme } from '../theme/ThemeContext';
import { deserializeStrokes, pointsToSvgPath } from './DrawingCanvasModal';

export interface ReminderCardProps {
  reminder: Reminder;
  themeColors?: ThemeColors;
  onToggleComplete: (id: string) => void;
  onSnoozePress: (reminder: Reminder) => void;
  onDeletePress?: (id: string) => void;
  currentTime?: Date;
  testID?: string;
}

export const ReminderCard: React.FC<ReminderCardProps> = ({
  reminder,
  themeColors: propColors,
  onToggleComplete,
  onSnoozePress,
  onDeletePress,
  currentTime = new Date(),
  testID,
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  const [viewerVisible, setViewerVisible] = useState(false);
  const inkDetails = useMemo(() => {
    if (!reminder.inkData) return null;
    return deserializeStrokes(reminder.inkData);
  }, [reminder.inkData]);

  const panX = useRef(new Animated.Value(0)).current;
  const isCompleted = reminder.status === 'completed';
  const armed = isReminderArmed(reminder);
  const { isOverdue, elapsedFormatted } = getOverdueAnalysis(
    reminder.dueDate,
    reminder.status,
    currentTime,
    armed
  );
  const timeFormatted = armed
    ? formatTabularReminderTime(reminder.dueDate, currentTime)
    : 'INBOX';

  // PanResponder for horizontal swipe interaction (Right = Snooze, Left = Complete)
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dy) < 10;
      },
      onPanResponderMove: (_, gestureState) => {
        panX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 80) {
          // Swiped Right -> Trigger Snooze
          if (Platform.OS !== 'web') {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {
              // Safe fallback
            }
          }
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
          onSnoozePress(reminder);
        } else if (gestureState.dx < -80) {
          // Swiped Left -> Toggle Complete
          if (Platform.OS !== 'web') {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              // Safe fallback
            }
          }
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
          onToggleComplete(reminder.id);
        } else {
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const handleToggle = () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Safe fallback
      }
    }
    onToggleComplete(reminder.id);
  };

  const handleSnooze = () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Safe fallback
      }
    }
    onSnoozePress(reminder);
  };

  const handleDelete = () => {
    if (onDeletePress) {
      if (Platform.OS !== 'web') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        } catch {
          // Safe fallback
        }
      }
      onDeletePress(reminder.id);
    }
  };

  return (
    <Animated.View
      testID={testID ?? `reminder-card-${reminder.id}`}
      style={[
        styles.rowContainer,
        {
          backgroundColor: themeColors.background,
          borderBottomColor: themeColors.border,
          transform: [{ translateX: panX }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      {/* High-visibility Overdue Left Accent Line */}
      {isOverdue && (
        <View style={[styles.overdueAccentBar, { backgroundColor: themeColors.danger }]} />
      )}

      {/* Main Ledger Content */}
      <View style={styles.ledgerContent}>
        {/* Temporal Sub-header & Snooze Badge */}
        <View style={styles.timeHeaderRow}>
          <View style={styles.timeCluster}>
            <Text
              style={[
                styles.tabularTime,
                {
                  color: isOverdue
                    ? themeColors.danger
                    : isCompleted
                    ? themeColors.textMuted
                    : themeColors.textPrimary,
                },
              ]}
            >
              {isOverdue ? `! ${timeFormatted}` : timeFormatted}
            </Text>
            {isOverdue && (
              <View
                testID={`reminder-overdue-pill-${reminder.id}`}
                style={[
                  styles.overduePill,
                  { backgroundColor: themeColors.danger, borderColor: themeColors.danger },
                ]}
              >
                <Text style={styles.overduePillText}>
                  {elapsedFormatted}
                </Text>
              </View>
            )}
          </View>

          {reminder.snoozeCount > 0 && !isCompleted && (
            <View
              testID={`reminder-snooze-badge-${reminder.id}`}
              style={[styles.snoozeBadge, { borderColor: themeColors.borderStrong }]}
            >
              <Text style={[styles.snoozeBadgeText, { color: themeColors.warning }]}>
                SNOOZED ×{reminder.snoozeCount}
              </Text>
            </View>
          )}
        </View>

        {/* Intention Title & Checkbox */}
        <View style={styles.titleRow}>
          <TouchableOpacity
            testID={`reminder-checkbox-${reminder.id}`}
            onPress={handleToggle}
            style={[
              styles.checkboxSquare,
              {
                borderColor: isCompleted ? themeColors.textPrimary : themeColors.borderStrong,
                backgroundColor: isCompleted ? themeColors.textPrimary : 'transparent',
              },
            ]}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isCompleted }}
          >
            {isCompleted && (
              <Text style={[styles.checkmarkSymbol, { color: themeColors.background }]}>
                ✓
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.textColumn}>
            <Text
              style={[
                styles.titleText,
                {
                  color: isCompleted ? themeColors.textMuted : themeColors.textPrimary,
                  textDecorationLine: isCompleted ? 'line-through' : 'none',
                },
              ]}
              numberOfLines={3}
            >
              {reminder.title}
            </Text>

            {reminder.notes ? (
              <Text
                style={[styles.notesText, { color: themeColors.textSecondary }]}
                numberOfLines={2}
              >
                {reminder.notes}
              </Text>
            ) : null}

            {reminder.inkData && inkDetails ? (
              <TouchableOpacity
                testID={`reminder-ink-preview-${reminder.id}`}
                onPress={() => setViewerVisible(true)}
                style={[
                  styles.inkPreviewContainer,
                  { borderColor: themeColors.border, backgroundColor: '#0D0D0D' },
                ]}
                activeOpacity={0.8}
                accessibilityLabel="View attached drawing"
              >
                <View style={styles.inkThumbnailRow}>
                  <Text style={styles.inkBadgeText}>✍ INK ATTACHMENT</Text>
                  <Text style={styles.inkTapHint}>TAP TO VIEW</Text>
                </View>
                <View style={styles.inkThumbnailCanvas}>
                  {Platform.OS === 'web' ? (
                    <svg
                      viewBox={`0 0 ${inkDetails.width} ${inkDetails.height}`}
                      style={{ width: '100%', height: 60 }}
                    >
                      {inkDetails.strokes.map((s, idx) => (
                        <path
                          key={`th-${idx}`}
                          d={pointsToSvgPath(s.points)}
                          stroke={s.color}
                          strokeWidth={Math.max(s.width * 0.8, 1.5)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      ))}
                    </svg>
                  ) : (
                    <View style={{ height: 40, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={[styles.inkFallbackText, { color: themeColors.textSecondary }]}>
                        {`[Stylus Drawing · ${inkDetails.strokes.length} strokes]`}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Action Controls */}
        <View style={styles.actionRow}>
          {onDeletePress && (
            <TouchableOpacity
              testID={`reminder-delete-btn-${reminder.id}`}
              onPress={handleDelete}
              style={[
                styles.actionButton,
                { borderColor: themeColors.border, backgroundColor: themeColors.surfaceSubtle },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionButtonText, { color: themeColors.danger }]}>
                DEL
              </Text>
            </TouchableOpacity>
          )}

          {!isCompleted && (
            <TouchableOpacity
              testID={`reminder-snooze-btn-${reminder.id}`}
              onPress={handleSnooze}
              style={[
                styles.actionButton,
                { borderColor: themeColors.border, backgroundColor: themeColors.surfaceSubtle },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionButtonText, { color: themeColors.textPrimary }]}>
                {armed ? 'SNOOZE' : 'ARM'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            testID={`reminder-complete-btn-${reminder.id}`}
            onPress={handleToggle}
            style={[
              styles.actionButton,
              {
                borderColor: isCompleted ? themeColors.border : themeColors.borderStrong,
                backgroundColor: isCompleted ? themeColors.surface : themeColors.surfaceSubtle,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.actionButtonText,
                { color: isCompleted ? themeColors.textMuted : themeColors.textPrimary },
              ]}
            >
              {isCompleted ? 'REOPEN' : 'COMPLETE'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {reminder.inkData && inkDetails && (
        <Modal
          visible={viewerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerVisible(false)}
          testID={`reminder-ink-viewer-${reminder.id}`}
        >
          <View style={styles.viewerOverlay}>
            <View style={styles.viewerContainer}>
              <View style={styles.viewerHeader}>
                <Text style={styles.viewerTitle}>{reminder.title.toUpperCase()}</Text>
                <TouchableOpacity
                  onPress={() => setViewerVisible(false)}
                  style={styles.viewerCloseBtn}
                  testID={`reminder-ink-close-${reminder.id}`}
                  accessibilityLabel="Close drawing viewer"
                >
                  <Text style={styles.viewerCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.viewerCanvasBox}>
                {Platform.OS === 'web' ? (
                  <svg
                    viewBox={`0 0 ${inkDetails.width} ${inkDetails.height}`}
                    style={{ width: '100%', height: '100%' }}
                  >
                    {inkDetails.strokes.map((s, idx) => (
                      <path
                        key={`full-${idx}`}
                        d={pointsToSvgPath(s.points)}
                        stroke={s.color}
                        strokeWidth={s.width}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    ))}
                  </svg>
                ) : (
                  <View style={StyleSheet.absoluteFill}>
                    {inkDetails.strokes.map((stroke, sIdx) => {
                      if (stroke.points.length === 1) {
                        const pt = stroke.points[0];
                        return (
                          <View
                            key={`v-s-${sIdx}-dot`}
                            style={{
                              position: 'absolute',
                              left: pt.x - stroke.width / 2,
                              top: pt.y - stroke.width / 2,
                              width: stroke.width,
                              height: stroke.width,
                              borderRadius: stroke.width / 2,
                              backgroundColor: stroke.color,
                            }}
                          />
                        );
                      }
                      return stroke.points.map((pt, pIdx) => {
                        if (pIdx === 0) return null;
                        const prev = stroke.points[pIdx - 1];
                        const dx = pt.x - prev.x;
                        const dy = pt.y - prev.y;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                        return (
                          <View
                            key={`v-s-${sIdx}-p-${pIdx}`}
                            style={{
                              position: 'absolute',
                              left: prev.x,
                              top: prev.y,
                              width: length,
                              height: stroke.width,
                              backgroundColor: stroke.color,
                              borderRadius: stroke.width / 2,
                              transformOrigin: '0% 50%',
                              transform: [{ rotate: `${angle}deg` }],
                            }}
                          />
                        );
                      });
                    })}
                  </View>
                )}
              </View>
              <Text style={{ marginTop: 8, fontSize: 10, color: '#888888', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                {`Vector strokes: ${inkDetails.strokes.length} · Swiss Void Canvas`}
              </Text>
            </View>
          </View>
        </Modal>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  rowContainer: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  overdueAccentBar: {
    width: 3,
  },
  ledgerContent: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabularTime: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  overduePill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  overduePillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  snoozeBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
  },
  snoozeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginVertical: 4,
  },
  checkboxSquare: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkmarkSymbol: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 14,
  },
  textColumn: {
    flex: 1,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  notesText: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  actionButton: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0,
  },
  actionButtonText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  inkPreviewContainer: {
    marginTop: 8,
    borderWidth: 1,
    padding: 8,
  },
  inkThumbnailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inkBadgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#80CBC4',
    letterSpacing: 1,
  },
  inkTapHint: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 8,
    color: '#666666',
    letterSpacing: 0.5,
  },
  inkThumbnailCanvas: {
    width: '100%',
    height: 60,
    backgroundColor: '#050505',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  inkFallbackText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  viewerContainer: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#333333',
    padding: 16,
  },
  viewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewerTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  viewerCloseBtn: {
    padding: 4,
  },
  viewerCloseBtnText: {
    fontSize: 18,
    color: '#888888',
  },
  viewerCanvasBox: {
    width: '100%',
    height: 320,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#222222',
    overflow: 'hidden',
  },
});

export default ReminderCard;
