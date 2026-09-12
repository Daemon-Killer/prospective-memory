/**
 * Remy Reminders - Snooze Calculation Engine Unit Tests
 * 100% Statement, Branch, Function, and Line Coverage Suite
 */

import {
  getBaseTime,
  normalizeSeconds,
  calculate15Minutes,
  calculate1Hour,
  calculateThisEvening,
  calculateTomorrowMorning,
  calculateWeekend,
  calculateNextWeek,
  calculateCustomInterval,
  calculateSnoozeTime,
} from '../src/utils/snoozeCalculator';

describe('snoozeCalculator', () => {
  // Fixed reference times for deterministic tests
  const MOCK_NOW = new Date('2026-09-10T14:02:47.321Z');

  describe('normalizeSeconds', () => {
    it('truncates seconds and milliseconds to 00', () => {
      const normalized = normalizeSeconds(MOCK_NOW);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
      expect(normalized.getMinutes()).toBe(MOCK_NOW.getMinutes());
      expect(normalized.getHours()).toBe(MOCK_NOW.getHours());
    });
  });

  describe('getBaseTime (Invariant: T_base = max(T_now, T_due))', () => {
    it('returns now when dueDate is undefined', () => {
      const base = getBaseTime(MOCK_NOW, undefined);
      expect(base.getTime()).toBe(MOCK_NOW.getTime());
    });

    it('returns now when dueDate is null', () => {
      const base = getBaseTime(MOCK_NOW, null);
      expect(base.getTime()).toBe(MOCK_NOW.getTime());
    });

    it('returns now when dueDate is an invalid string', () => {
      const base = getBaseTime(MOCK_NOW, 'invalid-date-string');
      expect(base.getTime()).toBe(MOCK_NOW.getTime());
    });

    it('returns now when dueDate is in the past (overdue reminder)', () => {
      const pastDue = new Date('2026-09-10T10:00:00.000Z');
      const base = getBaseTime(MOCK_NOW, pastDue);
      expect(base.getTime()).toBe(MOCK_NOW.getTime());
    });

    it('returns now when dueDate is equal to now', () => {
      const base = getBaseTime(MOCK_NOW, new Date(MOCK_NOW.getTime()));
      expect(base.getTime()).toBe(MOCK_NOW.getTime());
    });

    it('returns dueDate when dueDate is in the future as Date object', () => {
      const futureDue = new Date('2026-09-10T16:00:00.000Z');
      const base = getBaseTime(MOCK_NOW, futureDue);
      expect(base.getTime()).toBe(futureDue.getTime());
    });

    it('returns dueDate when dueDate is in the future as ISO string', () => {
      const futureDueStr = '2026-09-10T18:30:00.000Z';
      const base = getBaseTime(MOCK_NOW, futureDueStr);
      expect(base.getTime()).toBe(new Date(futureDueStr).getTime());
    });
  });

  describe('+15m Calculation', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculate15Minutes();
      expect(target.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('adds 15 minutes to now when reminder is overdue', () => {
      const pastDue = new Date('2026-09-10T12:00:00.000Z');
      const target = calculate15Minutes(MOCK_NOW, pastDue);

      // MOCK_NOW is 14:02:47 -> 14:17:00
      expect(target.toISOString()).toBe('2026-09-10T14:17:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('adds 15 minutes to future dueDate when reminder is not overdue', () => {
      const futureDue = new Date('2026-09-10T16:30:00.000Z');
      const target = calculate15Minutes(MOCK_NOW, futureDue);

      expect(target.toISOString()).toBe('2026-09-10T16:45:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('correctly handles hour and day rollover on +15m', () => {
      const nearMidnight = new Date('2026-09-10T23:50:30.000Z');
      const target = calculate15Minutes(nearMidnight);

      expect(target.toISOString()).toBe('2026-09-11T00:05:00.000Z');
    });
  });

  describe('+1h Calculation', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculate1Hour();
      expect(target.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('adds 1 hour to now when reminder is overdue', () => {
      const pastDue = new Date('2026-09-10T09:00:00.000Z');
      const target = calculate1Hour(MOCK_NOW, pastDue);

      // MOCK_NOW is 14:02:47 -> 15:02:00
      expect(target.toISOString()).toBe('2026-09-10T15:02:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('adds 1 hour to future dueDate when reminder is not overdue', () => {
      const futureDue = new Date('2026-09-10T20:15:00.000Z');
      const target = calculate1Hour(MOCK_NOW, futureDue);

      expect(target.toISOString()).toBe('2026-09-10T21:15:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('correctly rolls over midnight on +1h', () => {
      const lateNight = new Date('2026-09-10T23:30:15.000Z');
      const target = calculate1Hour(lateNight);

      expect(target.toISOString()).toBe('2026-09-11T00:30:00.000Z');
    });
  });

  describe('This Evening Calculation (19:00 with >18:30 rollover)', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculateThisEvening();
      expect(target.getHours()).toBe(19);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('schedules for today at 19:00 when now is afternoon (14:00)', () => {
      const afternoon = new Date(2026, 8, 10, 14, 0, 0); // 2026-09-10 local
      const target = calculateThisEvening(afternoon);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(8);
      expect(target.getDate()).toBe(10);
      expect(target.getHours()).toBe(19);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('schedules for today at 19:00 when now is 18:29:59 (before 18:30 boundary)', () => {
      const justBeforeBoundary = new Date(2026, 8, 10, 18, 29, 59);
      const target = calculateThisEvening(justBeforeBoundary);

      expect(target.getDate()).toBe(10);
      expect(target.getHours()).toBe(19);
    });

    it('rolls over to tomorrow 19:00 when now is exactly 18:30:00', () => {
      const exactlyAtBoundary = new Date(2026, 8, 10, 18, 30, 0);
      const target = calculateThisEvening(exactlyAtBoundary);

      expect(target.getDate()).toBe(11);
      expect(target.getHours()).toBe(19);
    });

    it('rolls over to tomorrow 19:00 when now is past 18:30 (e.g. 21:15)', () => {
      const lateEvening = new Date(2026, 8, 10, 21, 15, 0);
      const target = calculateThisEvening(lateEvening);

      expect(target.getDate()).toBe(11);
      expect(target.getHours()).toBe(19);
    });

    it('handles month-end boundary rollover (Jan 31 20:00 -> Feb 1 19:00)', () => {
      const monthEnd = new Date(2026, 0, 31, 20, 0, 0);
      const target = calculateThisEvening(monthEnd);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(1); // February
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(19);
    });

    it('handles leap-year rollover (Feb 28 20:00 in 2024 -> Feb 29 19:00)', () => {
      const leapYearFeb28 = new Date(2024, 1, 28, 20, 0, 0);
      const target = calculateThisEvening(leapYearFeb28);

      expect(target.getFullYear()).toBe(2024);
      expect(target.getMonth()).toBe(1); // Feb
      expect(target.getDate()).toBe(29); // Leap day
      expect(target.getHours()).toBe(19);
    });

    it('handles non-leap-year rollover (Feb 28 20:00 in 2023 -> Mar 1 19:00)', () => {
      const nonLeapYearFeb28 = new Date(2023, 1, 28, 20, 0, 0);
      const target = calculateThisEvening(nonLeapYearFeb28);

      expect(target.getFullYear()).toBe(2023);
      expect(target.getMonth()).toBe(2); // March
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(19);
    });

    it('handles year-end rollover (Dec 31 20:00 -> Jan 1 next year 19:00)', () => {
      const newYearsEve = new Date(2026, 11, 31, 20, 0, 0);
      const target = calculateThisEvening(newYearsEve);

      expect(target.getFullYear()).toBe(2027);
      expect(target.getMonth()).toBe(0); // Jan
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(19);
    });
  });

  describe('Tomorrow Morning Calculation (09:00 with month/leap-year handling)', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculateTomorrowMorning();
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('schedules for next day at 09:00 on standard date', () => {
      const date = new Date(2026, 8, 10, 15, 30, 0); // Sept 10
      const target = calculateTomorrowMorning(date);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(8);
      expect(target.getDate()).toBe(11); // Sept 11
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    });

    it('handles 30-day month boundary (April 30 -> May 1 09:00)', () => {
      const endOfApril = new Date(2026, 3, 30, 22, 0, 0);
      const target = calculateTomorrowMorning(endOfApril);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(4); // May
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });

    it('handles 31-day month boundary (July 31 -> August 1 09:00)', () => {
      const endOfJuly = new Date(2026, 6, 31, 10, 0, 0);
      const target = calculateTomorrowMorning(endOfJuly);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(7); // August
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });

    it('handles leap year transition on Feb 28 (Feb 28 2024 -> Feb 29 09:00)', () => {
      const leapFeb28 = new Date(2024, 1, 28, 8, 0, 0);
      const target = calculateTomorrowMorning(leapFeb28);

      expect(target.getFullYear()).toBe(2024);
      expect(target.getMonth()).toBe(1); // Feb
      expect(target.getDate()).toBe(29);
      expect(target.getHours()).toBe(9);
    });

    it('handles leap year transition on Feb 29 (Feb 29 2024 -> Mar 1 09:00)', () => {
      const leapFeb29 = new Date(2024, 1, 29, 12, 0, 0);
      const target = calculateTomorrowMorning(leapFeb29);

      expect(target.getFullYear()).toBe(2024);
      expect(target.getMonth()).toBe(2); // March
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });

    it('handles non-leap year transition on Feb 28 (Feb 28 2023 -> Mar 1 09:00)', () => {
      const nonLeapFeb28 = new Date(2023, 1, 28, 12, 0, 0);
      const target = calculateTomorrowMorning(nonLeapFeb28);

      expect(target.getFullYear()).toBe(2023);
      expect(target.getMonth()).toBe(2); // March
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });

    it('handles year-end transition (Dec 31 2026 -> Jan 1 2027 09:00)', () => {
      const dec31 = new Date(2026, 11, 31, 23, 59, 0);
      const target = calculateTomorrowMorning(dec31);

      expect(target.getFullYear()).toBe(2027);
      expect(target.getMonth()).toBe(0); // January
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });
  });

  describe('This Weekend Calculation (Saturday 09:00)', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculateWeekend();
      expect(target.getDay()).toBe(6); // Saturday
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    });

    it('schedules for upcoming Saturday when called on Sunday (day 0)', () => {
      // 2026-09-06 is Sunday
      const sunday = new Date(2026, 8, 6, 12, 0, 0);
      const target = calculateWeekend(sunday);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(12); // Sept 12 is Saturday
      expect(target.getHours()).toBe(9);
    });

    it('schedules for upcoming Saturday when called on Wednesday (day 3)', () => {
      // 2026-09-09 is Wednesday
      const wednesday = new Date(2026, 8, 9, 14, 0, 0);
      const target = calculateWeekend(wednesday);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(12);
      expect(target.getHours()).toBe(9);
    });

    it('schedules for upcoming Saturday when called on Friday (day 5)', () => {
      // 2026-09-11 is Friday
      const friday = new Date(2026, 8, 11, 16, 0, 0);
      const target = calculateWeekend(friday);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(12);
      expect(target.getHours()).toBe(9);
    });

    it('schedules for TODAY Saturday at 09:00 when called on Saturday BEFORE 09:00', () => {
      // 2026-09-12 is Saturday, 08:15
      const saturdayMorning = new Date(2026, 8, 12, 8, 15, 0);
      const target = calculateWeekend(saturdayMorning);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(12); // Same day
      expect(target.getHours()).toBe(9);
    });

    it('rolls over 7 days to NEXT Saturday when called on Saturday AT 09:00', () => {
      // 2026-09-12 is Saturday, exactly 09:00
      const saturdayNine = new Date(2026, 8, 12, 9, 0, 0);
      const target = calculateWeekend(saturdayNine);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(19); // Next Saturday
      expect(target.getHours()).toBe(9);
    });

    it('rolls over 7 days to NEXT Saturday when called on Saturday AFTER 09:00', () => {
      // 2026-09-12 is Saturday, 15:30
      const saturdayAfternoon = new Date(2026, 8, 12, 15, 30, 0);
      const target = calculateWeekend(saturdayAfternoon);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(19);
      expect(target.getHours()).toBe(9);
    });
  });

  describe('Next Week Calculation (Monday 09:00)', () => {
    it('defaults to current system time when now is omitted', () => {
      const target = calculateNextWeek();
      expect(target.getDay()).toBe(1); // Monday
      expect(target.getHours()).toBe(9);
    });

    it('schedules for today at 09:00 when called on Monday before 09:00', () => {
      // 2026-09-07 is Monday, 07:45
      const mondayEarly = new Date(2026, 8, 7, 7, 45, 0);
      const target = calculateNextWeek(mondayEarly);

      expect(target.getDay()).toBe(1);
      expect(target.getDate()).toBe(7);
      expect(target.getHours()).toBe(9);
    });

    it('rolls to next Monday when called on Monday after 09:00', () => {
      // 2026-09-07 is Monday, 11:00
      const mondayLate = new Date(2026, 8, 7, 11, 0, 0);
      const target = calculateNextWeek(mondayLate);

      expect(target.getDay()).toBe(1);
      expect(target.getDate()).toBe(14); // Next Monday
      expect(target.getHours()).toBe(9);
    });

    it('schedules for next Monday when called on Thursday', () => {
      // 2026-09-10 is Thursday
      const thursday = new Date(2026, 8, 10, 12, 0, 0);
      const target = calculateNextWeek(thursday);

      expect(target.getDay()).toBe(1);
      expect(target.getDate()).toBe(14);
      expect(target.getHours()).toBe(9);
    });
  });

  describe('Custom Interval Calculation & Validation', () => {
    it('adds minutes correctly to now when no dueDate given', () => {
      const target = calculateCustomInterval({ value: 45, unit: 'minutes' }, MOCK_NOW);

      // MOCK_NOW is 14:02:47 -> 14:47:00
      expect(target.toISOString()).toBe('2026-09-10T14:47:00.000Z');
      expect(target.getSeconds()).toBe(0);
      expect(target.getMilliseconds()).toBe(0);
    });

    it('adds hours correctly to now', () => {
      const target = calculateCustomInterval({ value: 3, unit: 'hours' }, MOCK_NOW);

      // MOCK_NOW is 14:02:47 -> 17:02:00
      expect(target.toISOString()).toBe('2026-09-10T17:02:00.000Z');
      expect(target.getSeconds()).toBe(0);
    });

    it('adds days correctly to now', () => {
      const target = calculateCustomInterval({ value: 2, unit: 'days' }, MOCK_NOW);

      // MOCK_NOW is 2026-09-10 -> 2026-09-12
      expect(target.toISOString()).toBe('2026-09-12T14:02:00.000Z');
      expect(target.getSeconds()).toBe(0);
    });

    it('uses future dueDate as T_base', () => {
      const futureDue = new Date('2026-09-10T18:00:00.000Z');
      const target = calculateCustomInterval(
        { value: 30, unit: 'minutes' },
        MOCK_NOW,
        futureDue
      );

      expect(target.toISOString()).toBe('2026-09-10T18:30:00.000Z');
    });

    it('throws error when interval value is zero', () => {
      expect(() => {
        calculateCustomInterval({ value: 0, unit: 'minutes' }, MOCK_NOW);
      }).toThrow('Invalid custom interval value: value must be a positive number');
    });

    it('throws error when interval value is negative', () => {
      expect(() => {
        calculateCustomInterval({ value: -10, unit: 'minutes' }, MOCK_NOW);
      }).toThrow('Invalid custom interval value: value must be a positive number');
    });

    it('throws error when interval value is NaN', () => {
      expect(() => {
        calculateCustomInterval({ value: NaN, unit: 'minutes' }, MOCK_NOW);
      }).toThrow('Invalid custom interval value: value must be a positive number');
    });

    it('throws error when interval is undefined', () => {
      expect(() => {
        calculateCustomInterval(null as any, MOCK_NOW);
      }).toThrow('Invalid custom interval value: value must be a positive number');
    });

    it('throws error on unsupported unit', () => {
      expect(() => {
        calculateCustomInterval({ value: 5, unit: 'weeks' as any }, MOCK_NOW);
      }).toThrow('Invalid custom interval unit: unit must be minutes, hours, or days');
    });

    it('defaults now to current time if omitted', () => {
      const target = calculateCustomInterval({ value: 10, unit: 'minutes' });
      expect(target.getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    });
  });

  describe('calculateSnoozeTime Unified Dispatcher', () => {
    it('dispatches preset 15m', () => {
      const target = calculateSnoozeTime('15m', { now: MOCK_NOW });
      expect(target.toISOString()).toBe('2026-09-10T14:17:00.000Z');
    });

    it('dispatches preset 1h', () => {
      const target = calculateSnoozeTime('1h', { now: MOCK_NOW });
      expect(target.toISOString()).toBe('2026-09-10T15:02:00.000Z');
    });

    it('dispatches preset evening', () => {
      const afternoon = new Date(2026, 8, 10, 14, 0, 0);
      const target = calculateSnoozeTime('evening', { now: afternoon });
      expect(target.getHours()).toBe(19);
      expect(target.getDate()).toBe(10);
    });

    it('dispatches preset tomorrow_morning', () => {
      const date = new Date(2026, 8, 10, 14, 0, 0);
      const target = calculateSnoozeTime('tomorrow_morning', { now: date });
      expect(target.getDate()).toBe(11);
      expect(target.getHours()).toBe(9);
    });

    it('dispatches preset weekend', () => {
      const friday = new Date(2026, 8, 11, 14, 0, 0);
      const target = calculateSnoozeTime('weekend', { now: friday });
      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(12);
      expect(target.getHours()).toBe(9);
    });

    it('dispatches preset custom with customInterval', () => {
      const target = calculateSnoozeTime('custom', {
        now: MOCK_NOW,
        customInterval: { value: 20, unit: 'minutes' },
      });
      expect(target.toISOString()).toBe('2026-09-10T14:22:00.000Z');
    });

    it('dispatches preset custom with valid future customDate as Date object', () => {
      const futureDate = new Date('2026-09-10T19:45:12.000Z');
      const target = calculateSnoozeTime('custom', {
        now: MOCK_NOW,
        customDate: futureDate,
      });

      expect(target.toISOString()).toBe('2026-09-10T19:45:00.000Z');
      expect(target.getSeconds()).toBe(0);
    });

    it('dispatches preset custom with valid future customDate as ISO string', () => {
      const futureIso = '2026-09-10T20:00:00.000Z';
      const target = calculateSnoozeTime('custom', {
        now: MOCK_NOW,
        customDate: futureIso,
      });

      expect(target.toISOString()).toBe('2026-09-10T20:00:00.000Z');
    });

    it('throws error when customDate is in the past', () => {
      const pastDate = new Date('2026-09-10T12:00:00.000Z');
      expect(() => {
        calculateSnoozeTime('custom', { now: MOCK_NOW, customDate: pastDate });
      }).toThrow('Snooze target time must be strictly in the future');
    });

    it('throws error when customDate is an invalid string', () => {
      expect(() => {
        calculateSnoozeTime('custom', { now: MOCK_NOW, customDate: 'not-a-date' });
      }).toThrow('Invalid custom date provided');
    });

    it('throws error when custom preset has neither customInterval nor customDate', () => {
      expect(() => {
        calculateSnoozeTime('custom', { now: MOCK_NOW });
      }).toThrow(
        'Custom snooze preset requires either customInterval or customDate option'
      );
    });

    it('throws error on unsupported preset', () => {
      expect(() => {
        calculateSnoozeTime('unsupported_preset' as any, { now: MOCK_NOW });
      }).toThrow('Unsupported snooze preset: unsupported_preset');
    });
  });
});
