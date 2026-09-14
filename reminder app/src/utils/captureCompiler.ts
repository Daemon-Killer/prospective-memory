/**
 * Capture compiler: lingo shorthand + optional time cue.
 * Produces a Reminder draft. Time is optional; inbox dumps stay unarmed.
 *
 * Re-exports pure compiler core functions for backwards compatibility.
 * Retains AsyncStorage persistence functions for React Native / mobile use.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_LINGO } from './captureCompilerCore';

// Re-export all pure parsing functions, types, and constants
export * from './captureCompilerCore';

export const LINGO_STORAGE_KEY = '@remy/lingo_table';

export async function getStoredLingo(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(LINGO_STORAGE_KEY);
    return saved !== null && saved.trim().length > 0 ? saved : DEFAULT_LINGO;
  } catch {
    return DEFAULT_LINGO;
  }
}

export async function saveStoredLingo(table: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LINGO_STORAGE_KEY, table);
  } catch (err) {
    console.warn('Error saving lingo table:', err);
  }
}

export async function resetStoredLingo(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LINGO_STORAGE_KEY);
  } catch (err) {
    console.warn('Error resetting lingo table:', err);
  }
}
