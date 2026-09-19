/**
 * Remy Reminders - On-Device Prospective Date & Deadline Extractor
 * Pure TypeScript parser for relative time cues ("in 15 mins", "by 5 PM")
 * and absolute deadlines ("due 20-Sep-2026", "tomorrow morning").
 * Enforces 00s clock truncation conforming with Remy's snooze engine invariants.
 */

const MONTHS_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export interface ExtractedDateResult {
  date: Date;
  armed: boolean;
  rawCue: string | null;
}

/**
 * Extracts a target due date from natural language text.
 * Zero external libraries (no moment, no date-fns).
 */
export function extractDate(text: string, now: Date = new Date()): ExtractedDateResult {
  // 1. Relative minute offsets: "in 15 mins", "in 3 mins", "15 mins", "arriving in 12 mins"
  const minMatch = text.match(/(?:\bin\s+)?(\d+)\s*(?:mins?|minutes?)\b/i);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    const target = new Date(now.getTime() + mins * 60 * 1000);
    target.setSeconds(0, 0);
    return { date: target, armed: true, rawCue: minMatch[0].trim() };
  }

  // 2. Relative hour offsets: "in 3 hours", "in 2 hrs", "3 hours", "expires in 3 hours"
  const hrMatch = text.match(/(?:\bin\s+)?(\d+)\s*(?:hours?|hrs?)\b/i);
  if (hrMatch) {
    const hours = parseInt(hrMatch[1], 10);
    const target = new Date(now.getTime() + hours * 3600 * 1000);
    target.setSeconds(0, 0);
    return { date: target, armed: true, rawCue: hrMatch[0].trim() };
  }

  // 3. Absolute clock time: "arriving by 5 PM", "today by 8 PM", "departing tomorrow at 08:30 AM", "at 19:40"
  const clockMatch = text.match(/(?:by|at|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  const isTomorrow = /\btomorrow\b/i.test(text);

  if (clockMatch) {
    let hours = parseInt(clockMatch[1], 10);
    const minutes = clockMatch[2] ? parseInt(clockMatch[2], 10) : 0;
    const meridian = clockMatch[3] ? clockMatch[3].toLowerCase() : null;

    if (meridian === 'pm' && hours < 12) hours += 12;
    if (meridian === 'am' && hours === 12) hours = 0;

    const target = new Date(now.getTime());
    if (isTomorrow) {
      target.setDate(target.getDate() + 1);
    }
    target.setHours(hours, minutes, 0, 0);

    // If "tomorrow" was not explicit, but target time has already passed today, rollover to tomorrow
    if (!isTomorrow && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return { date: target, armed: true, rawCue: clockMatch[0].trim() };
  }

  // 4. Calendar date: "20-Sep-2026", "20-Sep", "Sep 20", "20 September", "25th September"
  const calMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?[-/ ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ]?(\d{4})?\b/i
  );
  if (calMatch) {
    const day = parseInt(calMatch[1], 10);
    const month = MONTHS_MAP[calMatch[2].toLowerCase().slice(0, 3)];
    const year = calMatch[3] ? parseInt(calMatch[3], 10) : now.getFullYear();

    const target = new Date(year, month, day, 9, 0, 0, 0); // Standard 09:00 morning alarm
    // If year omitted and date is >30 days in the past, roll forward to next year
    if (!calMatch[3] && target.getTime() < now.getTime() - 30 * 86400000) {
      target.setFullYear(year + 1);
    }
    return { date: target, armed: true, rawCue: calMatch[0].trim() };
  }

  // 5. "due tomorrow" / "tomorrow morning" / "tomorrow"
  if (isTomorrow) {
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return { date: target, armed: true, rawCue: 'tomorrow' };
  }

  // 6. "midnight" / "tonight"
  if (/\bmidnight\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(23, 59, 0, 0);
    return { date: target, armed: true, rawCue: 'midnight' };
  }

  // 7. Generic delivery or logistics alert without explicit time -> Defaults to 19:00:00 today (or +1h if evening)
  if (/\b(?:out for delivery|in transit|order shipped|package shipped|dispatched|arriving today|delivered|ready for pickup|pickup ready|parcel ready)\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(19, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 60 * 60 * 1000); // +1 hour if already evening
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: 'out for delivery' };
  }

  // 8. Fallback: unarmed generic to-do (24h default)
  const fallback = new Date(now.getTime() + 24 * 3600 * 1000);
  fallback.setSeconds(0, 0);
  return { date: fallback, armed: false, rawCue: null };
}
