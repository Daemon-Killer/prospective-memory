package com.remy.wear.domain

import com.remy.wear.domain.model.SnoozePreset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

class SnoozeEngineTest {

    private val utcZone: ZoneId = ZoneId.of("UTC")

    // =========================================================================
    // Category 1: Strict Baseline Reference Time (T_base = max(T_now, T_due))
    // =========================================================================

    @Test
    fun `test 01 - overdue task sets T_base to now`() {
        // Due at 10:00:00, snoozed at 10:20:45 (T_now > T_due)
        val dueMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()
        val nowMillis = Instant.parse("2026-09-11T10:20:45.123Z").toEpochMilli()

        val base = SnoozeEngine.getBaseTime(nowMillis, dueMillis)
        assertEquals("T_base must equal nowMillis when overdue", nowMillis, base)

        // +15m snooze: 10:20:45 + 15m = 10:35:45 -> truncated to 10:35:00.000
        val target = SnoozeEngine.calculate15Minutes(nowMillis, dueMillis)
        val expected = Instant.parse("2026-09-11T10:35:00.000Z").toEpochMilli()
        assertEquals(expected, target)
    }

    @Test
    fun `test 02 - proactive task sets T_base to due date`() {
        // Due at 14:00:00, user proactively snoozes at 13:10:30 (T_due > T_now)
        val dueMillis = Instant.parse("2026-09-11T14:00:00.000Z").toEpochMilli()
        val nowMillis = Instant.parse("2026-09-11T13:10:30.500Z").toEpochMilli()

        val base = SnoozeEngine.getBaseTime(nowMillis, dueMillis)
        assertEquals("T_base must equal dueMillis when proactive", dueMillis, base)

        // +15m snooze from due date: 14:00:00 + 15m = 14:15:00.000
        val target = SnoozeEngine.calculate15Minutes(nowMillis, dueMillis)
        val expected = Instant.parse("2026-09-11T14:15:00.000Z").toEpochMilli()
        assertEquals(expected, target)
    }

    @Test
    fun `test 03 - null due date defaults T_base to now`() {
        val nowMillis = Instant.parse("2026-09-11T09:30:15.800Z").toEpochMilli()

        val base = SnoozeEngine.getBaseTime(nowMillis, null)
        assertEquals("T_base must equal nowMillis when dueMillis is null", nowMillis, base)

        val target = SnoozeEngine.calculate15Minutes(nowMillis, null)
        val expected = Instant.parse("2026-09-11T09:45:00.000Z").toEpochMilli()
        assertEquals(expected, target)
    }

    @Test
    fun `test 04 - exact equality between now and due date`() {
        val timestamp = Instant.parse("2026-09-11T12:00:00.000Z").toEpochMilli()
        val base = SnoozeEngine.getBaseTime(timestamp, timestamp)
        assertEquals(timestamp, base)
    }

    // =========================================================================
    // Category 2: Clock Truncation to :00s and :000ms
    // =========================================================================

    @Test
    fun `test 05 - truncateToMinute zeroes seconds and milliseconds`() {
        // 10:15:59.999 -> 10:15:00.000
        val input = Instant.parse("2026-09-11T10:15:59.999Z").toEpochMilli()
        val truncated = SnoozeEngine.truncateToMinute(input)
        val expected = Instant.parse("2026-09-11T10:15:00.000Z").toEpochMilli()

        assertEquals(expected, truncated)
        assertEquals("Remainder mod 60_000 must be zero", 0L, truncated % 60_000L)
    }

    @Test
    fun `test 06 - truncateToMinute on exact minute boundary is idempotent`() {
        val exactMinute = Instant.parse("2026-09-11T08:00:00.000Z").toEpochMilli()
        val truncated = SnoozeEngine.truncateToMinute(exactMinute)
        assertEquals(exactMinute, truncated)
    }

    @Test
    fun `test 07 - one hour preset zeroes seconds and milliseconds`() {
        val nowMillis = Instant.parse("2026-09-11T11:42:33.777Z").toEpochMilli()
        val target = SnoozeEngine.calculate1Hour(nowMillis)
        val expected = Instant.parse("2026-09-11T12:42:00.000Z").toEpochMilli()

        assertEquals(expected, target)
        assertEquals(0L, target % 60_000L)
        assertTrue("Target must advance past now", target > nowMillis)
    }

