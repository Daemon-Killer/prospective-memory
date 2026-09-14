/**
 * Remy Reminders - Zero-Dependency Core Capture Parser
 * Pure TypeScript standard library only.
 * No external dependencies, No React Native, No AsyncStorage.
 */

import { SnoozePreset } from '../types/reminder';
import {
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
  calculateWeekend,
} from './snoozeCalculator';

export type CaptureChip = 'inbox' | '15m' | '1h' | 'evening' | 'tomorrow_morning';
export type CapturePreset = SnoozePreset | 'inbox';

export const DEFAULT_LINGO = [
  'd|dahi=dahi lena',
  'c|call=call $',
  'buy=buy $',
  'pay bill=pay electricity bill',
].join('\n');

export interface LingoExpansion {
  input: string;
  output: string;
  key: string | null;
  changed: boolean;
}

export interface CaptureDraft {
  raw: string;
  title: string;
  lingoKey: string | null;
  preset: CapturePreset;
  dueDate: Date;
  armed: boolean;
}

interface TimeRule {
  pattern: RegExp;
  preset: SnoozePreset;
  calc: (now: Date) => Date;
}

const TIME_RULES: TimeRule[] = [
  {
    pattern: /\b(tomorrow morning|kal subah)\b/i,
    preset: 'tomorrow_morning',
    calc: (now) => calculateTomorrowMorning(now),
  },
  {
    pattern: /\b(tonight|this evening|shaam)\b/i,
    preset: 'evening',
    calc: (now) => calculateThisEvening(now),
  },
  {
    pattern: /\b(weekend|saturday)\b/i,
    preset: 'weekend',
    calc: (now) => calculateWeekend(now),
  },
  {
    pattern: /(?:\+?1h|\b1 hour|\bin an hour)\b/i,
    preset: '1h',
    calc: (now) => calculate1Hour(now),
  },
  {
    pattern: /(?:\+?15m|\+15|\b15 mins?|\bin 15)\b/i,
    preset: '15m',
    calc: (now) => calculate15Minutes(now),
  },
  {
    pattern: /\b(tomorrow|kal)\b/i,
    preset: 'tomorrow_morning',
    calc: (now) => calculateTomorrowMorning(now),
  },
  {
    pattern: /\b(subah|morning)\b/i,
    preset: 'tomorrow_morning',
    calc: (now) => calculateTomorrowMorning(now),
  },
  {
    pattern: /\b(evening)\b/i,
    preset: 'evening',
    calc: (now) => calculateThisEvening(now),
  },
];

const CHIP_CALC: Record<Exclude<CaptureChip, 'inbox'>, (now: Date) => Date> = {
  '15m': (now) => calculate15Minutes(now),
  '1h': (now) => calculate1Hour(now),
  evening: (now) => calculateThisEvening(now),
  tomorrow_morning: (now) => calculateTomorrowMorning(now),
};

export function parseLingoTable(table: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of table.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const lhs = t.slice(0, eq).trim().toLowerCase();
    const rhs = t.slice(eq + 1).trim();
    if (!lhs || !rhs) continue;
    for (const alias of lhs.split('|')) {
      const key = alias.trim();
      if (key) out.set(key, rhs);
    }
  }
  return out;
}

function matchLingoKey(text: string, keys: string[]): string | null {
  const lower = text.toLowerCase();
  const exact = keys
    .filter((key) => lower === key || lower.startsWith(`${key} `))
    .sort((a, b) => b.length - a.length)[0];
  if (exact) return exact;

  const token = lower.split(/\s+/, 2)[0];
  if (!token) return null;
  const prefixed = keys.filter((key) => key.startsWith(token));
  if (prefixed.length === 0) return null;
  if (prefixed.includes(token)) return token;
  if (prefixed.length === 1) return prefixed[0];
  return prefixed.sort((a, b) => a.length - b.length)[0] ?? null;
}

function applyLingoTemplate(template: string, rest: string): string {
  if (template.includes('$')) {
    return template.split('$').join(rest).replace(/\s+/g, ' ').trim();
  }
  if (!rest) return template;
  return `${template} ${rest}`.replace(/\s+/g, ' ').trim();
}

export function expandLingo(raw: string, table: string = DEFAULT_LINGO): LingoExpansion {
  const text = raw.trim();
  if (!text) return { input: text, output: text, key: null, changed: false };
  const map = parseLingoTable(table);
  if (map.size === 0) return { input: text, output: text, key: null, changed: false };

  const exactTemplateMatch = Array.from(map.values()).find(
    (tpl) => !tpl.includes('$') && tpl.toLowerCase() === text.toLowerCase()
  );
  if (exactTemplateMatch) return { input: text, output: text, key: null, changed: false };

  const hit = matchLingoKey(text, Array.from(map.keys()));
  if (!hit) return { input: text, output: text, key: null, changed: false };

  const rest = text.slice(hit.length).trim();
  const output = applyLingoTemplate(map.get(hit) as string, rest);
  return { input: text, output, key: hit, changed: output !== text };
}

