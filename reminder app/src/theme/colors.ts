/**
 * Remy Reminders - Swiss Minimalist Theme Triad Palette
 * 
 * 1. light: Swiss broadsheet editorial (#FFFFFF, #000000, crisp #E0E0E0 rules)
 * 2. dark: High-contrast slate (#121212 foundation, #1E1E1E elevated cards)
 * 3. void: Pure OLED pitch black (#000000, zero glow, #FF4500 signal orange)
 */

import { ThemeColors, ThemeMode } from '../types/theme';

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSubtle: '#F4F4F5',
  border: '#E0E0E0',
  borderStrong: '#000000',
  textPrimary: '#000000',
  textSecondary: '#52525B',
  textMuted: '#71717A',
  accent: '#000000',
  accentSubtle: '#F0F0F2',
  danger: '#D32F2F',
  warning: '#E65100',
  success: '#2E7D32',
};

export const darkColors: ThemeColors = {
  background: '#121212',
  surface: '#1E1E1E',
  surfaceSubtle: '#282828',
  border: '#2C2C2C',
  borderStrong: '#444444',
  textPrimary: '#F5F5F5',
  textSecondary: '#A0A0A0',
  textMuted: '#666666',
  accent: '#F5F5F5',
  accentSubtle: '#2A2A2A',
  danger: '#EF5350',
  warning: '#FFA726',
  success: '#4CAF50',
};

export const voidColors: ThemeColors = {
  background: '#000000',
  surface: '#000000',
  surfaceSubtle: '#0D0D0D',
  border: '#222222',
  borderStrong: '#FF4500',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textMuted: '#555555',
  accent: '#FF4500',
  accentSubtle: 'rgba(255, 69, 0, 0.15)',
  danger: '#FF3B30',
  warning: '#FF9500',
  success: '#30D158',
};

export const themes: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
  void: voidColors,
};