    // =========================================================================
    // Category 3: This Evening Preset (19:00, 18:30 Rollover Threshold)
    // =========================================================================

    @Test
    fun `test 08 - this evening before 18h30 threshold schedules today at 19h00`() {
        // 14:15:00 UTC -> today 19:00:00 UTC
        val now = ZonedDateTime.of(2026, 9, 11, 14, 15, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateThisEvening(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Should be today (11th)", 11, targetZoned.dayOfMonth)
        assertEquals("Hour must be 19", 19, targetZoned.hour)
        assertEquals("Minute must be 0", 0, targetZoned.minute)
        assertEquals("Second must be 0", 0, targetZoned.second)
    }

    @Test
    fun `test 09 - this evening at 18h29m59s remains today at 19h00`() {
        val now = ZonedDateTime.of(2026, 9, 11, 18, 29, 59, 999_000_000, utcZone)
        val targetMillis = SnoozeEngine.calculateThisEvening(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(11, targetZoned.dayOfMonth)
        assertEquals(19, targetZoned.hour)
    }

    @Test
    fun `test 10 - this evening at exact 18h30 boundary rolls over to tomorrow at 19h00`() {
        val now = ZonedDateTime.of(2026, 9, 11, 18, 30, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateThisEvening(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Must roll over to tomorrow (12th)", 12, targetZoned.dayOfMonth)
        assertEquals(19, targetZoned.hour)
        assertEquals(0, targetZoned.minute)
    }

    @Test
    fun `test 11 - this evening late night after 19h00 rolls over to tomorrow at 19h00`() {
        val now = ZonedDateTime.of(2026, 9, 11, 21, 45, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateThisEvening(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(12, targetZoned.dayOfMonth)
        assertEquals(19, targetZoned.hour)
    }

    // =========================================================================
    // Category 4: Tomorrow Morning & Calendar Rollovers
    // =========================================================================

    @Test
    fun `test 12 - tomorrow morning standard day advance to 09h00`() {
        val now = ZonedDateTime.of(2026, 9, 11, 16, 20, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateTomorrowMorning(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(12, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
        assertEquals(0, targetZoned.minute)
        assertEquals(0, targetZoned.second)
    }

    @Test
    fun `test 13 - tomorrow morning month boundary advance (Sept 30 to Oct 01)`() {
        val now = ZonedDateTime.of(2026, 9, 30, 23, 10, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateTomorrowMorning(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Month must advance to October", 10, targetZoned.monthValue)
        assertEquals("Day must be 1st", 1, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    @Test
    fun `test 14 - tomorrow morning year boundary advance (Dec 31 to Jan 01)`() {
        val now = ZonedDateTime.of(2026, 12, 31, 22, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateTomorrowMorning(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Year must advance to 2027", 2027, targetZoned.year)
        assertEquals("Month must be January", 1, targetZoned.monthValue)
        assertEquals("Day must be 1st", 1, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    @Test
    fun `test 15 - tomorrow morning leap year Feb 28 advances to Feb 29`() {
        // 2024 is a leap year
        val now = ZonedDateTime.of(2024, 2, 28, 14, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateTomorrowMorning(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(2, targetZoned.monthValue)
        assertEquals("Must land on leap day Feb 29", 29, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    @Test
    fun `test 16 - tomorrow morning non-leap year Feb 28 advances to March 01`() {
        // 2025 is not a leap year
        val now = ZonedDateTime.of(2025, 2, 28, 14, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateTomorrowMorning(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Must roll over to March", 3, targetZoned.monthValue)
        assertEquals("Must land on March 1st", 1, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    // =========================================================================
    // Category 5: Weekend Preset (Saturday 09:00 Rules)
    // =========================================================================

    @Test
    fun `test 17 - weekend midweek advances to upcoming Saturday at 09h00`() {
        // 2026-09-09 is Wednesday -> upcoming Saturday is 2026-09-12
        val now = ZonedDateTime.of(2026, 9, 9, 10, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateWeekend(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(java.time.DayOfWeek.SATURDAY, targetZoned.dayOfWeek)
        assertEquals(12, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
        assertEquals(0, targetZoned.minute)
    }

    @Test
    fun `test 18 - weekend on Friday night advances to tomorrow Saturday 09h00`() {
        // 2026-09-11 is Friday 23:00 -> Saturday 2026-09-12 09:00
        val now = ZonedDateTime.of(2026, 9, 11, 23, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateWeekend(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(12, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    @Test
    fun `test 19 - weekend on Saturday before 09h00 schedules for today 09h00`() {
        // Saturday 2026-09-12 at 07:30 -> today Saturday at 09:00
        val now = ZonedDateTime.of(2026, 9, 12, 7, 30, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateWeekend(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Must remain today Saturday", 12, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
        assertTrue(targetMillis > now.toInstant().toEpochMilli())
    }

    @Test
    fun `test 20 - weekend on Saturday at or after 09h00 advances to next Saturday (+7 days)`() {
        // Saturday 2026-09-12 at 09:00:00 -> next Saturday 2026-09-19 09:00
        val now = ZonedDateTime.of(2026, 9, 12, 9, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateWeekend(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals("Must advance +7 days to next Saturday", 19, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    @Test
    fun `test 21 - weekend on Sunday advances to upcoming Saturday (+6 days)`() {
        // Sunday 2026-09-13 15:00 -> Saturday 2026-09-19 09:00
        val now = ZonedDateTime.of(2026, 9, 13, 15, 0, 0, 0, utcZone)
        val targetMillis = SnoozeEngine.calculateWeekend(now.toInstant().toEpochMilli(), utcZone)
        val targetZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMillis), utcZone)

        assertEquals(19, targetZoned.dayOfMonth)
        assertEquals(9, targetZoned.hour)
    }

    // =========================================================================
    // Category 6: Rotary Bezel Dialing Quanta & Clamping
    // =========================================================================

    @Test
    fun `test 22 - rotary detent stepping in 5-minute quanta`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // 1 detent = 5m
        val target1 = SnoozeEngine.calculateRotarySnooze(detents = 1, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), target1)

        // 3 detents = 15m
        val target3 = SnoozeEngine.calculateRotarySnooze(detents = 3, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:15:00.000Z").toEpochMilli(), target3)

        // 12 detents = 60m (1h)
        val target12 = SnoozeEngine.calculateRotarySnooze(detents = 12, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T11:00:00.000Z").toEpochMilli(), target12)
    }

    @Test
    fun `test 23 - rotary detent clamping at minimum 5m and maximum 180m`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // Negative detents clamp to minimum 5m
        val targetMin = SnoozeEngine.calculateRotarySnooze(detents = -4, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), targetMin)

        // 0 detents clamp to minimum 5m
        val targetZero = SnoozeEngine.calculateRotarySnooze(detents = 0, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), targetZero)

        // 50 detents (250m) clamp to max 180m (3h)
        val targetMax = SnoozeEngine.calculateRotarySnooze(detents = 50, nowMillis = nowMillis)
        assertEquals(Instant.parse("2026-09-11T13:00:00.000Z").toEpochMilli(), targetMax)
    }

    // =========================================================================
    // Category 7: Custom Intervals & Invariant Validation Exceptions
    // =========================================================================

    @Test
    fun `test 24 - custom minutes with proactive due date`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()
        val dueMillis = Instant.parse("2026-09-11T10:30:00.000Z").toEpochMilli()

        // Proactive snooze of 45m from due date: 10:30 + 45m = 11:15:00
        val target = SnoozeEngine.calculateCustomMinutes(45, nowMillis, dueMillis)
        assertEquals(Instant.parse("2026-09-11T11:15:00.000Z").toEpochMilli(), target)
    }

    @Test
    fun `test 25 - validation exceptions for non-positive or past target times`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // Non-positive minutes rejected
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateCustomMinutes(0, nowMillis)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateCustomMinutes(-10, nowMillis)
        }

        // Target timestamp in the past rejected
        val pastMillis = Instant.parse("2026-09-11T09:00:00.000Z").toEpochMilli()
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateCustomDate(pastMillis, nowMillis)
        }

        // Target equal to now rejected by strict future monotonicity
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateCustomDate(nowMillis, nowMillis)
        }
    }
}
