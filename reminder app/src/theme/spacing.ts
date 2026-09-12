/**
 * Remy Reminders - Swiss Layout, Spacing & Border Tokens
 * Strict geometric modular spacing and razor-sharp border definitions.
 */

import { StyleSheet } from 'react-native';
import { BorderTokens, SpacingTokens } from '../types/theme';

export const spacing: SpacingTokens = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
};

export const borders: BorderTokens = {
  hairline: StyleSheet.hairlineWidth || 1,
  thin: 1,
  medium: 2,
  thick: 3,
  heavy: 4,
  radii: {
    none: 0,    // Architectural Swiss sharp edges
    xs: 2,
    sm: 4,      // Subtle modern chamfer for chips
    md: 8,      // Modal bottom sheet corners
    pill: 9999, // Pill buttons and indicator tags
  },
};
