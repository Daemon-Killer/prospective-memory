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

const ERRAND_KEYWORDS = /\b(?:bring|buy|pick\s*up|get|fetch|collect|drop|send|transfer|pay|lock|clean|wash|iron|call|phone|ring|contact|order|le\s*(?:a+na|a+o|lena)|(?:leke|le\s*kar|lekr)\s*(?:a+na|a+o)?|la+na|lao|de\s*de(?:na|o)|kar\s*de(?:na|o)|bhej(?:na|o)?|kharid(?:na|o)?|manga|mangwa|doodh|dahi|sabzi|medicine|dawai|groceries|rashan|bijli|bill|door|darwaza|gate|geyser|ac|kundi)\b/i;

/**
 * Extracts a target due date from natural language text.
 * Zero external libraries (no moment, no date-fns).
 */
export function extractDate(text: string, now: Date = new Date(), isErrand: boolean = false): ExtractedDateResult {
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

  // 3. Conversational time cue: "N baje" / "N:MM baje" (Hindi/Hinglish clock time)
  // e.g., "8 baje", "shaam 8 baje", "subah 8 baje", "raat ko 8 baje", "shaam ko 8 baje", "kal 8 baje", "8:30 baje"
  const bajeMatch = text.match(/(?:(kal|tomorrow|aaj|today)\s+)?(?:(subah|morning|shaam|evening|raat|night|dopahar|afternoon)(?:\s+(?:ko|ke|me|mein))?\s+)?(\d{1,2})(?::(\d{2}))?\s*baje(?:\s*(?:(?:ko|ke|me|mein)\s*)?(subah|morning|shaam|evening|raat|night|dopahar|afternoon))?/i);
  if (bajeMatch) {
    const isTomorrow = (!!bajeMatch[1] && /\b(?:kal|tomorrow)\b/i.test(bajeMatch[1])) || /\b(?:kal|tomorrow)\b/i.test(text);
    let period = (bajeMatch[2] || bajeMatch[5] || '').toLowerCase();
    let hours = parseInt(bajeMatch[3], 10);
    const minutes = bajeMatch[4] ? parseInt(bajeMatch[4], 10) : 0;

    // If period wasn't immediately adjacent to "baje", check the wider sentence context
    if (!period) {
      if (/\b(?:shaam|evening|raat|night|tonight)\b/i.test(text)) {
        period = 'shaam';
      } else if (/\b(?:dopahar|afternoon)\b/i.test(text)) {
        period = 'dopahar';
      } else if (/\b(?:subah|morning)\b/i.test(text)) {
        period = 'subah';
      }
    }

    if ((period.includes('shaam') || period.includes('evening') || period.includes('raat') || period.includes('night')) && hours < 12) {
      hours += 12;
    } else if ((period.includes('dopahar') || period.includes('afternoon')) && hours < 12 && hours !== 12) {
      hours += 12;
    } else if ((period.includes('subah') || period.includes('morning')) && hours === 12) {
      hours = 0;
    }

    const target = new Date(now.getTime());
    if (isTomorrow) {
      target.setDate(target.getDate() + 1);
    }
    target.setHours(hours, minutes, 0, 0);

    // If target hour has already passed today, rollover to tomorrow
    if (!isTomorrow && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return { date: target, armed: true, rawCue: bajeMatch[0].trim() };
  }

  // 4. Absolute clock time: "arriving by 5 PM", "today by 8 PM", "departing tomorrow at 08:30 AM", "at 19:40"
  const clockMatch = text.match(/(?:by|at|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  const isTomorrow = /\b(?:tomorrow|kal)\b/i.test(text);

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

  // 5. Calendar date: "20-Sep-2026", "20-Sep", "Sep 20", "20 September", "25th September", "September 25th"
  const calMatch = text.match(
    /\b(?:(\d{1,2})(?:st|nd|rd|th)?[-/ ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/ ](\d{1,2})(?:st|nd|rd|th)?)[-/ ]?(\d{4})?\b/i
  );
  if (calMatch) {
    const dayStr = calMatch[1] || calMatch[4];
    const monthStr = calMatch[2] || calMatch[3];
    const day = parseInt(dayStr, 10);
    const month = MONTHS_MAP[monthStr.toLowerCase().slice(0, 3)];
    const year = calMatch[5] ? parseInt(calMatch[5], 10) : now.getFullYear();

    const target = new Date(year, month, day, 9, 0, 0, 0); // Standard 09:00 morning alarm
    
    // If year omitted and date is >30 days in the past, roll forward to next year
    if (!calMatch[5] && target.getTime() < now.getTime() - 30 * 86400000) {
      target.setFullYear(year + 1);
    }
    
    // Fix past-date trap: if it evaluates to today at 09:00 but that time has already passed
    if (target.getFullYear() === now.getFullYear() && 
        target.getMonth() === now.getMonth() && 
        target.getDate() === now.getDate() && 
        target.getTime() <= now.getTime()) {
      target.setHours(19, 0, 0, 0); // Bump to this evening
      if (now.getTime() >= target.getTime()) {
        target.setTime(now.getTime() + 60 * 60 * 1000); // Or +1 hour if evening has passed
        target.setSeconds(0, 0);
      }
    }
    
    return { date: target, armed: true, rawCue: calMatch[0].trim() };
  }

  // 6. Conversational Hinglish & English Relative Day/Period Cues
  // 6A. "kal subah" / "tomorrow morning" -> 09:00 tomorrow
  if (/\b(?:kal\s+subah|tomorrow\s+morning)\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return { date: target, armed: true, rawCue: 'tomorrow morning' };
  }

  // 6B. "kal shaam" / "tomorrow evening" -> 19:00 tomorrow
  if (/\b(?:kal\s+shaam|tomorrow\s+evening)\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(19, 0, 0, 0);
    return { date: target, armed: true, rawCue: 'tomorrow evening' };
  }

  // 6C. "kal raat" / "tomorrow night" -> 21:00 tomorrow
  if (/\b(?:kal\s+raat|tomorrow\s+night)\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(21, 0, 0, 0);
    return { date: target, armed: true, rawCue: 'tomorrow night' };
  }

  // 6D. "aate waqt" / "while coming" -> 18:30 today (or +2 hours if past 18:30)
  const aateWaqtMatch = text.match(/\b(?:aate\s+(?:waqt|hue|huye|time)|(?:while|when)\s+coming(?:\s+back|\s+home)?|on\s+the\s+way\s+(?:home|back)|wapas\s+aate\s+waqt)\b/i);
  if (aateWaqtMatch) {
    const target = new Date(now.getTime());
    target.setHours(18, 30, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 2 * 3600 * 1000);
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: aateWaqtMatch[0].trim() };
  }

  // 6E. "tonight" / "raat ko" -> 21:00 today
  const tonightMatch = text.match(/\b(?:tonight|raat\s+(?:ko|me|mein)?|aaj\s+raat)\b/i);
  if (tonightMatch && !/\bmidnight\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(21, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 60 * 60 * 1000);
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: tonightMatch[0].trim() };
  }

  // 6F. "shaam ko" / "this evening" -> 19:00 today (or +1h if already past 19:00)
  const eveningMatch = text.match(/\b(?:shaam\s+(?:ko|me|mein)?|this\s+evening|in\s+the\s+evening|aaj\s+shaam)\b/i);
  if (eveningMatch) {
    const target = new Date(now.getTime());
    target.setHours(19, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 60 * 60 * 1000);
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: eveningMatch[0].trim() };
  }

  // 7. General "tomorrow" / "kal"
  if (isTomorrow) {
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return { date: target, armed: true, rawCue: 'tomorrow' };
  }

  // 8. "midnight"
  if (/\bmidnight\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(23, 59, 0, 0);
    return { date: target, armed: true, rawCue: 'midnight' };
  }

  // 9. Generic delivery or logistics alert without explicit time -> Defaults to 19:00:00 today (or +1h if evening)
  if (/\b(?:out for delivery|in transit|order shipped|package shipped|dispatched|arriving today|delivered|ready for pickup|pickup ready|parcel ready)\b/i.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(19, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 60 * 60 * 1000); // +1 hour if already evening
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: 'out for delivery' };
  }

  // 10. Generic errand with no explicit time -> defaults to today 19:00 with armed: true
  if (isErrand || ERRAND_KEYWORDS.test(text)) {
    const target = new Date(now.getTime());
    target.setHours(19, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setTime(now.getTime() + 60 * 60 * 1000); // +1 hour if already evening
      target.setSeconds(0, 0);
    }
    return { date: target, armed: true, rawCue: 'errand' };
  }

  // 11. Fallback: unarmed generic to-do (24h default)
  const fallback = new Date(now.getTime() + 24 * 3600 * 1000);
  fallback.setSeconds(0, 0);
  return { date: fallback, armed: false, rawCue: null };
}
