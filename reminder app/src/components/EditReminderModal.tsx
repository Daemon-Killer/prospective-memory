import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Reminder, ReminderPriority, UpdateReminderInput, isReminderArmed } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';

export interface EditReminderModalProps {
  visible: boolean;
  reminder: Reminder | null;
  onClose: () => void;
  onSave: (id: string, updates: UpdateReminderInput) => Promise<void> | void;
  themeColors?: ThemeColors;
  testID?: string;
}

function formatDateDisplay(d: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const mon = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${mon} ${day}, ${year} AT ${h}:${m}`;
}

export const EditReminderModal: React.FC<EditReminderModalProps> = ({
  visible,
  reminder,
  onClose,
  onSave,
  themeColors: propColors,
  testID = 'edit-reminder-modal',
}) => {
  const theme = useTheme();
  const colors = propColors ?? theme.colors;

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isArmed, setIsArmed] = useState(true);
  const [priority, setPriority] = useState<ReminderPriority>('medium');
  const [dayOffset, setDayOffset] = useState<number>(0);
  const [customDateStr, setCustomDateStr] = useState<string>('');
  const [hour, setHour] = useState<number>(9);
  const [minute, setMinute] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible && reminder) {
      setTitle(reminder.title);
      setNotes(reminder.notes ?? '');
      const armedVal = isReminderArmed(reminder);
      setIsArmed(armedVal);
      setPriority(reminder.priority ?? 'medium');
      setErrorMessage(null);
      setIsSubmitting(false);

      const due = new Date(reminder.dueDate);
      if (!isNaN(due.getTime())) {
        setHour(due.getHours());
        setMinute(due.getMinutes());
        const y = due.getFullYear();
        const m = String(due.getMonth() + 1).padStart(2, '0');
        const d = String(due.getDate()).padStart(2, '0');
        setCustomDateStr(`${y}-${m}-${d}`);

        // Compare with today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDay = new Date(due);
        targetDay.setHours(0, 0, 0, 0);
        const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (86400000));
        setDayOffset(diffDays >= 0 ? diffDays : 0);
      } else {
        const now = new Date();
        setHour(now.getHours() + 1 > 23 ? 9 : now.getHours() + 1);
        setMinute(0);
        setDayOffset(0);
        setCustomDateStr('');
      }
    }
  }, [visible, reminder]);

  const isValidCustomDate = useMemo(() => {
    if (!customDateStr) return true;
    const trimmed = customDateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
    const [y, m, d] = trimmed.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const test = new Date(y, m - 1, d);
    return test.getFullYear() === y && test.getMonth() === m - 1 && test.getDate() === d;
  }, [customDateStr]);

  const calculatedDueDate = useMemo(() => {
    let base: Date;
    if (customDateStr && isValidCustomDate) {
      const parts = customDateStr.trim().split('-').map(Number);
      base = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      base = new Date();
      base.setDate(base.getDate() + (dayOffset >= 0 ? dayOffset : 0));
    }
    base.setHours(hour, minute, 0, 0);
    return base;
  }, [dayOffset, customDateStr, isValidCustomDate, hour, minute]);

  const handleDaySelect = (offset: number) => {
    setDayOffset(offset);
    setErrorMessage(null);
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setCustomDateStr(`${y}-${m}-${day}`);
    if (Platform.OS !== 'web') {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch {}
    }
  };

  const handleSave = async () => {
    if (!reminder || isSubmitting) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setErrorMessage('Title cannot be empty');
      return;
    }

    if (isArmed) {
      if (customDateStr && customDateStr.trim()) {
        if (!isValidCustomDate) {
          setErrorMessage('Invalid calendar date (format YYYY-MM-DD)');
          return;
        }
      } else if (dayOffset === -1) {
        setErrorMessage('Please select or enter a valid due date');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch {}
      }

      await onSave(reminder.id, {
        title: trimmed,
        notes: notes.trim() ? notes.trim() : null,
        dueDate: isArmed ? calculatedDueDate.toISOString() : reminder.dueDate,
        armed: isArmed,
        priority,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save reminder');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!visible || !reminder) return null;

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
          <View style={[styles.handleBar, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.subHeading, { color: colors.textMuted }]}>
                EDIT PROSPECTIVE MEMORY
              </Text>
              <Text style={[styles.headingTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {reminder.title}
              </Text>
            </View>
            <TouchableOpacity
              testID="edit-close-btn"
              onPress={onClose}
              style={[styles.closeBtn, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Close edit modal"
            >
              <Text style={[styles.closeBtnText, { color: colors.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <ScrollView style={styles.scrollArea} keyboardShouldPersistTaps="handled">
            {errorMessage ? (
              <View testID="edit-error-banner" style={[styles.errorBanner, { borderColor: colors.danger }]}>
                <Text style={[styles.errorText, { color: colors.danger }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Message / Title Input */}
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>REMINDER MESSAGE / TITLE</Text>
            <TextInput
              testID="edit-title-input"
              value={title}
              onChangeText={(txt) => {
                setTitle(txt);
                if (errorMessage) setErrorMessage(null);
              }}
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                },
              ]}
              placeholder="What do you need to do?"
              placeholderTextColor={colors.textMuted}
            />

            {/* Notes Input */}
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 12 }]}>
              DESCRIPTIVE NOTES (OPTIONAL)
            </Text>
            <TextInput
              testID="edit-notes-input"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              style={[
                styles.textArea,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                  color: colors.textPrimary,
                },
              ]}
              placeholder="Add context, links, or instructions..."
              placeholderTextColor={colors.textMuted}
            />

            {/* Priority Selector */}
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 12 }]}>
              PRIORITY LEVEL
            </Text>
            <View testID="edit-priority-selector" style={styles.chipsRow}>
              {(['low', 'medium', 'high'] as ReminderPriority[]).map((p) => {
                const isSelected = priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    testID={`edit-priority-${p}`}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: isSelected ? colors.textPrimary : colors.surfaceSubtle,
                        borderColor: isSelected ? colors.textPrimary : colors.border,
                      },
                    ]}
                    onPress={() => setPriority(p)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: isSelected ? colors.background : colors.textPrimary },
                      ]}
                    >
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Armed Type Toggle */}
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 12 }]}>
              REMINDER TYPE
            </Text>
            <View testID="edit-type-toggle" style={styles.chipsRow}>
              <TouchableOpacity
                testID="edit-type-armed"
                style={[
                  styles.chip,
                  {
                    flex: 1,
                    backgroundColor: isArmed ? colors.textPrimary : colors.surfaceSubtle,
                    borderColor: isArmed ? colors.textPrimary : colors.border,
                  },
                ]}
                onPress={() => setIsArmed(true)}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: isArmed ? colors.background : colors.textPrimary, textAlign: 'center' },
                  ]}
                >
                  TIMED ALARM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="edit-type-inbox"
                style={[
                  styles.chip,
                  {
                    flex: 1,
                    backgroundColor: !isArmed ? colors.textPrimary : colors.surfaceSubtle,
                    borderColor: !isArmed ? colors.textPrimary : colors.border,
                  },
                ]}
                onPress={() => setIsArmed(false)}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: !isArmed ? colors.background : colors.textPrimary, textAlign: 'center' },
                  ]}
                >
                  INBOX THOUGHT
                </Text>
              </TouchableOpacity>
            </View>

            {/* Custom Time & Date Section (Only if Armed) */}
            {isArmed ? (
              <View testID="edit-time-editor" style={styles.timeEditorSection}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 14 }]}>
                  DUE DATE CHIP
                </Text>
                <View style={styles.chipsRow}>
                  {[
                    { label: 'TODAY', offset: 0 },
                    { label: 'TMRW', offset: 1 },
                    { label: '+2 DAYS', offset: 2 },
                    { label: '+1 WEEK', offset: 7 },
                  ].map((item) => {
                    const isSelected = dayOffset === item.offset;
                    return (
                      <TouchableOpacity
                        key={item.label}
                        testID={`edit-day-${item.offset}`}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: isSelected ? colors.textPrimary : colors.surfaceSubtle,
                            borderColor: isSelected ? colors.textPrimary : colors.border,
                          },
                        ]}
                        onPress={() => handleDaySelect(item.offset)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: isSelected ? colors.background : colors.textPrimary },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Custom Date Input */}
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                  CUSTOM DATE (YYYY-MM-DD)
                </Text>
                <TextInput
                  testID="edit-custom-date-input"
                  value={customDateStr}
                  onChangeText={(txt) => {
                    setCustomDateStr(txt);
                    setDayOffset(-1);
                  }}
                  placeholder="2026-09-25"
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                />

                {/* Hour and Minute Steppers */}
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, marginTop: 10 }]}>
                  EXACT TIME (24-HOUR)
                </Text>
                <View style={styles.stepperContainer}>
                  {/* Hours */}
                  <View style={styles.stepperUnit}>
                    <Text style={[styles.stepperLabel, { color: colors.textMuted }]}>HOUR</Text>
                    <View style={styles.stepperControl}>
                      <TouchableOpacity
                        testID="edit-hour-minus"
                        style={[styles.stepperBtn, { borderColor: colors.border }]}
                        onPress={() => setHour((h) => ((h - 1 + 24) % 24))}
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.textPrimary }]}>-</Text>
                      </TouchableOpacity>
                      <Text
                        testID="edit-hour-value"
                        style={[styles.stepperValue, { color: colors.textPrimary }]}
                      >
                        {String(hour).padStart(2, '0')}
                      </Text>
                      <TouchableOpacity
                        testID="edit-hour-plus"
                        style={[styles.stepperBtn, { borderColor: colors.border }]}
                        onPress={() => setHour((h) => ((h + 1) % 24))}
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.textPrimary }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Minutes */}
                  <View style={styles.stepperUnit}>
                    <Text style={[styles.stepperLabel, { color: colors.textMuted }]}>MIN</Text>
                    <View style={styles.stepperControl}>
                      <TouchableOpacity
                        testID="edit-minute-minus"
                        style={[styles.stepperBtn, { borderColor: colors.border }]}
                        onPress={() => setMinute((m) => ((m - 5 + 60) % 60))}
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.textPrimary }]}>-</Text>
                      </TouchableOpacity>
                      <Text
                        testID="edit-minute-value"
                        style={[styles.stepperValue, { color: colors.textPrimary }]}
                      >
                        {String(minute).padStart(2, '0')}
                      </Text>
                      <TouchableOpacity
                        testID="edit-minute-plus"
                        style={[styles.stepperBtn, { borderColor: colors.border }]}
                        onPress={() => setMinute((m) => ((m + 5) % 60))}
                      >
                        <Text style={[styles.stepperBtnText, { color: colors.textPrimary }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Due Date Preview */}
                <View style={[styles.previewBox, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                  <Text
                    testID="edit-due-date-preview"
                    style={[
                      styles.previewText,
                      { color: isValidCustomDate ? (colors.accent || colors.textPrimary) : colors.danger },
                    ]}
                  >
                    {isValidCustomDate
                      ? `DUE: ${formatDateDisplay(calculatedDueDate)}`
                      : 'DUE: INVALID DATE (USE YYYY-MM-DD)'}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.inboxNotice, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text style={[styles.inboxNoticeText, { color: colors.textMuted }]}>
                  INBOX — UNTIMED PROSPECTIVE THOUGHT (NO NOTIFICATION ALARM)
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Action Row */}
          <View style={[styles.buttonRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              testID="edit-cancel-btn"
              onPress={onClose}
              style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="edit-save-btn"
              onPress={handleSave}
              disabled={isSubmitting}
              style={[
                styles.actionBtn,
                styles.saveBtn,
                { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.actionBtnText, { color: colors.background, fontWeight: '900' }]}>
                {isSubmitting ? 'SAVING...' : 'SAVE CHANGES'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  subHeading: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  headingTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  scrollArea: {
    paddingHorizontal: 16,
    maxHeight: 480,
  },
  errorBanner: {
    borderWidth: 1,
    padding: 8,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  textInput: {
    height: 42,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13,
    fontWeight: '600',
  },
  textArea: {
    height: 70,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timeEditorSection: {
    marginTop: 4,
  },
  stepperContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  stepperUnit: {
    flex: 1,
  },
  stepperLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  stepperControl: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    height: 40,
  },
  stepperBtn: {
    width: 36,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '700',
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  previewBox: {
    borderWidth: 1,
    padding: 10,
    marginTop: 12,
    alignItems: 'center',
  },
  previewText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  inboxNotice: {
    borderWidth: 1,
    padding: 12,
    marginTop: 14,
    alignItems: 'center',
  },
  inboxNoticeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtn: {},
  actionBtnText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
});

export default EditReminderModal;
