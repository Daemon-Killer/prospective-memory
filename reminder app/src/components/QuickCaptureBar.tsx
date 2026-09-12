import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '../types/theme';
import { SnoozePreset } from '../types/reminder';
import {
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
} from '../utils/snoozeCalculator';
import { useTheme } from '../theme/ThemeContext';

export type QuickChipPreset = '15m' | '1h' | 'evening' | 'tomorrow_morning';

interface PresetChipItem {
  id: QuickChipPreset;
  label: string;
  calc: (now: Date) => Date;
  presetEnum: SnoozePreset;
}

export const PRESET_CHIPS: PresetChipItem[] = [
  { id: '15m', label: '+15M', calc: (now) => calculate15Minutes(now), presetEnum: '15m' },
  { id: '1h', label: '+1H', calc: (now) => calculate1Hour(now), presetEnum: '1h' },
  { id: 'evening', label: 'TONIGHT', calc: (now) => calculateThisEvening(now), presetEnum: 'evening' },
  { id: 'tomorrow_morning', label: 'TOMORROW 9AM', calc: (now) => calculateTomorrowMorning(now), presetEnum: 'tomorrow_morning' },
];

export interface QuickCaptureBarProps {
  onCreateReminder: (input: { title: string; dueDate: Date; preset?: SnoozePreset }) => Promise<void> | void;
  themeColors?: ThemeColors;
  defaultPreset?: QuickChipPreset;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}

function useSafeInsets() {
  try {
    return useSafeAreaInsets();
  } catch {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
}

export const QuickCaptureBar: React.FC<QuickCaptureBarProps> = ({
  onCreateReminder,
  themeColors: propColors,
  defaultPreset = '15m',
  placeholder = 'RECORD INTENTION...',
  autoFocus = false,
  testID = 'quick-capture-bar',
}) => {
  const insets = useSafeInsets();
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  const [text, setText] = useState('');
  const [selectedChip, setSelectedChip] = useState<QuickChipPreset>(defaultPreset);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleChipSelect = (chipId: QuickChipPreset) => {
    if (Platform.OS !== 'web') {
      try {
        void Haptics.selectionAsync().catch(() => {});
      } catch {
        // Safe fallback
      }
    }
    setSelectedChip(chipId);
  };

  const handleCapture = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const activeChip = PRESET_CHIPS.find((c) => c.id === selectedChip) || PRESET_CHIPS[0];
      const targetDate = activeChip.calc(new Date());

      if (Platform.OS !== 'web') {
        try {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch {
          // Safe fallback
        }
      }

      await onCreateReminder({
        title: trimmed,
        dueDate: targetDate,
        preset: activeChip.presetEnum,
      });

      setText('');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const canSubmit = text.trim().length > 0 && !isSubmitting;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      <View
        testID={testID}
        style={[
          styles.container,
          {
            backgroundColor: themeColors.background,
            borderTopColor: themeColors.borderStrong,
            paddingBottom: Math.max(insets.bottom || 0, 12),
          },
        ]}
      >
        {/* Horizontal Preset Chips */}
        <View style={styles.chipsScrollContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {PRESET_CHIPS.map((chip) => {
              const isSelected = selectedChip === chip.id;
              return (
                <TouchableOpacity
                  key={chip.id}
                  testID={`chip-${chip.id}`}
                  onPress={() => handleChipSelect(chip.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: isSelected ? themeColors.textPrimary : themeColors.border,
                      backgroundColor: isSelected ? themeColors.textPrimary : themeColors.surface,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: isSelected ? themeColors.background : themeColors.textSecondary,
                        fontWeight: isSelected ? '900' : '700',
                      },
                    ]}
                  >
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Input & Action Row */}
        <View style={styles.inputRow}>
          <TextInput
            testID="quick-capture-input"
            style={[
              styles.input,
              {
                color: themeColors.textPrimary,
                backgroundColor: themeColors.surfaceSubtle,
                borderColor: themeColors.border,
              },
            ]}
            placeholder={placeholder}
            placeholderTextColor={themeColors.textMuted}
            value={text}
            onChangeText={setText}
            autoFocus={autoFocus}
            returnKeyType="done"
            onSubmitEditing={handleCapture}
            editable={!isSubmitting}
            maxLength={255}
          />
          <TouchableOpacity
            testID="quick-capture-submit"
            onPress={handleCapture}
            disabled={!canSubmit}
            style={[
              styles.submitButton,
              {
                backgroundColor: canSubmit ? themeColors.textPrimary : themeColors.surfaceSubtle,
                borderColor: canSubmit ? themeColors.textPrimary : themeColors.border,
              },
            ]}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.submitButtonText,
                {
                  color: canSubmit ? themeColors.background : themeColors.textMuted,
                },
              ]}
            >
              ADD
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 2,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  chipsScrollContainer: {
    marginBottom: 8,
  },
  chipsContent: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 0,
  },
  chipText: {
    fontSize: 10,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    height: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 0,
  },
  submitButtonText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});

export default QuickCaptureBar;
