import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Reminder, SnoozePreset } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import {
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
  calculateWeekend,
} from '../utils/snoozeCalculator';
import { useTheme } from '../theme/ThemeContext';

export interface SnoozeModalProps {
  visible: boolean;
  reminder: Reminder | null;
  onClose: () => void;
  onSnooze: (reminderId: string, targetDate: Date, preset?: SnoozePreset) => Promise<void> | void;
  themeColors?: ThemeColors;
  testID?: string;
}

export interface PresetOption {
  preset: SnoozePreset;
  label: string;
  calc: (now: Date, dueDate?: string) => Date;
  formatPreview: (date: Date) => string;
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateTime(d: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  return `${mon} ${day} AT ${formatTime(d)}`;
}

function isTomorrow(target: Date, base: Date): boolean {
  return target.getDate() !== base.getDate();
}

export const SnoozeModal: React.FC<SnoozeModalProps> = ({
  visible,
  reminder,
  onClose,
  onSnooze,
  themeColors: propColors,
  testID = 'snooze-modal',
}) => {
  const theme = useTheme();
  const colors = propColors ?? theme.colors;

  const [isCustomMode, setIsCustomMode] = useState(false);
  const [selectedDayOffset, setSelectedDayOffset] = useState<0 | 1 | 2 | 7>(0); // 0 = Today, 1 = Tomorrow, 2 = In 2 days, 7 = Next week
  const [customHour, setCustomHour] = useState(9);
  const [customMinute, setCustomMinute] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset internal state whenever modal opens
  useEffect(() => {
    if (visible) {
      setIsCustomMode(false);
      setIsSubmitting(false);
      const now = new Date();
      setCustomHour(now.getHours() + 1 > 23 ? 9 : now.getHours() + 1);
      setCustomMinute(0);
      setSelectedDayOffset(0);
    }
  }, [visible, reminder]);

  const now = useMemo(() => new Date(), [visible]);

  // Define 5 standard presets
  const presets: PresetOption[] = useMemo(
    () => [
      {
        preset: '15m',
        label: '+15 MIN',
        calc: (n, due) => calculate15Minutes(n, due),
        formatPreview: (d) => formatTime(d),
      },
      {
        preset: '1h',
        label: '+1 HOUR',
        calc: (n, due) => calculate1Hour(n, due),
        formatPreview: (d) => formatTime(d),
      },
      {
        preset: 'evening',
        label: 'THIS EVENING',
        calc: (n) => calculateThisEvening(n),
        formatPreview: (d) => `${isTomorrow(d, now) ? 'TMRW ' : ''}${formatTime(d)}`,
      },
      {
        preset: 'tomorrow_morning',
        label: 'TOMORROW 9AM',
        calc: (n) => calculateTomorrowMorning(n),
        formatPreview: (d) => `TMRW ${formatTime(d)}`,
      },
      {
        preset: 'weekend',
        label: 'THIS WEEKEND',
        calc: (n) => calculateWeekend(n),
        formatPreview: (d) => `SAT ${formatTime(d)}`,
      },
    ],
    [now]
  );

  // Compute custom target date
  const customTargetDate = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + selectedDayOffset);
    target.setHours(customHour, customMinute, 0, 0);
    return target;
  }, [selectedDayOffset, customHour, customMinute]);

  const isCustomValid = customTargetDate.getTime() > Date.now();

  const handlePresetSelect = async (option: PresetOption) => {
    if (!reminder || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // Safe fallback
        }
      }
      const targetDate = option.calc(new Date(), reminder.dueDate);
      await onSnooze(reminder.id, targetDate, option.preset);
      onClose();
    } catch (e) {
      console.error('SnoozeModal: Error snoozing reminder', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCustom = async () => {
    if (!reminder || !isCustomValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // Safe fallback
        }
      }
      await onSnooze(reminder.id, customTargetDate, 'custom');
      onClose();
    } catch (e) {
      console.error('SnoozeModal: Error applying custom snooze', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!visible || !reminder) {
    return null;
  }

  return (
    <Modal
      testID={testID}
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.borderStrong },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle bar */}
          <View style={[styles.handleBar, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.contextTag, { color: colors.textMuted }]}>
                RESCHEDULE TASK
              </Text>
              <Text
                style={[styles.title, { color: colors.textPrimary }]}
                numberOfLines={2}
              >
                {reminder.title}
              </Text>
              <Text style={[styles.currentDueText, { color: colors.accent }]}>
                DUE: {formatDateTime(new Date(reminder.dueDate))}
              </Text>
            </View>
            <TouchableOpacity
              testID="snooze-close-btn"
              onPress={onClose}
              style={[styles.closeButton, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Close snooze modal"
            >
              <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Body: Presets or Custom */}
          {!isCustomMode ? (
            <View style={styles.presetsGrid}>
              {presets.map((opt) => {
                const targetTime = opt.calc(new Date(), reminder.dueDate);
                const previewStr = opt.formatPreview(targetTime);
                return (
                  <TouchableOpacity
                    key={opt.preset}
                    testID={`snooze-preset-${opt.preset}`}
                    style={[
                      styles.presetCard,
                      {
                        backgroundColor: colors.surfaceSubtle,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => handlePresetSelect(opt)}
                    disabled={isSubmitting}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetLabel, { color: colors.textPrimary }]}>
                      {opt.label}
                    </Text>
                    <Text
                      style={[
                        styles.presetTime,
                        { color: colors.accent, fontVariant: ['tabular-nums'] },
                      ]}
                    >
                      {previewStr}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {/* 6th Slot: Custom Option */}
              <TouchableOpacity
                testID="snooze-preset-custom"
                style={[
                  styles.presetCard,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  if (Platform.OS !== 'web') {
                    try {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    } catch {
                      // Safe fallback
                    }
                  }
                  setIsCustomMode(true);
                }}
                disabled={isSubmitting}
                activeOpacity={0.7}
              >
                <Text style={[styles.presetLabel, { color: colors.textPrimary }]}>
                  CUSTOM TIME...
                </Text>
                <Text style={[styles.presetTime, { color: colors.textMuted }]}>
                  SELECT
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Custom Selector Sub-panel */
            <View style={styles.customContainer}>
              {/* Day selection chips */}
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>
                TARGET DAY
              </Text>
              <View style={styles.dayChipsRow}>
                {[
                  { label: 'TODAY', offset: 0 },
                  { label: 'TOMORROW', offset: 1 },
                  { label: 'IN 2 DAYS', offset: 2 },
                  { label: 'NEXT WEEK', offset: 7 },
                ].map((item) => {
                  const isSelected = selectedDayOffset === item.offset;
                  return (
                    <TouchableOpacity
                      key={item.label}
                      testID={`custom-day-${item.offset}`}
                      style={[
                        styles.dayChip,
                        {
                          backgroundColor: isSelected ? colors.textPrimary : colors.surfaceSubtle,
                          borderColor: isSelected ? colors.textPrimary : colors.border,
                        },
                      ]}
                      onPress={() => {
                        if (Platform.OS !== 'web') {
                          try {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          } catch {
                            // Safe fallback
                          }
                        }
                        setSelectedDayOffset(item.offset as 0 | 1 | 2 | 7);
                      }}
                    >
                      <Text
                        style={[
                          styles.dayChipText,
                          { color: isSelected ? colors.background : colors.textPrimary },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Hour & Minute Adjusters */}
              <Text style={[styles.sectionLabel, { color: colors.textMuted, marginTop: 12 }]}>
                CLOCK TIME (24H)
              </Text>
              <View style={styles.timeStepperRow}>
                {/* Hours */}
                <View style={styles.stepperBox}>
                  <Text style={[styles.stepperLabel, { color: colors.textMuted }]}>HOUR</Text>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      testID="custom-hour-minus"
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                      onPress={() => setCustomHour((h) => (h === 0 ? 23 : h - 1))}
                    >
                      <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>-</Text>
                    </TouchableOpacity>
                    <Text
                      testID="custom-hour-value"
                      style={[styles.stepperValue, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}
                    >
                      {String(customHour).padStart(2, '0')}
                    </Text>
                    <TouchableOpacity
                      testID="custom-hour-plus"
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                      onPress={() => setCustomHour((h) => (h === 23 ? 0 : h + 1))}
                    >
                      <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Minutes */}
                <View style={styles.stepperBox}>
                  <Text style={[styles.stepperLabel, { color: colors.textMuted }]}>MIN</Text>
                  <View style={styles.stepperControls}>
                    <TouchableOpacity
                      testID="custom-min-minus"
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                      onPress={() => setCustomMinute((m) => (m <= 0 ? 55 : m - 5))}
                    >
                      <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>-</Text>
                    </TouchableOpacity>
                    <Text
                      testID="custom-min-value"
                      style={[styles.stepperValue, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}
                    >
                      {String(customMinute).padStart(2, '0')}
                    </Text>
                    <TouchableOpacity
                      testID="custom-min-plus"
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                      onPress={() => setCustomMinute((m) => (m >= 55 ? 0 : m + 5))}
                    >
                      <Text style={[styles.stepBtnText, { color: colors.textPrimary }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Target Preview & Validation */}
              <View style={styles.customPreviewRow}>
                <Text style={[styles.previewLabel, { color: colors.textMuted }]}>
                  NEW ALERT:
                </Text>
                <Text
                  testID="custom-preview-target"
                  style={[
                    styles.previewValue,
                    {
                      color: isCustomValid ? colors.accent : colors.danger,
                      fontVariant: ['tabular-nums'],
                    },
                  ]}
                >
                  {formatDateTime(customTargetDate)}
                </Text>
              </View>

              {!isCustomValid && (
                <Text testID="custom-error-text" style={[styles.errorText, { color: colors.danger }]}>
                  Target time must be strictly in the future.
                </Text>
              )}

              {/* Action buttons */}
              <View style={styles.customActionButtons}>
                <TouchableOpacity
                  testID="snooze-custom-back"
                  style={[styles.cancelCustomBtn, { borderColor: colors.border }]}
                  onPress={() => setIsCustomMode(false)}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>
                    BACK
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="snooze-custom-confirm"
                  style={[
                    styles.confirmCustomBtn,
                    {
                      backgroundColor: isCustomValid ? colors.accent : colors.border,
                      opacity: isCustomValid && !isSubmitting ? 1 : 0.5,
                    },
                  ]}
                  onPress={handleConfirmCustom}
                  disabled={!isCustomValid || isSubmitting}
                >
                  <Text style={[styles.confirmBtnText, { color: colors.background }]}>
                    CONFIRM RESCHEDULE
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 2,
    borderTopLeftRadius: 0, // Stark Swiss geometric borders
    borderTopRightRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  handleBar: {
    width: 36,
    height: 3,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  contextTag: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  currentDueText: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  closeButton: {
    padding: 8,
    borderWidth: 1,
    marginLeft: 12,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetCard: {
    width: '48%',
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  presetTime: {
    fontSize: 13,
    fontWeight: '600',
  },
  customContainer: {
    paddingTop: 4,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: 6,
  },
  dayChipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayChip: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dayChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  timeStepperRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stepperBox: {
    flex: 1,
  },
  stepperLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  stepperValue: {
    fontSize: 20,
    fontWeight: '800',
    minWidth: 32,
    textAlign: 'center',
  },
  customPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  previewValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  errorText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  customActionButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelCustomBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  confirmCustomBtn: {
    flex: 2,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

export default SnoozeModal;