export function inferTimeCue(
  title: string,
  now: Date = new Date()
): { preset: SnoozePreset; dueDate: Date; strippedTitle: string } | null {
  for (const rule of TIME_RULES) {
    const match = title.match(rule.pattern);
    if (!match || match.index === undefined) continue;
    const stripped = `${title.slice(0, match.index)} ${title.slice(match.index + match[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return {
      preset: rule.preset,
      dueDate: rule.calc(now),
      strippedTitle: stripped.length > 0 ? stripped : title.trim(),
    };
  }
  return null;
}

export function compileCapture(
  raw: string,
  selectedChip: CaptureChip = 'inbox',
  now: Date = new Date(),
  lingoTable: string = DEFAULT_LINGO
): CaptureDraft {
  const expansion = expandLingo(raw, lingoTable);
  const title = expansion.output;

  if (selectedChip !== 'inbox') {
    return {
      raw,
      title,
      lingoKey: expansion.key,
      preset: selectedChip,
      dueDate: CHIP_CALC[selectedChip](now),
      armed: true,
    };
  }

  const inferred = inferTimeCue(title, now);
  if (inferred) {
    return {
      raw,
      title: inferred.strippedTitle,
      lingoKey: expansion.key,
      preset: inferred.preset,
      dueDate: inferred.dueDate,
      armed: true,
    };
  }

  return {
    raw,
    title,
    lingoKey: expansion.key,
    preset: 'inbox',
    dueDate: now,
    armed: false,
  };
}

/**
 * Splits multi-line text (e.g. from clipboard paste) into distinct non-empty lines.
 */
export function splitMultiLine(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Compiles each line from a multi-line thought dump into an array of CaptureDrafts.
 */
export function compileMultiLineCapture(
  raw: string,
  selectedChip: CaptureChip = 'inbox',
  now: Date = new Date(),
  lingoTable: string = DEFAULT_LINGO
): CaptureDraft[] {
  const lines = splitMultiLine(raw);
  if (lines.length === 0) return [];
  return lines.map((line) => compileCapture(line, selectedChip, now, lingoTable));
}

/**
 * Lingo compression: inverse of expansion.
 * Maps full text back to its shortest lingo shorthand if it matches any pattern.
 */
export function compressToLingo(
  fullText: string,
  table: string = DEFAULT_LINGO
): { compressed: string; key: string | null } {
  const text = fullText.trim();
  if (!text) return { compressed: text, key: null };
  const map = parseLingoTable(table);
  if (map.size === 0) return { compressed: text, key: null };

  const lower = text.toLowerCase();

  // 1. Check exact template matches without $ (e.g. "dahi lena" -> "d")
  for (const [key, template] of map.entries()) {
    if (!template.includes('$') && template.toLowerCase() === lower) {
      // Find shortest alias for this template
      const aliases = Array.from(map.entries())
        .filter(([_, t]) => t.toLowerCase() === template.toLowerCase())
        .map(([k]) => k)
        .sort((a, b) => a.length - b.length);
      const shortestKey = aliases[0] || key;
      return { compressed: shortestKey, key: shortestKey };
    }
  }

  // 2. Check parameterized template matches with $ (e.g. "call mom" -> "c mom")
  for (const [key, template] of map.entries()) {
    if (template.includes('$')) {
      const parts = template.toLowerCase().split('$');
      const prefix = parts[0];
      const suffix = parts[1] || '';
      if (lower.startsWith(prefix) && lower.endsWith(suffix)) {
        const captured = text.slice(prefix.length, text.length - suffix.length).trim();
        const aliases = Array.from(map.entries())
          .filter(([_, t]) => t.toLowerCase() === template.toLowerCase())
          .map(([k]) => k)
          .sort((a, b) => a.length - b.length);
        const shortestKey = aliases[0] || key;
        const compressed = `${shortestKey} ${captured}`.trim();
        return { compressed, key: shortestKey };
      }
    }
  }

  return { compressed: text, key: null };
}

/**
 * Autocomplete suggestions for lingo keys matching a prefix.
 */
export function getLingoSuggestions(
  prefix: string,
  table: string = DEFAULT_LINGO,
  limit: number = 5
): Array<[string, string]> {
  const map = parseLingoTable(table);
  const safeLimit = Math.max(0, limit);
  const p = prefix.trim().toLowerCase();
  if (!p) {
    return Array.from(map.entries()).slice(0, safeLimit);
  }
  return Array.from(map.entries())
    .filter(([key]) => key.startsWith(p) || key === p)
    .sort((a, b) => a[0].length - b[0].length)
    .slice(0, safeLimit);
}
