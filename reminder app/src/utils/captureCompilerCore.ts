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

export interface MusicDraft {
  action: 'play';
  cleanQuery: string;
  confidence: number;
  hasTimeCue?: boolean;
}

export interface CaptureDraft {
  raw: string;
  title: string;
  lingoKey: string | null;
  preset: CapturePreset;
  dueDate: Date;
  armed: boolean;
  tags?: string[];
  musicDraft?: MusicDraft;
}

export const AUDIO_VERBS_REGEX = /^(?:play|listen\s+to|hear|stream|put\s+on)\b/i;

export const MUSIC_MARKERS_REGEX =
  /\b(songs?|tracks?|music|albums?|playlists?|lo-?fi|ghazals?|bhajans?|qawwali|beats|soundtracks?|ost|disco|remix|acoustic|instrumental|jazz|rock|pop|classical|hiphop|hip-hop|rap|edm|ambient|raga|raag|carnatic|hindustani|sufi|k-?pop|j-?pop|metal|blues|reggae|folk)\b/i;

export const NON_MUSIC_PLAY_ACTIVITIES_REGEX =
  /^(?:play\s+)?(?:\b(?:with\b.*|tennis|table\s+tennis|ping\s+pong|badminton|cricket|football|soccer|basketball|volleyball|baseball|softball|golf|rugby|hockey|squash|racquetball|pickleball|padel|pool|billiards|snooker|chess|checkers|cards|poker|blackjack|rummy|bridge|solitaire|dominoes|mahjong|monopoly|scrabble|trivia|bingo|charades|twister|board\s+games?|video\s+games?|games?|a\s+game|the\s+game|sports?|tag|hide\s+and\s+seek|catch|frisbee|dodgeball|kickball|handball|bowling|darts|foosball|pinball|outside|in\s+the\s+(?:park|yard|garden|snow|mud)|dead|dumb|the\s+fool|a\s+role|victim|safe|it\s+safe|fair|it\s+cool|cool|hardball|defense|offense|hooky|pranks?)\b)/i;

export const NON_MUSIC_LISTEN_TARGETS_REGEX =
  /^(?:the\s+|a\s+|an\s+|my\s+|our\s+|your\s+|his\s+|her\s+|their\s+)?(?:mom|mother|mum|dad|father|parents?|wife|husband|spouse|partner|brother|sister|son|daughter|kids?|children|child|baby|babies|family|friends?|grandma|grandmother|grandpa|grandfather|aunt|uncle|cousin|doctor|dr\.?|nurse|teacher|professor|boss|manager|client|lawyer|colleagues?|coworkers?|team|mentor|coach|therapist|counselor|priest|pastor|rabbi|guru|elders?|people|someone|everyone|everybody|anybody|somebody|nobody|him|her|them|me|us|voicemail|voicemails|voice\s*mail|voice\s*mails|voice\s*memo|voice\s*memos|voice\s*notes?|messages?|audio\s*messages?|phone\s*call|recordings?|audio\s*recordings?|lecture|lectures|meeting|meetings|webinar|webinars|tapes?|town\s*hall|podcasts?|audio\s*books?|audiobooks?|advice|feedback|suggestions?|instructions?|reason|gut|heart|conscience|inner\s*voice|warning|intuition|logic|common\s*sense)\b/i;

export const NON_MUSIC_HEAR_TARGETS_REGEX =
  /^(?:from|back\s+from|back|out|about)\b/i;

export const NON_MUSIC_PUT_ON_TARGETS_REGEX =
  /^(?:the\s+|a\s+|some\s+|my\s+|your\s+|his\s+|her\s+)?(?:jacket|coat|shoes?|boots?|socks?|pants?|shirt|clothes|clothing|suit|hat|cap|gloves?|mask|sunscreen|lotion|cream|makeup|laundry|kettle|tea|coffee|water|oven|stove|heater|ac|air\s*condition(?:er)?|alarm|tires?|glasses|seatbelt|brakes?)\b/i;

export const NON_MUSIC_STREAM_TARGETS_REGEX =
  /^(?:the\s+|a\s+)?(?:movie|film|show|series|episode|video|game|match|streamer|broadcast)\b/i;

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

/**
 * Strips bullet points, numbered list markers, and checkbox markers from a line.
 * Iteratively cleans chained prefixes like "1. [ ]" or "- [x]".
 */
export function cleanListPrefix(text: string): string {
  let cleaned = text.trim();
  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned
      // Numbered items: "1.", "1)", "(1)", "[1]", "1 -" followed by space
      .replace(/^(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s*/, '')
      // Checkboxes with optional bullet (e.g. "- [ ]", "* [x]", "[ ]")
      .replace(/^(?:[-*+•◦▪▫–—]\s*)?\[[ xX]\]\s*/, '')
      // Bullets (e.g. "-", "*", "+", "•", "◦", "▪", "▫", "–", "—")
      .replace(/^[-*+•◦▪▫–—]\s*/, '')
      .trim();
  }
  return cleaned;
}

