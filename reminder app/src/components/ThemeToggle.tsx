import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ThemeColors, ThemeMode } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';

export interface ThemeToggleProps {
  mode?: ThemeMode;
  colors?: ThemeColors;
  onCycle?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  mode: propMode,
  colors: propColors,
  onCycle: propOnCycle,
  style,
  testID = 'theme-toggle',
}) => {
  const theme = useTheme();
  const mode = propMode ?? theme.mode;
  const colors = propColors ?? theme.colors;
  const onCycle = propOnCycle ?? theme.cycleTheme;

  const handleToggle = () => {
    if (Platform.OS !== 'web') {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {
        // Safe fallback
      }
    }
    onCycle();
  };

  const themeLabel = mode === 'light' ? 'LIGHT' : mode === 'dark' ? 'DARK' : 'VOID';

  return (
    <TouchableOpacity
      testID={testID}
      onPress={handleToggle}
      style={[
        styles.themePill,
        {
          borderColor: colors.borderStrong,
          backgroundColor: colors.surfaceSubtle,
        },
        style,
      ]}
      activeOpacity={0.7}
      accessibilityLabel={`Current theme: ${themeLabel}. Tap to switch.`}
      accessibilityRole="button"
    >
      <View
        style={[
          styles.themeIndicatorDot,
          {
            backgroundColor: mode === 'void' ? colors.accent : colors.textPrimary,
          },
        ]}
      />
      <Text style={[styles.themePillText, { color: colors.textPrimary }]}>
        {themeLabel}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  themePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    gap: 6,
  },
  themeIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  themePillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});

export default ThemeToggle;
