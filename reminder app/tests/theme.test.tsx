/**
 * Remy Reminders - Swiss Design System: Theme Triad & Tokens Test Suite
 * Comprehensive automated verification for Milestone 3
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  ThemeProvider,
  useTheme,
  THEME_STORAGE_KEY,
  lightColors,
  darkColors,
  voidColors,
  typography,
  spacing,
  borders,
} from '../src/theme';
import { ThemeContract, ThemeMode } from '../src/types/theme';

interface ConsumerProps {
  onRender?: (theme: ThemeContract) => void;
}

const ThemeConsumer: React.FC<ConsumerProps> = ({ onRender }) => {
  const theme = useTheme();
  if (onRender) onRender(theme);

  return (
    <>
      <Text testID="theme-mode">{theme.mode}</Text>
      <Text testID="theme-bg">{theme.colors.background}</Text>
      <Text testID="status-bar">{theme.statusBarStyle}</Text>
      <TouchableOpacity testID="cycle-btn" onPress={() => theme.cycleTheme()}>
        <Text>Cycle</Text>
      </TouchableOpacity>
    </>
  );
};

describe('Swiss Design System - Theme Triad & Tokens', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('1. Theme Palette & WCAG AAA Standards', () => {
    it('provides broadsheet light theme with high contrast', () => {
      expect(lightColors.background).toBe('#FFFFFF');
      expect(lightColors.textPrimary).toBe('#000000');
      expect(lightColors.border).toBe('#E0E0E0');
      expect(lightColors.borderStrong).toBe('#000000');
      expect(lightColors.danger).toBe('#D32F2F');
    });

    it('provides high-contrast slate dark theme', () => {
      expect(darkColors.background).toBe('#121212');
      expect(darkColors.surface).toBe('#1E1E1E');
      expect(darkColors.textPrimary).toBe('#F5F5F5');
      expect(darkColors.border).toBe('#2C2C2C');
    });

    it('provides OLED pitch black void theme with blazing signal orange accent', () => {
      expect(voidColors.background).toBe('#000000');
      expect(voidColors.surface).toBe('#000000');
      expect(voidColors.accent).toBe('#FF4500');
      expect(voidColors.borderStrong).toBe('#FF4500');
      expect(voidColors.textPrimary).toBe('#FFFFFF');
    });
  });

  describe('2. Typography & Layout Tokens', () => {
    it('enforces tabular-nums font variant on time and counter tokens', () => {
      expect(typography.tabularMonoTime.fontVariant).toEqual(['tabular-nums']);
      expect(typography.tabularMonoSmall.fontVariant).toEqual(['tabular-nums']);
      expect(typography.tabularMonoTime.fontWeight).toBe('700');
      expect(typography.tabularMonoSmall.fontWeight).toBe('600');
    });

    it('defines uppercase tracking on subhead labels', () => {
      expect(typography.subhead.textTransform).toBe('uppercase');
      expect(typography.subhead.letterSpacing).toBe(2.0);
    });

    it('defines sharp Swiss borders and geometric spacing scale', () => {
      expect(borders.radii.none).toBe(0);
      expect(borders.thin).toBe(1);
      expect(spacing.base).toBe(16);
      expect(spacing.sm).toBe(8);
      expect(spacing.lg).toBe(20);
    });
  });

  describe('3. ThemeContext & ThemeProvider Lifecycle', () => {
    it('provides light theme when explicitly requested via initialMode', async () => {
      let capturedTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onRender={(t) => { capturedTheme = t; }} />
          </ThemeProvider>
        );
      });

      expect(capturedTheme).not.toBeNull();
      expect(capturedTheme!.mode).toBe('light');
      expect(capturedTheme!.colors.background).toBe(lightColors.background);
      expect(capturedTheme!.statusBarStyle).toBe('dark');

      const modeText = renderer.root.findByProps({ testID: 'theme-mode' });
      expect(modeText.props.children).toBe('light');

      act(() => {
        renderer.unmount();
      });
    });

    it('cycles deterministically through light -> dark -> void -> light', async () => {
      let capturedTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onRender={(t) => { capturedTheme = t; }} />
          </ThemeProvider>
        );
      });

      expect(capturedTheme!.mode).toBe('light');

      // Cycle 1: light -> dark
      await act(async () => {
        await capturedTheme!.cycleTheme();
      });
      expect(capturedTheme!.mode).toBe('dark');
      expect(capturedTheme!.colors.background).toBe(darkColors.background);
      expect(capturedTheme!.statusBarStyle).toBe('light');

      // Cycle 2: dark -> void
      await act(async () => {
        await capturedTheme!.cycleTheme();
      });
      expect(capturedTheme!.mode).toBe('void');
      expect(capturedTheme!.colors.background).toBe(voidColors.background);
      expect(capturedTheme!.colors.accent).toBe('#FF4500');
      expect(capturedTheme!.statusBarStyle).toBe('light');

      // Cycle 3: void -> light
      await act(async () => {
        await capturedTheme!.cycleTheme();
      });
      expect(capturedTheme!.mode).toBe('light');
      expect(capturedTheme!.colors.background).toBe(lightColors.background);
      expect(capturedTheme!.statusBarStyle).toBe('dark');

      act(() => {
        renderer.unmount();
      });
    });

    it('persists selected theme mode to AsyncStorage', async () => {
      let capturedTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <ThemeConsumer onRender={(t) => { capturedTheme = t; }} />
          </ThemeProvider>
        );
      });

      await act(async () => {
        await capturedTheme!.setThemeMode('void');
      });

      const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      expect(stored).toBe('void');

      act(() => {
        renderer.unmount();
      });
    });

    it('hydrates saved theme mode on cold boot', async () => {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, 'void');

      let capturedTheme: ThemeContract | null = null;
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ThemeConsumer onRender={(t) => { capturedTheme = t; }} />
          </ThemeProvider>
        );
      });

      expect(capturedTheme!.mode).toBe('void');
      expect(capturedTheme!.colors.background).toBe(voidColors.background);
      expect(capturedTheme!.isLoaded).toBe(true);

      act(() => {
        renderer.unmount();
      });
    });

    it('throws descriptive error when useTheme is called outside ThemeProvider', () => {
      const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});

      class TestErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorMessage: string }> {
        state: { hasError: boolean; errorMessage: string } = { hasError: false, errorMessage: '' };
        static getDerivedStateFromError(error: any) {
          return { hasError: true, errorMessage: error?.message ?? String(error) };
        }
        render() {
          if (this.state.hasError) {
            return <Text testID="error-msg">{this.state.errorMessage}</Text>;
          }
          return this.props.children;
        }
      }


      let renderer: any = null;
      act(() => {
        renderer = ReactTestRenderer.create(
          <TestErrorBoundary>
            <ThemeConsumer />
          </TestErrorBoundary>
        );
      });

      const errorMsg = renderer.root.findByProps({ testID: 'error-msg' });
      expect(errorMsg.props.children).toBe('useTheme must be used within a ThemeProvider');

      spyError.mockRestore();
    });


  });
});