/**
 * Extracts hashtags from text, returning clean tags array and stripped text.
 * Supports alphanumeric tags with underscores and internal hyphens (e.g. #grocery-list).
 */
export function extractTags(text: string): { tags: string[]; stripped: string } {
  const matches = text.match(
    /(?:^|\s)#([a-zA-Z_\u00C0-\u024F][a-zA-Z0-9_\u00C0-\u024F]*(?:-[a-zA-Z0-9_\u00C0-\u024F]+)*)/g
  );
  if (!matches) {
    return { tags: [], stripped: text.trim() };
  }

  const tags: string[] = [];
  let stripped = text;

  for (const m of matches) {
    const cleanTag = m.trim().replace(/^#/, '');
    if (cleanTag && !tags.includes(cleanTag)) {
      tags.push(cleanTag);
    }
    stripped = stripped.replace(m, ' ');
  }

  return {
    tags,
    stripped: stripped.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Detects whether text contains multiple lines, bullet points, numbered items, or checkboxes.
 */
export function isListOrMultiLine(text: string): boolean {
  if (!text) return false;
  if (/[\r\n]/.test(text)) return true;
  if (/[•◦▪▫]/.test(text)) return true;
  if (/(?:^|\s)(?:[-*+•◦▪▫–—]\s+)?\[[ xX]\]\s/.test(text)) return true;
  // Numbered list items: "1. ... 2. ..." or "(1) ... (2) ..." or "[1] ... [2] ..." or "1) ... 2) ..."
  if (
    /(?:^|\s)(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s+.*?(?:\s)(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s+/.test(
      text
    )
  )
    return true;
  // Multiple bullets: "- Item 1 - Item 2" or "* Item 1 * Item 2"
  if (/(?:^|\s+)[-*+]\s+.*?(?:\s+)[-*+]\s+/.test(text)) return true;
  return false;
}

/**
 * Detects natural language music playback intent and disambiguates
 * against physical sports, tasks, and non-music activities.
 */
export function parseMusicIntent(
  text: string,
  hasTimeCue: boolean = false
): MusicDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Disqualify explicit non-playback task verbs at the beginning
  if (
    /^(?:buy|purchase|order|call|phone|email|mail|pay|send|write|clean|cook|bake|wash|fix|repair|practice|learn|read|meet|schedule|delete|remove|share)\b/i.test(
      trimmed
    )
  ) {
    return null;
  }

  // Disqualify physical sports, games, and playing with people/pets
  if (NON_MUSIC_PLAY_ACTIVITIES_REGEX.test(trimmed)) {
    return null;
  }

  // Check for standalone musical instrument playing (e.g. "play guitar", "play piano")
  // unless explicitly accompanied by markers like "songs", "tracks", "music"
  const instrumentMatch = trimmed.match(
    /^play\s+(?:the\s+)?(guitar|piano|violin|drums|flute|harmonium|tabla|cello|saxophone|trumpet)\b/i
  );
  if (instrumentMatch && !MUSIC_MARKERS_REGEX.test(trimmed)) {
    return null;
  }

  const verbMatch = trimmed.match(AUDIO_VERBS_REGEX);
  const hasMusicMarker = MUSIC_MARKERS_REGEX.test(trimmed);

  if (verbMatch) {
    const verb = verbMatch[0].toLowerCase();
    let cleanQuery = trimmed.slice(verbMatch[0].length).trim();
    cleanQuery = cleanQuery.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    if (!cleanQuery) return null;

    // Check if clean query matches non-music activity
    if (
      NON_MUSIC_PLAY_ACTIVITIES_REGEX.test(cleanQuery) ||
      NON_MUSIC_PLAY_ACTIVITIES_REGEX.test(trimmed)
    ) {
      return null;
    }

    // Disambiguate "listen to <non-music target>" unless accompanied by music markers
    if (verb.startsWith('listen') && !hasMusicMarker) {
      if (NON_MUSIC_LISTEN_TARGETS_REGEX.test(cleanQuery)) {
        return null;
      }
    }

    // Disambiguate "hear <from / back from / out / about>" unless accompanied by music markers
    if (verb.startsWith('hear') && !hasMusicMarker) {
      if (NON_MUSIC_HEAR_TARGETS_REGEX.test(cleanQuery)) {
        return null;
      }
    }

    // Disambiguate "put on <clothing / appliance / chore>" unless accompanied by music markers
    if (verb.startsWith('put on') && !hasMusicMarker) {
      if (NON_MUSIC_PUT_ON_TARGETS_REGEX.test(cleanQuery)) {
        return null;
      }
    }

    // Disambiguate "stream <movie / show / game>" unless accompanied by music markers
    if (verb.startsWith('stream') && !hasMusicMarker) {
      if (NON_MUSIC_STREAM_TARGETS_REGEX.test(cleanQuery)) {
        return null;
      }
    }

    const confidence = hasMusicMarker ? 0.95 : 0.85;
    return {
      action: 'play',
      cleanQuery,
      confidence,
      hasTimeCue,
    };
  }

  // Standalone music markers without leading verb (e.g. "spb songs hindi", "lofi chill beats")
  if (hasMusicMarker && !/^(?:task|remind|todo|note)\b/i.test(trimmed)) {
    if (/\b(songs?|tracks?|playlists?|lo-?fi|ghazals?)\b/i.test(trimmed)) {
      const cleanQuery = trimmed.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
      return {
        action: 'play',
        cleanQuery,
        confidence: 0.8,
        hasTimeCue,
      };
    }
  }

  return null;
}

export function compileCaptureWithIntent(
  raw: string,
  selectedChip: CaptureChip = 'inbox',
  now: Date = new Date(),
  lingoTable: string = DEFAULT_LINGO
): CaptureDraft {
  const cleanedRaw = cleanListPrefix(raw);
  const { tags, stripped: tagStripped } = extractTags(cleanedRaw);
  const expansion = expandLingo(tagStripped, lingoTable);
  const title = expansion.output.slice(0, 255).trim();

  const isChipTimed = selectedChip !== 'inbox';
  const inferred = isChipTimed ? null : inferTimeCue(title, now);
  const hasTimeCue = isChipTimed || inferred !== null;

  const musicTargetText = inferred ? inferred.strippedTitle : title;
  const musicDraft = parseMusicIntent(musicTargetText, hasTimeCue);

  if (isChipTimed) {
    return {
      raw,
      title,
      lingoKey: expansion.key,
      preset: selectedChip,
      dueDate: CHIP_CALC[selectedChip](now),
      armed: true,
      tags: tags.length > 0 ? tags : undefined,
      musicDraft: musicDraft || undefined,
    };
  }

  if (inferred) {
    return {
      raw,
      title: inferred.strippedTitle.slice(0, 255).trim(),
      lingoKey: expansion.key,
      preset: inferred.preset,
      dueDate: inferred.dueDate,
      armed: true,
      tags: tags.length > 0 ? tags : undefined,
      musicDraft: musicDraft || undefined,
    };
  }

  return {
    raw,
    title,
    lingoKey: expansion.key,
    preset: 'inbox',
    dueDate: now,
    armed: false,
    tags: tags.length > 0 ? tags : undefined,
    musicDraft: musicDraft || undefined,
  };
}

export function compileCapture(
  raw: string,
  selectedChip: CaptureChip = 'inbox',
  now: Date = new Date(),
  lingoTable: string = DEFAULT_LINGO
): CaptureDraft {
  return compileCaptureWithIntent(raw, selectedChip, now, lingoTable);
}

/**
 * Splits multi-line or list text (e.g. from clipboard paste) into distinct non-empty lines,
 * detecting newlines, bullet points, checkboxes, and numbered items.
 */
export function splitMultiLine(text: string): string[] {
  if (!text || !text.trim()) return [];

  const hasNewlines = /[\r\n]/.test(text);
  let rawChunks: string[] = [];

  if (hasNewlines) {
    rawChunks = text.split(/\r?\n/);
  } else {
    const hasInlineBullets = /[•◦▪▫]/.test(text);
    const hasInlineCheckboxes = /(?:^|\s)(?:[-*+•◦▪▫–—]\s+)?\[[ xX]\]\s/.test(text);
    const hasInlineNumbered =
      /(?:^|\s)(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s+.*?(?:\s)(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s+/.test(
        text
      );
    const hasInlineDashBullets = /(?:^|\s+)[-*+]\s+.*?(?:\s+)[-*+]\s+/.test(text);

    if (hasInlineBullets) {
      rawChunks = text.split(/(?:^|\s+)[•◦▪▫]\s+/);
    } else if (hasInlineCheckboxes) {
      rawChunks = text.split(/(?:^|\s+)(?:[-*+•◦▪▫–—]\s+)?\[[ xX]\]\s+/);
    } else if (hasInlineNumbered) {
      rawChunks = text.split(/(?:^|\s+)(?:[([]?\d+[.)\]]|\d+\s*[-–—])\s+/);
    } else if (hasInlineDashBullets) {
      rawChunks = text.split(/(?:^|\s+)[-*+]\s+/);
    } else {
      rawChunks = [text];
    }
  }

  const expanded: string[] = [];
  for (const chunk of rawChunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (/[•◦▪▫]/.test(trimmed)) {
      const sub = trimmed
        .split(/(?:^|\s+)[•◦▪▫]\s+/)
        .map((s) => cleanListPrefix(s))
        .filter(Boolean);
      if (sub.length > 1) {
        expanded.push(...sub);
        continue;
      }
    }
    const cleaned = cleanListPrefix(trimmed);
    if (cleaned.length > 0) {
      expanded.push(cleaned);
    }
  }

  return expanded;
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
