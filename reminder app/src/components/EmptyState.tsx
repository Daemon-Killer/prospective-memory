import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeColors } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';

export interface EmptyStateProps {
  themeColors?: ThemeColors;
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  themeColors: propColors,
  testID = 'empty-state',
}) => {
  const theme = useTheme();
  const themeColors = propColors ?? theme.colors;

  return (
    <View
      testID={testID}
      style={[styles.container, { backgroundColor: themeColors.background }]}
    >
      <View style={styles.centerBlock}>
        {/* Status Headline */}
        <Text
          testID="empty-state-headline"
          style={[styles.headline, { color: themeColors.textPrimary }]}
        >
          MEMORY STACK CLEAR
        </Text>

        {/* Framing Hairline Rule */}
        <View style={[styles.divider, { backgroundColor: themeColors.borderStrong }]} />

        {/* Prospective Memory Manifesto */}
        <Text
          testID="empty-state-manifesto"
          style={[styles.manifestoParagraph, { color: themeColors.textSecondary }]}
        >
          Prospective memory is the capacity to form an intention, retain it across intervening time,
          and execute it upon encountering the appropriate environmental or temporal cue.
        </Text>

        <Text style={[styles.manifestoParagraph, { color: themeColors.textSecondary, marginTop: 12 }]}>
          Your cognitive workspace is unburdened. All temporal obligations have been executed or scheduled.
        </Text>

        {/* Bottom Hairline Rule */}
        <View style={[styles.divider, { backgroundColor: themeColors.borderStrong }]} />

        {/* Tabular Zero Count Badge */}
        <View style={[styles.zeroBadge, { borderColor: themeColors.border }]}>
          <Text style={[styles.zeroBadgeText, { color: themeColors.success }]}>
            [ 0 ACTIVE INTENTIONS ]
          </Text>
        </View>

        {/* Frictionless Action Prompt */}
        <Text style={[styles.actionPrompt, { color: themeColors.textMuted }]}>
          RECORD NEW INTENTION BELOW ↓
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  centerBlock: {
    maxWidth: 420,
    width: '100%',
    alignItems: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 20,
  },
  divider: {
    width: '100%',
    height: 1,
    marginVertical: 18,
  },
  manifestoParagraph: {
    fontSize: 13,
    lineHeight: 22,
    fontWeight: '400',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  zeroBadge: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0,
    marginBottom: 16,
  },
  zeroBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  actionPrompt: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});

export default EmptyState;
