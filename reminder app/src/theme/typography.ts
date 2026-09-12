/**
 * Remy Reminders - Swiss Typography Tokens
 * Characterized by massive display titles, tight tracking on headings,
 * wide uppercase tracking on section subheads, and tabular numbers for jitter-free clocks.
 */

import { Platform } from 'react-native';
import { TypographyTokens } from '../types/theme';

export const fontFamilies = {
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    default: 'sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    default: 'monospace',
  }),
};

export const typography: TypographyTokens = {
  // Editorial Masthead ("REMY", architectural dates)
  display: {
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -1.5,
    fontWeight: '900',
  },
  // Modal / section major headers
  title: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    fontWeight: '800',
  },
  // Reminder title / ledger item header
  headline: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    fontWeight: '700',
  },
  // Swiss tracked uppercase section labels ("MEMORY STACK", "OVERDUE")
  subhead: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 2.0,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  // Standard body copy and task notes
  body: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.2,
    fontWeight: '500',
  },
  // Secondary metadata
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: '400',
  },
  // Status tags, badges, snooze pill text
  caption: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  // Tabular clock / time display (14:30, 09:00) with zero horizontal layout shift
  tabularMonoTime: {
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // Tabular compact snooze counters and list metrics (+15m, SNOOZED ×3)
  tabularMonoSmall: {
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
};
