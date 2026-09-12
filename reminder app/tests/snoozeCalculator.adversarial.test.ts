/**
 * Remy Reminders - Snooze Calculation Engine Adversarial Challenge Suite
 *
 * Empirical stress-testing of src/utils/snoozeCalculator.ts across:
 * - Property-based invariants (Strict Monotonic Future, Clock Alignment, Overdue Immunity, Non-Mutation)
 * - Extreme Date & Boundary Fuzzing (Epoch, Year 2038, Year 9999, Month-ends, Year-ends)
 * - Leap Year & Leap Day (Feb 29 transitions, 2024, 2028, Century 2000 vs 2100)
 * - Daylight Saving Time (DST) Transitions (Spring Forward, Fall Back across global zones)
 * - Rapid Successive Snoozing (Accumulator chaining, 100x consecutive snoozes)
 * - Past-Due Boundaries (-1ms, 0ms, +1ms, 10 years overdue)
 * - Malformed & Adversarial Inputs (Negative numbers, NaN, Infinity, bad units, past custom dates)
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
import { SnoozePreset } from '../src/types/reminder';

describe('snoozeCalculator Empirical Adversarial Challenge', () => {
  // ---------------------------------------------------------------------------
  // 1. PROPERTY-BASED INVARIANTS & MONTE CARLO FUZZING
  // ---------------------------------------------------------------------------
  describe('Property-Based Invariants & Monte Carlo Fuzzing', () => {
    it('INVARIANT 1: Strict Monotonic Future (T_target > T_now) across 1,000 randomized timestamps', () => {
      // Generate 1000 random timestamps between 2020 and 2040
      const startMs = new Date('2020-01-01T00:00:00.000Z').getTime();
      const endMs = new Date('2040-01-01T00:00:00.000Z').getTime();
      const presets: SnoozePreset[] = ['15m', '1h', 'evening', 'tomorrow_morning', 'weekend'];

      for (let i = 0; i < 1000; i++) {
        const randomMs = Math.floor(startMs + Math.random() * (endMs - startMs));
        const now = new Date(randomMs);

        // Test random presets
        for (const preset of presets) {
          const target = calculateSnoozeTime(preset, { now });
          expect(target.getTime()).toBeGreaterThan(now.getTime());
        }

        // Test custom intervals (valid positive values)
        const randomMinutes = Math.floor(Math.random() * 120) + 1; // 1 to 120 minutes
        const customTarget = calculateCustomInterval({ value: randomMinutes, unit: 'minutes' }, now);
        expect(customTarget.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    it('INVARIANT 2: Clock Alignment (Seconds & Milliseconds MUST be 00.000)', () => {
      const startMs = new Date('2025-01-01T00:00:00.000Z').getTime();
      const endMs = new Date('2028-01-01T00:00:00.000Z').getTime();
      const presets: SnoozePreset[] = ['15m', '1h', 'evening', 'tomorrow_morning', 'weekend'];

      for (let i = 0; i < 500; i++) {
        const randomMs = Math.floor(startMs + Math.random() * (endMs - startMs));
        const now = new Date(randomMs);

        for (const preset of presets) {
          const target = calculateSnoozeTime(preset, { now });
          expect(target.getSeconds()).toBe(0);
          expect(target.getMilliseconds()).toBe(0);
        }
      }
    });

    it('INVARIANT 3: Non-Mutation of Input Date Objects', () => {
      const now = new Date('2026-09-10T14:32:45.678Z');
      const due = new Date('2026-09-10T15:00:00.000Z');
      const nowOriginal = now.getTime();
      const dueOriginal = due.getTime();

      calculate15Minutes(now, due);
      calculate1Hour(now, due);
      calculateThisEvening(now);
      calculateTomorrowMorning(now);
      calculateWeekend(now);
      calculateNextWeek(now);
      calculateCustomInterval({ value: 30, unit: 'minutes' }, now, due);
      calculateSnoozeTime('custom', { now, customDate: due });

      expect(now.getTime()).toBe(nowOriginal);
      expect(due.getTime()).toBe(dueOriginal);
    });

    it('INVARIANT 4: Overdue Invariance (T_due <= T_now produces identical target as T_due=undefined)', () => {
      const now = new Date('2026-09-10T14:00:00.000Z');
      const pastDates = [
        new Date('2026-09-10T13:59:59.999Z'),
        new Date('2026-09-10T12:00:00.000Z'),
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2020-01-01T00:00:00.000Z'),
        new Date(now.getTime()), // T_due == T_now
      ];

      const expected15m = calculate15Minutes(now, undefined).getTime();
      const expected1h = calculate1Hour(now, undefined).getTime();
      const expectedCustom = calculateCustomInterval({ value: 45, unit: 'minutes' }, now, undefined).getTime();

      for (const pastDue of pastDates) {
        expect(calculate15Minutes(now, pastDue).getTime()).toBe(expected15m);
        expect(calculate1Hour(now, pastDue).getTime()).toBe(expected1h);
        expect(calculateCustomInterval({ value: 45, unit: 'minutes' }, now, pastDue).getTime()).toBe(expectedCustom);
      }
    });

    it('INVARIANT 5: Determinism & Purity (Calling twice with identical arguments produces identical results)', () => {
      const now = new Date('2026-09-10T14:15:30.123Z');
      const due = new Date('2026-09-10T16:00:00.000Z');

      expect(calculate15Minutes(now, due).getTime()).toBe(calculate15Minutes(now, due).getTime());
      expect(calculate1Hour(now, due).getTime()).toBe(calculate1Hour(now, due).getTime());
      expect(calculateThisEvening(now).getTime()).toBe(calculateThisEvening(now).getTime());
      expect(calculateTomorrowMorning(now).getTime()).toBe(calculateTomorrowMorning(now).getTime());
      expect(calculateWeekend(now).getTime()).toBe(calculateWeekend(now).getTime());
      expect(calculateNextWeek(now).getTime()).toBe(calculateNextWeek(now).getTime());
    });
  });

  // ---------------------------------------------------------------------------
  // 2. LEAP YEAR & LEAP DAY (FEB 29) DEEP VERIFICATION
  // ---------------------------------------------------------------------------
  describe('Leap Year & Leap Day (Feb 29) Deep Verification', () => {
    it('handles Feb 28 -> Feb 29 in leap year 2024', () => {
      const feb28Morning = new Date(2024, 1, 28, 10, 0, 0); // Feb 28, 2024 10:00
      const tomorrow = calculateTomorrowMorning(feb28Morning);
      expect(tomorrow.getFullYear()).toBe(2024);
      expect(tomorrow.getMonth()).toBe(1); // Feb
      expect(tomorrow.getDate()).toBe(29); // Leap day!
      expect(tomorrow.getHours()).toBe(9);
    });

    it('handles Feb 28 18:35 -> Feb 29 19:00 in leap year 2024 (This Evening rollover)', () => {
      const feb28Evening = new Date(2024, 1, 28, 18, 35, 0);
      const target = calculateThisEvening(feb28Evening);
      expect(target.getFullYear()).toBe(2024);
      expect(target.getMonth()).toBe(1);
      expect(target.getDate()).toBe(29);
      expect(target.getHours()).toBe(19);
    });

    it('handles Feb 29 -> March 1 in leap year 2024', () => {
      const feb29Noon = new Date(2024, 1, 29, 12, 0, 0);
      const tomorrow = calculateTomorrowMorning(feb29Noon);
      expect(tomorrow.getFullYear()).toBe(2024);
      expect(tomorrow.getMonth()).toBe(2); // March
      expect(tomorrow.getDate()).toBe(1);
      expect(tomorrow.getHours()).toBe(9);
    });

    it('handles Feb 29 23:50 + 15m -> March 1 00:05', () => {
      const feb29Late = new Date('2024-02-29T23:50:30.000Z');
      const target = calculate15Minutes(feb29Late);
      expect(target.toISOString()).toBe('2024-03-01T00:05:00.000Z');
    });

    it('handles Feb 29 23:15 + 1h -> March 1 00:15', () => {
      const feb29Late = new Date('2024-02-29T23:15:00.000Z');
      const target = calculate1Hour(feb29Late);
      expect(target.toISOString()).toBe('2024-03-01T00:15:00.000Z');
    });

    it('handles next leap year: 2028 (Feb 28 -> Feb 29)', () => {
      const feb28_2028 = new Date(2028, 1, 28, 14, 0, 0);
      const target = calculateTomorrowMorning(feb28_2028);
      expect(target.getFullYear()).toBe(2028);
      expect(target.getMonth()).toBe(1);
      expect(target.getDate()).toBe(29);
    });

    it('handles century leap year: Year 2000 is leap year (divisible by 400)', () => {
      const feb28_2000 = new Date(2000, 1, 28, 14, 0, 0);
      const target = calculateTomorrowMorning(feb28_2000);
      expect(target.getFullYear()).toBe(2000);
      expect(target.getMonth()).toBe(1);
      expect(target.getDate()).toBe(29); // 2000 has Feb 29
    });

    it('handles century non-leap year: Year 2100 is NOT a leap year (divisible by 100, not 400)', () => {
      const feb28_2100 = new Date(2100, 1, 28, 14, 0, 0);
      const target = calculateTomorrowMorning(feb28_2100);
      expect(target.getFullYear()).toBe(2100);
      expect(target.getMonth()).toBe(2); // March
      expect(target.getDate()).toBe(1); // 2100 rolls directly to March 1
    });

    it('calculateWeekend on leap day Feb 29, 2024 (Thursday) schedules for Saturday March 2', () => {
      const feb29_2024 = new Date(2024, 1, 29, 10, 0, 0); // Thursday
      expect(feb29_2024.getDay()).toBe(4); // Thursday
      const weekend = calculateWeekend(feb29_2024);
      expect(weekend.getDay()).toBe(6); // Saturday
      expect(weekend.getFullYear()).toBe(2024);
      expect(weekend.getMonth()).toBe(2); // March
      expect(weekend.getDate()).toBe(2);
      expect(weekend.getHours()).toBe(9);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. DAYLIGHT SAVING TIME (DST) SHIFTS
  // ---------------------------------------------------------------------------
  describe('Daylight Saving Time (DST) Transitions', () => {
    it('snoozes +15m seamlessly across 02:00 spring-forward in UTC epoch ms', () => {
      // 2026-03-08 is US Spring Forward
      // 06:45:00 UTC corresponds to 01:45:00 EST. 15 minutes later is 07:00:00 UTC (03:00:00 EDT)
      const preDst = new Date('2026-03-08T06:45:30.000Z');
      const target = calculate15Minutes(preDst);
      expect(target.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    });

    it('snoozes +1h seamlessly across 02:00 spring-forward in UTC epoch ms', () => {
      const preDst = new Date('2026-03-08T06:30:15.000Z');
      const target = calculate1Hour(preDst);
      expect(target.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it('snoozes +15m seamlessly across 02:00 fall-back in UTC epoch ms', () => {
      // 2026-11-01 is US Fall Back
      const preFallBack = new Date('2026-11-01T05:50:00.000Z');
      const target = calculate15Minutes(preFallBack);
      expect(target.toISOString()).toBe('2026-11-01T06:05:00.000Z');
    });

    it('TomorrowMorning targets local 09:00:00 regardless of DST transition happening at 02:00', () => {
      // Night before DST spring-forward (2026-03-07 22:00 local time)
      const eveningBeforeDst = new Date(2026, 2, 7, 22, 0, 0);
      const target = calculateTomorrowMorning(eveningBeforeDst);

      expect(target.getDate()).toBe(8);
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    });

    it('ThisEvening targets local 19:00:00 on the day of DST transition', () => {
      // Morning of DST spring-forward (2026-03-08 10:00 local time)
      const morningOfDst = new Date(2026, 2, 8, 10, 0, 0);
      const target = calculateThisEvening(morningOfDst);

      expect(target.getDate()).toBe(8);
      expect(target.getHours()).toBe(19);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    });

    it('Weekend targets local 09:00:00 across DST shift week', () => {
      // Wednesday before DST transition (2026-03-04)
      const wedBeforeDst = new Date(2026, 2, 4, 12, 0, 0);
      const target = calculateWeekend(wedBeforeDst);

      expect(target.getDay()).toBe(6);
      expect(target.getDate()).toBe(7);
      expect(target.getHours()).toBe(9);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. RAPID SUCCESSIVE SNOOZE INTERVALS (ACCUMULATION & MONOTONICITY)
  // ---------------------------------------------------------------------------
  describe('Rapid Successive Snooze Intervals', () => {
    it('accumulates 100 consecutive +15m snoozes in 0ms elapsed time (+1500m / +25h)', () => {
      const now = new Date('2026-09-10T10:00:00.000Z');
      let currentDue: Date = new Date(now.getTime());

      for (let i = 1; i <= 100; i++) {
        const nextTarget = calculate15Minutes(now, currentDue);
        expect(nextTarget.getTime()).toBe(currentDue.getTime() + 15 * 60 * 1000);
        expect(nextTarget.getTime()).toBeGreaterThan(currentDue.getTime());
        currentDue = nextTarget;
      }

      // 100 * 15m = 1500m = 25 hours
      const totalOffsetMs = currentDue.getTime() - now.getTime();
      expect(totalOffsetMs).toBe(100 * 15 * 60 * 1000);
      expect(currentDue.toISOString()).toBe('2026-09-11T11:00:00.000Z');
    });

    it('accumulates 50 consecutive +1h snoozes in 0ms elapsed time (+50 hours)', () => {
      const now = new Date('2026-09-10T10:00:00.000Z');
      let currentDue: Date = new Date(now.getTime());

      for (let i = 1; i <= 50; i++) {
        const nextTarget = calculate1Hour(now, currentDue);
        expect(nextTarget.getTime()).toBe(currentDue.getTime() + 60 * 60 * 1000);
        currentDue = nextTarget;
      }

      expect(currentDue.toISOString()).toBe('2026-09-12T12:00:00.000Z');
    });

    it('handles mixed rapid snooze sequence (+15m -> +1h -> +15m -> +1h)', () => {
      const now = new Date('2026-09-10T10:00:00.000Z');
      let due: Date = new Date(now.getTime());

      // +15m -> 10:15
      due = calculate15Minutes(now, due);
      expect(due.toISOString()).toBe('2026-09-10T10:15:00.000Z');

      // +1h -> 11:15
      due = calculate1Hour(now, due);
      expect(due.toISOString()).toBe('2026-09-10T11:15:00.000Z');

      // +15m -> 11:30
      due = calculate15Minutes(now, due);
      expect(due.toISOString()).toBe('2026-09-10T11:30:00.000Z');

      // +1h -> 12:30
      due = calculate1Hour(now, due);
      expect(due.toISOString()).toBe('2026-09-10T12:30:00.000Z');
    });

    it('handles rapid customInterval snoozes with accumulator', () => {
      const now = new Date('2026-09-10T10:00:00.000Z');
      let due = new Date(now.getTime());

      const steps = [5, 10, 15, 20, 30];
      let totalExpectedMinutes = 0;

      for (const step of steps) {
        due = calculateCustomInterval({ value: step, unit: 'minutes' }, now, due);
        totalExpectedMinutes += step;
      }

      expect(due.getTime() - now.getTime()).toBe(totalExpectedMinutes * 60 * 1000);
      expect(due.toISOString()).toBe('2026-09-10T11:20:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. PAST-DUE BOUNDARY CALCULATIONS
  // ---------------------------------------------------------------------------
  describe('Past-Due Boundary Calculations', () => {
    const now = new Date('2026-09-10T14:00:00.000Z');

    it('due exactly 1 millisecond in the past uses now as T_base', () => {
      const pastDue = new Date(now.getTime() - 1);
      const target = calculate15Minutes(now, pastDue);
      expect(target.toISOString()).toBe('2026-09-10T14:15:00.000Z');
    });

    it('due exactly equal to now (0ms difference) uses now as T_base', () => {
      const exactDue = new Date(now.getTime());
      const target = calculate15Minutes(now, exactDue);
      expect(target.toISOString()).toBe('2026-09-10T14:15:00.000Z');
    });

    it('due exactly 1 millisecond in the future uses dueDate as T_base', () => {
      const futureDue = new Date(now.getTime() + 1);
      const base = getBaseTime(now, futureDue);
      expect(base.getTime()).toBe(futureDue.getTime());
    });

    it('due 10 years in the past resets cleanly to now + interval', () => {
      const ancientDue = new Date('2016-09-10T14:00:00.000Z');
      const target15m = calculate15Minutes(now, ancientDue);
      const target1h = calculate1Hour(now, ancientDue);
      const targetCustom = calculateCustomInterval({ value: 2, unit: 'days' }, now, ancientDue);

      expect(target15m.toISOString()).toBe('2026-09-10T14:15:00.000Z');
      expect(target1h.toISOString()).toBe('2026-09-10T15:00:00.000Z');
      expect(targetCustom.toISOString()).toBe('2026-09-12T14:00:00.000Z');
    });

    it('due 1 millisecond past the 18:30 boundary rolls over in calculateThisEvening', () => {
      const date = new Date(2026, 8, 10, 18, 30, 0, 1);
      const target = calculateThisEvening(date);
      expect(target.getDate()).toBe(11);
      expect(target.getHours()).toBe(19);
    });

    it('due 1 millisecond before the 18:30 boundary does NOT roll over in calculateThisEvening', () => {
      const date = new Date(2026, 8, 10, 18, 29, 59, 999);
      const target = calculateThisEvening(date);
      expect(target.getDate()).toBe(10);
      expect(target.getHours()).toBe(19);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. EXTREME DATE & YEAR BOUNDARY FUZZING
  // ---------------------------------------------------------------------------
  describe('Extreme Date & Year Boundary Fuzzing', () => {
    it('handles Year 2038 32-bit overflow boundary (2038-01-19T03:14:07Z)', () => {
      const y2038 = new Date('2038-01-19T03:14:07.000Z');
      const target15m = calculate15Minutes(y2038);
      expect(target15m.toISOString()).toBe('2038-01-19T03:29:00.000Z');

      const target1h = calculate1Hour(y2038);
      expect(target1h.toISOString()).toBe('2038-01-19T04:14:00.000Z');
    });

    it('handles Year-End Boundary (Dec 31 23:59:59.999 -> Jan 1)', () => {
      const dec31 = new Date('2026-12-31T23:59:59.999Z');

      const target15m = calculate15Minutes(dec31);
      expect(target15m.toISOString()).toBe('2027-01-01T00:14:00.000Z');

      const target1h = calculate1Hour(dec31);
      expect(target1h.toISOString()).toBe('2027-01-01T00:59:00.000Z');

      const targetTomorrow = calculateTomorrowMorning(new Date(2026, 11, 31, 23, 0, 0));
      expect(targetTomorrow.getFullYear()).toBe(2027);
      expect(targetTomorrow.getMonth()).toBe(0);
      expect(targetTomorrow.getDate()).toBe(1);
      expect(targetTomorrow.getHours()).toBe(9);
    });

    it('handles Unix Epoch (1970-01-01T00:00:00.000Z)', () => {
      const epoch = new Date('1970-01-01T00:00:00.000Z');
      const target15m = calculate15Minutes(epoch);
      expect(target15m.toISOString()).toBe('1970-01-01T00:15:00.000Z');
    });

    it('handles high century dates (Year 2099 and Year 2999)', () => {
      const y2099 = new Date('2099-12-31T12:00:00.000Z');
      const target15m = calculate15Minutes(y2099);
      expect(target15m.toISOString()).toBe('2099-12-31T12:15:00.000Z');

      const y2999 = new Date('2999-06-15T10:00:00.000Z');
      const target1h = calculate1Hour(y2999);
      expect(target1h.toISOString()).toBe('2999-06-15T11:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. ADVERSARIAL, MALFORMED & CORNER-CASE INPUT DEFENSE
  // ---------------------------------------------------------------------------
  describe('Adversarial, Malformed & Corner-Case Input Defense', () => {
    const now = new Date('2026-09-10T14:00:00.000Z');

    it('safely handles empty string or whitespace string for dueDate', () => {
      expect(getBaseTime(now, '').getTime()).toBe(now.getTime());
      expect(getBaseTime(now, '   ').getTime()).toBe(now.getTime());
      expect(calculate15Minutes(now, '').toISOString()).toBe('2026-09-10T14:15:00.000Z');
    });

    it('safely handles invalid date strings for dueDate', () => {
      expect(getBaseTime(now, 'not-a-date').getTime()).toBe(now.getTime());
      expect(calculate15Minutes(now, 'garbage-input').toISOString()).toBe('2026-09-10T14:15:00.000Z');
    });

    it('safely handles Invalid Date (new Date(NaN)) for dueDate', () => {
      const invalidDate = new Date('invalid');
      expect(getBaseTime(now, invalidDate).getTime()).toBe(now.getTime());
    });

    it('rejects non-positive interval values in calculateCustomInterval', () => {
      expect(() => calculateCustomInterval({ value: 0, unit: 'minutes' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
      expect(() => calculateCustomInterval({ value: -0.001, unit: 'minutes' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
      expect(() => calculateCustomInterval({ value: -500, unit: 'hours' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
    });

    it('rejects NaN and Infinity in calculateCustomInterval', () => {
      expect(() => calculateCustomInterval({ value: NaN, unit: 'minutes' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
      expect(() => calculateCustomInterval({ value: Infinity, unit: 'minutes' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
      expect(() => calculateCustomInterval({ value: -Infinity, unit: 'minutes' }, now)).toThrow(
        'Invalid custom interval value: value must be a positive number'
      );
    });

    it('rejects invalid units in calculateCustomInterval', () => {
      expect(() => calculateCustomInterval({ value: 10, unit: 'seconds' as any }, now)).toThrow(
        'Invalid custom interval unit: unit must be minutes, hours, or days'
      );
      expect(() => calculateCustomInterval({ value: 2, unit: 'weeks' as any }, now)).toThrow(
        'Invalid custom interval unit: unit must be minutes, hours, or days'
      );
      expect(() => calculateCustomInterval({ value: 1, unit: 'months' as any }, now)).toThrow(
        'Invalid custom interval unit: unit must be minutes, hours, or days'
      );
    });

    it('rejects fractional intervals that truncate to <= now', () => {
      // 0.0001 minutes is 6 milliseconds. Truncating seconds turns it to now, which triggers the future check.
      expect(() => calculateCustomInterval({ value: 0.0001, unit: 'minutes' }, now)).toThrow(
        'Snooze target time must be strictly in the future'
      );
    });

    it('rejects customDate that is in the past', () => {
      const past = new Date('2026-09-10T13:00:00.000Z');
      expect(() => calculateSnoozeTime('custom', { now, customDate: past })).toThrow(
        'Snooze target time must be strictly in the future'
      );
    });

    it('rejects customDate that is invalid string or invalid Date', () => {
      expect(() => calculateSnoozeTime('custom', { now, customDate: 'invalid-string' })).toThrow(
        'Invalid custom date provided'
      );
      expect(() => calculateSnoozeTime('custom', { now, customDate: new Date(NaN) })).toThrow(
        'Invalid custom date provided'
      );
    });

    it('rejects custom preset when both customInterval and customDate are missing', () => {
      expect(() => calculateSnoozeTime('custom', { now })).toThrow(
        'Custom snooze preset requires either customInterval or customDate option'
      );
    });

    it('rejects unknown preset names', () => {
      expect(() => calculateSnoozeTime('invalid_preset' as any, { now })).toThrow(
        'Unsupported snooze preset: invalid_preset'
      );
    });

    it('handles fractional hour and day intervals cleanly', () => {
      const targetHalfHour = calculateCustomInterval({ value: 0.5, unit: 'hours' }, now);
      expect(targetHalfHour.toISOString()).toBe('2026-09-10T14:30:00.000Z');

      const targetDayAndHalf = calculateCustomInterval({ value: 1.5, unit: 'days' }, now);
      expect(targetDayAndHalf.toISOString()).toBe('2026-09-12T02:00:00.000Z');
    });
  });
});
