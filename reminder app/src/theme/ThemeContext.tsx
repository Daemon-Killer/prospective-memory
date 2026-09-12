/**
 * Remy Reminders - Theme Context & Hook
 * Provides reactive theme state, AsyncStorage persistence (@remy_theme_mode),
 * cycleTheme transitions (light -> dark -> void -> light) with haptic feedback,
 * and system preference fallback.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useColorScheme, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { ThemeContract, ThemeMode } from '../types/theme';
import { themes } from './colors';
import { typography } from './typography';
import { spacing, borders } from './spacing';

export const THEME_STORAGE_KEY = '@remy_theme_mode';

export const ThemeContext = createContext<ThemeContract | undefined>(undefined);

export interface ThemeProviderProps {
  children: React.ReactNode;
  initialMode?: ThemeMode; // Optional override for tests
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, initialMode }) => {
  const systemColorScheme = useColorScheme();

  // Default to initialMode, or dark if system is dark, else light
  const getInitialDefault = (): ThemeMode => {
    if (initialMode) return initialMode;
    return systemColorScheme === 'dark' ? 'dark' : 'light';
  };

  const [mode, setModeState] = useState<ThemeMode>(getInitialDefault());
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Hydrate theme mode from AsyncStorage
  useEffect(() => {
    let isMounted = true;
    const hydrateTheme = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'void') {
          if (isMounted) setModeState(stored);
        }
      } catch (error) {
        console.warn('ThemeProvider: Failed to load theme mode from storage', error);
      } finally {
        if (isMounted) setIsLoaded(true);
      }
    };

    hydrateTheme();
    return () => {
      isMounted = false;
    };
  }, []);

  // Programmatic setter
  const setThemeMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (error) {
      console.warn('ThemeProvider: Failed to persist theme mode to storage', error);
    }
  }, []);

  // Cycle sequence: light -> dark -> void -> light
  const cycleTheme = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        await Haptics.selectionAsync();
      }
    } catch {
      // Haptics safe fallback for web/unsupported platforms
    }

    const nextModeMap: Record<ThemeMode, ThemeMode> = {
      light: 'dark',
      dark: 'void',
      void: 'light',
    };

    const nextMode = nextModeMap[mode];
    await setThemeMode(nextMode);
  }, [mode, setThemeMode]);

  const colors = themes[mode];
  const statusBarStyle = mode === 'light' ? 'dark' : 'light';

  const value: ThemeContract = {
    mode,
    colors,
    typography,
    spacing,
    borders,
    statusBarStyle,
    isLoaded,
    setThemeMode,
    cycleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContract => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
