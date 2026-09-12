/**
 * Remy Reminders - Swiss Minimalist Theme & Design Token Types
 * Authoritative interface contracts conforming to PROJECT.md
 */

import { TextStyle } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'void';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSubtle: string;
  danger: string;
  warning: string;
  success: string;
}

export interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: TextStyle['fontWeight'];
  textTransform?: TextStyle['textTransform'];
  fontVariant?: TextStyle['fontVariant'];
}

export interface TypographyTokens {
  display: TypographyToken;
  title: TypographyToken;
  headline: TypographyToken;
  subhead: TypographyToken;
  body: TypographyToken;
  bodySmall: TypographyToken;
  caption: TypographyToken;
  tabularMonoTime: TypographyToken;
  tabularMonoSmall: TypographyToken;
}

export interface SpacingTokens {
  xxs: number; // 2px
  xs: number;  // 4px
  sm: number;  // 8px
  md: number;  // 12px
  base: number; // 16px
  lg: number;  // 20px
  xl: number;  // 24px
  xxl: number; // 32px
  xxxl: number; // 48px
  huge: number; // 64px
}

export interface BorderTokens {
  hairline: number; // StyleSheet.hairlineWidth (~0.5 - 1px)
  thin: number;     // 1px
  medium: number;   // 2px
  thick: number;    // 3px
  heavy: number;    // 4px
  radii: {
    none: number;   // 0px (True Swiss razor edge)
    xs: number;     // 2px
    sm: number;     // 4px
    md: number;     // 8px
    pill: number;   // 9999px (Theme toggles & chips)
  };
}

export interface ThemeContract {
  mode: ThemeMode;
  colors: ThemeColors;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  borders: BorderTokens;
  statusBarStyle: 'light' | 'dark';
  isLoaded: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  cycleTheme: () => Promise<void>;
}
