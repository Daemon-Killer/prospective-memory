import { Reminder, CulturalMetadata, CulturalMediaType } from '../types/reminder';

export const POPULAR_PLATFORMS = [
  'Netflix',
  'Prime Video',
  'Apple TV',
  'Disney+',
  'Max',
  'Hulu',
  'Peacock',
  'Paramount+',
  'YouTube',
  'Cinema',
  'Criterion',
  'Kindle',
  'Spotify',
  'Audible',
] as const;

export type PopularPlatform = (typeof POPULAR_PLATFORMS)[number];

interface PlatformRule {
  name: PopularPlatform;
  regex: RegExp;
}

const PLATFORM_RULES: PlatformRule[] = [
  { name: 'Netflix', regex: /\b(?:on\s+)?netflix\b/i },
  { name: 'Prime Video', regex: /\b(?:on\s+)?(?:prime\s*video|amazon\s*prime|prime)\b/i },
  { name: 'Apple TV', regex: /\b(?:on\s+)?(?:apple\s*tv\+?|atv\+?)\b/i },
  { name: 'Disney+', regex: /\b(?:on\s+)?(?:disney\+?|disney\s*plus)\b/i },
  { name: 'Max', regex: /\b(?:on\s+)?(?:hbo\s*max|hbo|max)\b/i },
  { name: 'Hulu', regex: /\b(?:on\s+)?hulu\b/i },
  { name: 'Peacock', regex: /\b(?:on\s+)?peacock\b/i },
  { name: 'Paramount+', regex: /\b(?:on\s+)?(?:paramount\+?|paramount\s*plus)\b/i },
  { name: 'YouTube', regex: /\b(?:on\s+)?(?:youtube|yt)\b/i },
  { name: 'Cinema', regex: /\b(?:in\s+)?(?:cinema|theaters?|theatres?|imax)\b/i },
  { name: 'Criterion', regex: /\b(?:on\s+)?(?:criterion|criterion\s*channel)\b/i },
  { name: 'Kindle', regex: /\b(?:on\s+)?kindle\b/i },
  { name: 'Spotify', regex: /\b(?:on\s+)?spotify\b/i },
  { name: 'Audible', regex: /\b(?:on\s+)?audible\b/i },
];

export interface ParsedCulturalCapture {
  title: string;
  notes?: string | null;
  metadata: CulturalMetadata;
}

/**
 * Parses raw leisure / cultural thought input and enriches with structured metadata
 * (streaming platform, media type, release year, runtime, tags, recommender, creator, notes).
 */
