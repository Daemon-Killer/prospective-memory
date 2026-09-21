/**
 * Remy Reminders - Snooze Calculation Engine
 * Enforces T_base = max(T_now, T_due), 00s clock truncation,
 * leap-year/month rollover, and strict temporal invariants.
 */

import {
  CustomIntervalInput,
  SnoozeCalculationOptions,
  SnoozePreset,
} from '../types/reminder';

/**
 * Calculates the baseline reference time for snooze calculations:
 * T_base = max(T_now, T_due)
 *
 * If dueDate is absent or invalid, T_base defaults to now.
 */
export function getBaseTime(now: Date, dueDate?: Date | string | null): Date {
  if (!dueDate) {
    return new Date(now.getTime());
  }

  const parsedDue = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  if (isNaN(parsedDue.getTime())) {
    return new Date(now.getTime());
  }

  return parsedDue.getTime() > now.getTime()
    ? new Date(parsedDue.getTime())
    : new Date(now.getTime());
}

/**
 * Truncates seconds and milliseconds to 00 for clean clock alignment.
 */
export function normalizeSeconds(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setSeconds(0, 0);
  return normalized;
}

/**
 * Preset: +15 minutes
 * Adds 15 minutes to T_base with seconds truncated to 00.
 */
export function calculate15Minutes(
  now: Date = new Date(),
  dueDate?: Date | string | null
): Date {
  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime() + 15 * 60 * 1000);
  target.setSeconds(0, 0);
  return target;
}

/**
 * Preset: +1 hour
 * Adds 60 minutes to T_base with seconds truncated to 00.
 */
export function calculate1Hour(
  now: Date = new Date(),
  dueDate?: Date | string | null
): Date {
  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime() + 60 * 60 * 1000);
  target.setSeconds(0, 0);
  return target;
}

/**
 * Preset: This Evening
 * Targets 19:00:00 local time today.
 * If current time is already >= 18:30:00 (within 30m or past 19:00),
 * rolls over to tomorrow at 19:00:00.
 */
export function calculateThisEvening(now: Date = new Date(), dueDate?: Date | string | null): Date {
  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime());
  target.setHours(19, 0, 0, 0);

  // Rollover threshold: 18:30:00.000 today
  const rolloverThreshold = new Date(base.getTime());
  rolloverThreshold.setHours(18, 30, 0, 0);

  if (base.getTime() >= rolloverThreshold.getTime()) {
    target.setDate(target.getDate() + 1);
    target.setHours(19, 0, 0, 0);
  }

  return target;
}

/**
 * Preset: Tomorrow Morning
 * Advances calendar to the next day at 09:00:00 local time.
 * Native Date.setDate handles month boundaries, leap years, and year-ends.
 */
export function calculateTomorrowMorning(now: Date = new Date(), dueDate?: Date | string | null): Date {
  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime());
  target.setDate(target.getDate() + 1);
  target.setHours(9, 0, 0, 0);
  return target;
}

/**
 * Preset: This Weekend
 * Advances to upcoming Saturday at 09:00:00 local time.
 * - Sunday through Friday: advances to upcoming Saturday.
 * - Saturday before 09:00: schedules for today Saturday at 09:00.
 * - Saturday at or after 09:00: advances 7 days to next Saturday at 09:00.
 */
export function calculateWeekend(now: Date = new Date(), dueDate?: Date | string | null): Date {
  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime());
  const dayOfWeek = target.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  if (dayOfWeek === 6) {
    const saturdayNineAm = new Date(base.getTime());
    saturdayNineAm.setHours(9, 0, 0, 0);

    if (base.getTime() < saturdayNineAm.getTime()) {
      return saturdayNineAm;
    } else {
      saturdayNineAm.setDate(saturdayNineAm.getDate() + 7);
      return saturdayNineAm;
    }
  }

  const daysUntilSaturday = 6 - dayOfWeek;
  target.setDate(target.getDate() + daysUntilSaturday);
  target.setHours(9, 0, 0, 0);
  return target;
}

/**
 * Helper: Next Week (Monday 09:00)
 * Advances to upcoming Monday at 09:00:00 local time.
 */
export function calculateNextWeek(now: Date = new Date()): Date {
  const target = new Date(now.getTime());
  const dayOfWeek = target.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  if (dayOfWeek === 1) {
    const mondayNineAm = new Date(now.getTime());
    mondayNineAm.setHours(9, 0, 0, 0);
    if (now.getTime() < mondayNineAm.getTime()) {
      return mondayNineAm;
    } else {
      mondayNineAm.setDate(mondayNineAm.getDate() + 7);
      return mondayNineAm;
    }
  }

  const daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  const daysToAdd = daysUntilMonday === 0 ? 7 : daysUntilMonday;
  target.setDate(target.getDate() + daysToAdd);
  target.setHours(9, 0, 0, 0);
  return target;
}

/**
 * Preset: Custom Interval
 * Calculates T_base + (N * unit) and validates T_target > T_now.
 */
export function calculateCustomInterval(
  interval: CustomIntervalInput,
  now: Date = new Date(),
  dueDate?: Date | string | null
): Date {
  if (
    !interval ||
    typeof interval.value !== 'number' ||
    isNaN(interval.value) ||
    !isFinite(interval.value) ||
    interval.value <= 0
  ) {
    throw new Error('Invalid custom interval value: value must be a positive number');
  }

  if (!['minutes', 'hours', 'days'].includes(interval.unit)) {
    throw new Error('Invalid custom interval unit: unit must be minutes, hours, or days');
  }

  let offsetMs = 0;
  switch (interval.unit) {
    case 'minutes':
      offsetMs = interval.value * 60 * 1000;
      break;
    case 'hours':
      offsetMs = interval.value * 3600 * 1000;
      break;
    case 'days':
      offsetMs = interval.value * 86400 * 1000;
      break;
  }

  const base = getBaseTime(now, dueDate);
  const target = new Date(base.getTime() + offsetMs);
  target.setSeconds(0, 0);

  if (target.getTime() <= now.getTime()) {
    throw new Error('Snooze target time must be strictly in the future');
  }

  return target;
}

/**
 * Unified Dispatcher: calculateSnoozeTime
 * Routes preset strings to appropriate calculation algorithms.
 */
export function calculateSnoozeTime(
  preset: SnoozePreset,
  options: SnoozeCalculationOptions = {}
): Date {
  const now = options.now ?? new Date();

  switch (preset) {
    case '15m':
      return calculate15Minutes(now, options.dueDate);

    case '1h':
      return calculate1Hour(now, options.dueDate);

    case 'evening':
      return calculateThisEvening(now, options.dueDate);

    case 'tomorrow_morning':
      return calculateTomorrowMorning(now, options.dueDate);

    case 'weekend':
      return calculateWeekend(now, options.dueDate);

    case 'custom': {
      if (options.customDate) {
        const custom =
          typeof options.customDate === 'string'
            ? new Date(options.customDate)
            : options.customDate;

        if (isNaN(custom.getTime())) {
          throw new Error('Invalid custom date provided');
        }

        const normalized = new Date(custom.getTime());
        normalized.setSeconds(0, 0);

        if (normalized.getTime() <= now.getTime()) {
          throw new Error('Snooze target time must be strictly in the future');
        }

        return normalized;
      }

      if (options.customInterval) {
        return calculateCustomInterval(options.customInterval, now, options.dueDate);
      }

      throw new Error(
        'Custom snooze preset requires either customInterval or customDate option'
      );
    }

    default:
      throw new Error(`Unsupported snooze preset: ${preset as string}`);
  }
}
