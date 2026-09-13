import React, { useMemo, useState, useRef, useEffect } from 'react';
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
import {
  CaptureChip,
  CapturePreset,
  compileCapture,
  compileMultiLineCapture,
  DEFAULT_LINGO,
  getStoredLingo,
} from '../utils/captureCompiler';
import { useTheme } from '../theme/ThemeContext';

export type QuickChipPreset = CaptureChip;

interface PresetChipItem {
  id: QuickChipPreset;
  label: string;
  presetEnum: CapturePreset;
}

export const PRESET_CHIPS: PresetChipItem[] = [
  { id: 'inbox', label: 'INBOX', presetEnum: 'inbox' },
  { id: '15m', label: '+15M', presetEnum: '15m' },
  { id: '1h', label: '+1H', presetEnum: '1h' },
  { id: 'evening', label: 'TONIGHT', presetEnum: 'evening' },
  { id: 'tomorrow_morning', label: 'TOMORROW 9AM', presetEnum: 'tomorrow_morning' },
];

export interface QuickCaptureBarProps {
  onCreateReminder: (input: {
    title: string;
    dueDate: Date;
    preset?: CapturePreset;
    armed?: boolean;
  }) => Promise<void> | void;
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
  defaultPreset = 'inbox',
  placeholder = 'DAHI LENA  ·  C MOM  ·  TONIGHT',
  autoFocus = false,
  testID = 'quick-capture-bar',
}) => {
  const insets = useSafeInsets();
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  const [text, setText] = useState('');
  const [selectedChip, setSelectedChip] = useState<QuickChipPreset>(defaultPreset);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lingoTable, setLingoTable] = useState<string>(DEFAULT_LINGO);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    getStoredLingo()
      .then((table) => {
        if (isMounted && table) {
          setLingoTable(table);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

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

    const drafts = compileMultiLineCapture(trimmed, selectedChip, new Date(), lingoTable);
    if (drafts.length === 0) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      if (Platform.OS !== 'web') {
        try {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch {
          // Safe fallback
        }
      }

      for (const draft of drafts) {
        await onCreateReminder({
          title: draft.title,
          dueDate: draft.dueDate,
          preset: draft.preset,
          armed: draft.armed,
        });
      }

      setText('');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const canSubmit = text.trim().length > 0 && !isSubmitting;
  const multiDrafts = useMemo(
    () => (text.trim() ? compileMultiLineCapture(text, selectedChip, new Date(), lingoTable) : []),
    [text, selectedChip, lingoTable]
  );
  const isMultiLine = multiDrafts.length > 1;
  const singleDraft = multiDrafts[0] || null;

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
                height: text.includes('\n') ? 72 : 44,
              },
            ]}
            placeholder={placeholder}
            placeholderTextColor={themeColors.textMuted}
            value={text}
            onChangeText={setText}
            autoFocus={autoFocus}
            returnKeyType={text.includes('\n') ? 'default' : 'done'}
            multiline={text.includes('\n')}
            onSubmitEditing={text.includes('\n') ? undefined : handleCapture}
            editable={!isSubmitting}
            maxLength={10000}
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
                height: text.includes('\n') ? 72 : 44,
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
              {isMultiLine ? `ADD ${multiDrafts.length}` : 'ADD'}
            </Text>
          </TouchableOpacity>
        </View>
        {isMultiLine ? (
          <Text
            testID="capture-preview"
            style={[styles.previewText, { color: themeColors.accent || themeColors.textPrimary }]}
          >
            {`→ SPLIT ${multiDrafts.length} ITEMS (${multiDrafts.filter((d) => d.armed).length} TIMED, ${multiDrafts.filter((d) => !d.armed).length} INBOX)`}
          </Text>
        ) : singleDraft && (singleDraft.title !== text.trim() || singleDraft.armed) ? (
          <Text
            testID="capture-preview"
            style={[styles.previewText, { color: themeColors.textSecondary }]}
          >
            → {singleDraft.title}
            {singleDraft.armed ? ' · TIMED' : ' · INBOX'}
          </Text>
        ) : singleDraft ? (
          <Text
            testID="capture-preview"
            style={[styles.previewText, { color: themeColors.textMuted }]}
          >
            INBOX — NO ALARM UNTIL YOU ARM IT
          </Text>
        ) : null}
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
  previewText: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});

export default QuickCaptureBar;