export function parseCulturalCapture(
  rawInput: string,
  fallbackType: CulturalMediaType = 'movie'
): ParsedCulturalCapture {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      title: 'Untitled',
      notes: null,
      metadata: { mediaType: fallbackType },
    };
  }

  // Handle multi-line input
  const allLines = rawInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (allLines.length === 0) {
    return {
      title: 'Untitled',
      notes: null,
      metadata: { mediaType: fallbackType },
    };
  }

  let titleLine = allLines[0];
  const subsequentLines = allLines.slice(1);
  let notesFromSubsequent: string | null =
    subsequentLines.length > 0 ? subsequentLines.join('\n') : null;

  let mediaType: CulturalMediaType = fallbackType;
  let platform: string | null = null;
  let releaseYear: number | null = null;
  let runtime: string | null = null;
  let recommendedBy: string | null = null;
  let creator: string | null = null;
  const genres: string[] = [];

  // 1. Detect platform in titleLine, or fallback to notes
  for (const rule of PLATFORM_RULES) {
    if (rule.regex.test(titleLine)) {
      platform = rule.name;
      titleLine = titleLine.replace(rule.regex, ' ');
      break;
    }
  }
  if (!platform && notesFromSubsequent) {
    for (const rule of PLATFORM_RULES) {
      if (rule.regex.test(notesFromSubsequent)) {
        platform = rule.name;
        notesFromSubsequent = notesFromSubsequent.replace(rule.regex, ' ');
        break;
      }
    }
  }

  // 2. Extract recommender: "rec by Alex", "recommended by Alex", "via Alex", or non-leading "from Alex"
  const recRegex = /\b(?:rec(?:ommended)?\s+by|via)\s+([A-Za-z0-9_@]+)\b/i;
  const recMatch = titleLine.match(recRegex);
  if (recMatch) {
    recommendedBy = recMatch[1];
    titleLine = titleLine.replace(recMatch[0], ' ');
  } else {
    // Only accept "from [Name]" if NOT at the start of the title line (e.g. "Solaris from Dave" vs "From Dusk Till Dawn")
    const fromMatch = titleLine.match(/(?:^|\s+)from\s+([A-Za-z0-9_@]+)\b/i);
    if (fromMatch && fromMatch.index !== undefined && fromMatch.index > 0) {
      recommendedBy = fromMatch[1];
      titleLine = titleLine.replace(fromMatch[0], ' ');
    }
  }

  if (!recommendedBy && notesFromSubsequent) {
    const recNotesMatch =
      notesFromSubsequent.match(recRegex) ||
      notesFromSubsequent.match(/\bfrom\s+([A-Za-z0-9_@]+)\b/i);
    if (recNotesMatch) {
      recommendedBy = recNotesMatch[1];
      notesFromSubsequent = notesFromSubsequent.replace(recNotesMatch[0], ' ');
    }
  }

  // 3. Extract creator/director/author
  const dirMatch = titleLine.match(
    /\b(?:dir(?:ected)?\.?\s+by|dir\.)\s+([A-Za-z\s.]+?)(?=\s+(?:on|in|#|\(|\[|from|via|rec|\d+)|$)/i
  );
  if (dirMatch) {
    creator = dirMatch[1].trim();
    titleLine = titleLine.replace(dirMatch[0], ' ');
  } else {
    const authorMatch = titleLine.match(
      /\b(?:author:?|written\s+by)\s+([A-Za-z\s.]+?)(?=\s+(?:on|in|#|\(|$|\[|via|rec|\d+)|$)/i
    );
    if (authorMatch) {
      creator = authorMatch[1].trim();
      titleLine = titleLine.replace(authorMatch[0], ' ');
    }
  }

  // 4. Detect media type
  if (/\b(?:doc|documentary|docuseries)\b/i.test(titleLine)) {
    mediaType = 'documentary';
  } else if (/\b(?:book|novel|audiobook|read|reading)\b/i.test(titleLine)) {
    mediaType = 'book';
  } else if (/\b(?:podcast|pod|album|music|track|song|game)\b/i.test(titleLine)) {
    mediaType = 'other';
  } else if (/\b(?:show|series|season|s\d+|episode|ep\s*\d+)\b/i.test(titleLine)) {
    mediaType = 'show';
  } else if (/\b(?:movie|film|watch|cinema)\b/i.test(titleLine) || dirMatch) {
    mediaType = 'movie';
  } else if (fallbackType === 'book') {
    mediaType = 'book';
  }

  // If creator still not extracted and "by [Name]" is present
  if (!creator) {
    const byMatch = titleLine.match(
      /\bby\s+([A-Z][a-zA-Z\s.]+?)(?=\s+(?:on|in|#|\(|\[|from|via|rec|\d+)|$)/
    );
    if (byMatch) {
      creator = byMatch[1].trim();
      titleLine = titleLine.replace(byMatch[0], ' ');
    }
  }

  // Clean explicit type keywords from text if prefixed or auxiliary
  titleLine = titleLine
    .replace(/^(?:watch|read|see)\s+/i, '')
    .replace(/\b(?:book|doc|documentary)\b(?!\s+(?:of|the)\b)/gi, ' ');

  // 5. Extract release year: priority to parenthesized/bracketed year, then trailing year preceded by title
  const explicitYearMatch = titleLine.match(/[\(\[]([12]\d{3})[\)\]]/);
  if (explicitYearMatch) {
    const y = parseInt(explicitYearMatch[1], 10);
    if (y >= 1888 && y <= 2099) {
      releaseYear = y;
      titleLine = titleLine.replace(explicitYearMatch[0], ' ');
    }
  } else {
    // Only match an unparenthesized 4-digit year if preceded by title words and plausible (1888 to 2029)
    const trailingYearMatch = titleLine.match(
      /(?<=\b[A-Za-z0-9'\-:–—]{2,}\s+)(19\d\d|20[0-2]\d)\b/
    );
    if (trailingYearMatch) {
      const y = parseInt(trailingYearMatch[1], 10);
      releaseYear = y;
      titleLine = titleLine.replace(trailingYearMatch[0], ' ');
    }
  }

  // 6. Extract runtime: e.g. "148m", "148 min", "1h 21m", "8 eps", "450 pages"
  const runtimeMatch = titleLine.match(
    /\b(\d+\s*h(?:\s*\d+\s*m(?:in)?|\s*\d+m?)?|\d+\s*(?:min|mins|m|eps|episodes|p|pages))\b/i
  );
  if (runtimeMatch) {
    runtime = runtimeMatch[1].trim();
    titleLine = titleLine.replace(runtimeMatch[0], ' ');
  }

  // 7. Extract hashtag genres / tags from title and notes
  const combinedText = titleLine + ' ' + (notesFromSubsequent || '');
  const tagMatches = combinedText.match(/#(\w+)/g);
  if (tagMatches) {
    for (const tag of tagMatches) {
      const cleanTag = tag.slice(1);
      if (cleanTag && !genres.includes(cleanTag)) {
        genres.push(cleanTag);
      }
      titleLine = titleLine.replace(tag, ' ');
      if (notesFromSubsequent) {
        notesFromSubsequent = notesFromSubsequent.replace(tag, ' ');
      }
    }
  }

  // 8. Clean residual punctuation and multiple spaces
  const cleanTitle =
    titleLine
      .replace(/\s+/g, ' ')
      .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '')
      .trim() || 'Untitled';

  const cleanNotes = notesFromSubsequent
    ? notesFromSubsequent
        .split('\n')
        .map((l) =>
          l
            .replace(/\s+/g, ' ')
            .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '')
            .trim()
        )
        .filter(Boolean)
        .join('\n')
    : null;

  return {
    title: cleanTitle,
    notes: cleanNotes || null,
    metadata: {
      mediaType,
      platform,
      releaseYear,
      runtime,
      genres: genres.length > 0 ? genres : undefined,
      recommendedBy,
      creator,
    },
  };
}

export interface WeekendWatchlistCue {
  isWeekendCueActive: boolean;
  count: number;
  items: Reminder[];
  headline: string;
  subtext: string;
}

/**
 * Evaluates contextual weekend surfacing.
 * Active from Friday afternoon (>= 15:00) through Sunday evening (23:59).
 */
export function getWeekendWatchlistCue(
  reminders: Reminder[],
  currentTime: Date = new Date()
): WeekendWatchlistCue {
  const day = currentTime.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hours = currentTime.getHours();

  // Friday >= 15:00, or Saturday all day, or Sunday until 23:00
  const isWeekendWindow =
    (day === 5 && hours >= 15) || day === 6 || (day === 0 && hours < 23);

  // Filter uncompleted items that have cultural metadata
  const culturalItems = reminders.filter(
    (r) => r.status !== 'completed' && Boolean(r.culturalMetadata)
  );

  const count = culturalItems.length;
  const isWeekendCueActive = isWeekendWindow && count > 0;

  let subtext = `${count} item${count === 1 ? '' : 's'} queued for the weekend`;
  if (count === 1) {
    const item = culturalItems[0];
    const platform = item.culturalMetadata?.platform;
    subtext = platform ? `Queue ready on ${platform}` : '1 item ready for tonight';
  }

  return {
    isWeekendCueActive,
    count,
    items: culturalItems,
    headline: 'WEEKEND WATCHLIST',
    subtext,
  };
}

/**
 * Formats a clean Swiss Void tabular metadata badge string for card display.
 * e.g. "MOVIE · NETFLIX · 2024 · 148 MIN"
 */
export function formatCulturalBadge(metadata: CulturalMetadata): string {
  const parts: string[] = [];
  if (metadata.mediaType) {
    parts.push(metadata.mediaType.toUpperCase());
  }
  if (metadata.platform) {
    parts.push(metadata.platform.toUpperCase());
  }
  if (metadata.releaseYear) {
    parts.push(String(metadata.releaseYear));
  }
  if (metadata.runtime) {
    parts.push(metadata.runtime.toUpperCase());
  }
  if (metadata.creator && !metadata.platform) {
    parts.push(`BY ${metadata.creator.toUpperCase()}`);
  }
  if (metadata.recommendedBy && !metadata.platform && !metadata.creator) {
    parts.push(`VIA ${metadata.recommendedBy.toUpperCase()}`);
  }
  return parts.join(' · ');
}
