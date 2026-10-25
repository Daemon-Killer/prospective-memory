/**
 * Remy Reminders - Context Modes & Routines Domain Types
 * Bifurcates Work vs Home environments and powers the Home Recollection Engine.
 */

import { Reminder } from './reminder';

export type ContextMode = 'work' | 'home' | 'all';

export type ReminderContext = 'work' | 'home' | 'personal' | 'general';

export interface ModeConfig {
  activeMode: ContextMode;
  autoSilentAtWork: boolean;
  autoUnsilentAtHome: boolean;
  promptWifiOnSwitch: boolean;
  workWifiSsid?: string | null;
  homeWifiSsid?: string | null;
  workSchedule?: { start: string; end: string } | null; // e.g. "09:00" to "18:00"
}

export type RecollectionCategory = 'grocery' | 'call' | 'chore' | 'general';

export interface RecollectionItem {
  id: string;
  title: string;
  category: RecollectionCategory;
  dueDate: string;
  notes?: string | null;
  tags?: string[];
  reminder?: Reminder;
}
