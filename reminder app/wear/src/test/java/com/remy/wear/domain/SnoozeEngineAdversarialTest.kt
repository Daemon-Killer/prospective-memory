package com.remy.wear.domain

import com.remy.wear.domain.model.SnoozePreset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Random

/**
 * SnoozeEngineAdversarialTest
 *
 * Empirical adversarial stress-testing harness for [SnoozeEngine]:
 * 1. Extreme Epoch Boundaries & Overflow Fuzzing (Epoch 0, Pre-1970, Year 2038, Year 9999, Long boundaries)
 * 2. Property-Based Invariants & Monte Carlo Fuzzing (10,000 iterations)
 * 3. Sub-Second & Micro-Boundary Precision (-1ms, 0ms, +1ms)
 * 4. Evening Rollover Critical Boundary (18:30:00 cutoff)
 * 5. Weekend Rollover Critical Boundary (Saturday 09:00 cutoff)
 * 6. Leap Year, Century Rules & Month Rollovers (2024, 2028, 2000, 2100)
 * 7. Timezone Invariance & DST Shifts (Spring forward, Fall back, Fractional offsets)
 * 8. Rotary Bezel Dialing Adversarial Input Defense (Int.MIN_VALUE, Int.MAX_VALUE, clamping)
 * 9. Rapid Consecutive Snooze Accumulator (100x consecutive snoozes)
 * 10. Unified Dispatcher Invariants & Exception Matrix
 */
class SnoozeEngineAdversarialTest {

    private val utcZone: ZoneId = ZoneId.of("UTC")
    private val newYorkZone: ZoneId = ZoneId.of("America/New_York")
    private val kolkataZone: ZoneId = ZoneId.of("Asia/Kolkata")
    private val chathamZone: ZoneId = ZoneId.of("Pacific/Chatham")

    // =========================================================================
    // 1. Extreme Epoch Boundaries & Overflow Fuzzing
    // =========================================================================

    @Test
    fun `test 01 - Unix epoch zero (1970-01-01T00 00 00Z) across all presets`() {
        val epochZero = 0L // 1970-01-01T00:00:00.000Z (Thursday)

        val target15m = SnoozeEngine.calculate15Minutes(epochZero)
        assertEquals(15 * 60_000L, target15m)
        assertEquals(0L, target15m % 60_000L)
        assertTrue(target15m > epochZero)

        val target1h = SnoozeEngine.calculate1Hour(epochZero)
        assertEquals(3_600_000L, target1h)
        assertEquals(0L, target1h % 60_000L)
        assertTrue(target1h > epochZero)

        val targetEvening = SnoozeEngine.calculateThisEvening(epochZero, utcZone)
        val eveningExpected = Instant.parse("1970-01-01T19:00:00.000Z").toEpochMilli()
        assertEquals(eveningExpected, targetEvening)
        assertEquals(0L, targetEvening % 60_000L)
        assertTrue(targetEvening > epochZero)

        val targetTomorrow = SnoozeEngine.calculateTomorrowMorning(epochZero, utcZone)
        val tomorrowExpected = Instant.parse("1970-01-02T09:00:00.000Z").toEpochMilli()
        assertEquals(tomorrowExpected, targetTomorrow)
        assertEquals(0L, targetTomorrow % 60_000L)
        assertTrue(targetTomorrow > epochZero)

        val targetWeekend = SnoozeEngine.calculateWeekend(epochZero, utcZone)
        val weekendExpected = Instant.parse("1970-01-03T09:00:00.000Z").toEpochMilli() // Saturday
        assertEquals(weekendExpected, targetWeekend)
        assertEquals(0L, targetWeekend % 60_000L)
        assertTrue(targetWeekend > epochZero)

        val targetRotary = SnoozeEngine.calculateRotarySnooze(detents = 1, nowMillis = epochZero)
        assertEquals(5 * 60_000L, targetRotary)
        assertEquals(0L, targetRotary % 60_000L)
        assertTrue(targetRotary > epochZero)
    }

    @Test
    fun `test 02 - negative epoch (pre-1970 timestamps) mathematical floorMod`() {
        // -100_000L = 1969-12-31T23:58:20.000Z
        val negativeNow = -100_000L

        // Truncate test on negative timestamp:
        // Math.floorMod(-100_000, 60_000) = 20_000
        // -100_000 - 20_000 = -120_000
        val truncated = SnoozeEngine.truncateToMinute(negativeNow)
        assertEquals(-120_000L, truncated)
        assertEquals(0L, truncated % 60_000L)

        // +15m snooze: base = -100_000, base + 15m = 800_000
        // truncated 800_000 -> 780_000
        val target15m = SnoozeEngine.calculate15Minutes(negativeNow)
        assertEquals(780_000L, target15m)
        assertEquals(0L, target15m % 60_000L)
        assertTrue(target15m > negativeNow)

        // +1h snooze: base + 60m = 3_500_000 -> truncated to 3_480_000
        val target1h = SnoozeEngine.calculate1Hour(negativeNow)
        assertEquals(3_480_000L, target1h)
        assertEquals(0L, target1h % 60_000L)
        assertTrue(target1h > negativeNow)

        // Custom 30 minutes
        val targetCustom = SnoozeEngine.calculateCustomMinutes(30, negativeNow)
        assertEquals(1_680_000L, targetCustom)
        assertEquals(0L, targetCustom % 60_000L)
        assertTrue(targetCustom > negativeNow)
    }

    @Test
    fun `test 03 - Year 2038 32-bit overflow boundary (2038-01-19T03 14 07Z)`() {
        // 2^31 - 1 seconds = 2,147,483,647s = 2,147,483,647,000 ms
        val y2038Boundary = 2_147_483_647_000L // 2038-01-19T03:14:07.000Z

        val target15m = SnoozeEngine.calculate15Minutes(y2038Boundary)
        val expected15m = Instant.parse("2038-01-19T03:29:00.000Z").toEpochMilli()
        assertEquals(expected15m, target15m)
        assertEquals(0L, target15m % 60_000L)
        assertTrue(target15m > y2038Boundary)

        val target1h = SnoozeEngine.calculate1Hour(y2038Boundary)
        val expected1h = Instant.parse("2038-01-19T04:14:00.000Z").toEpochMilli()
        assertEquals(expected1h, target1h)
        assertEquals(0L, target1h % 60_000L)
        assertTrue(target1h > y2038Boundary)

        val targetTomorrow = SnoozeEngine.calculateTomorrowMorning(y2038Boundary, utcZone)
        val expectedTomorrow = Instant.parse("2038-01-20T09:00:00.000Z").toEpochMilli()
        assertEquals(expectedTomorrow, targetTomorrow)
        assertTrue(targetTomorrow > y2038Boundary)
    }

    @Test
    fun `test 04 - Year 9999 extreme boundary rollover to Year 10000`() {
        val y9999End = Instant.parse("9999-12-31T23:50:30.000Z").toEpochMilli()

        val target15m = SnoozeEngine.calculate15Minutes(y9999End)
        assertEquals(0L, target15m % 60_000L)
        assertTrue(target15m > y9999End)

        val target1h = SnoozeEngine.calculate1Hour(y9999End)
        assertEquals(0L, target1h % 60_000L)
        assertTrue(target1h > y9999End)

        // Tomorrow morning advances to year 10000-01-01T09:00:00
        val targetTomorrow = SnoozeEngine.calculateTomorrowMorning(y9999End, utcZone)
        val tomorrowZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetTomorrow), utcZone)
        assertEquals(10000, tomorrowZoned.year)
        assertEquals(1, tomorrowZoned.monthValue)
        assertEquals(1, tomorrowZoned.dayOfMonth)
        assertEquals(9, tomorrowZoned.hour)
        assertTrue(targetTomorrow > y9999End)
    }

    @Test
    fun `test 05 - Long overflow defenses reject invalid past targets`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // Astronomical minutes that cause Long primitive multiplication overflow
        // wrap to negative numbers and get rejected by requireTargetInFuture
        val hugeMinutes = Long.MAX_VALUE / 50_000L // 184_467_440_737L
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateCustomMinutes(hugeMinutes, nowMillis)
        }

        // nowMillis near Long.MAX_VALUE
        val nearMax = Long.MAX_VALUE - 1000L
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculate15Minutes(nearMax)
        }
    }

    // =========================================================================
    // 2. Property-Based Invariants & Monte Carlo Fuzzing (10,000 Iterations)
    // =========================================================================

    @Test
    fun `test 06 - Monte Carlo fuzzing 10 000 iterations verifies 5 core invariants`() {
        val random = Random(42L) // Deterministic seed for reproducible adversarial fuzzing
        val minEpoch = Instant.parse("1970-01-01T00:00:00.000Z").toEpochMilli()
        val maxEpoch = Instant.parse("2100-01-01T00:00:00.000Z").toEpochMilli()
        val span = maxEpoch - minEpoch

        val presets = listOf(
            SnoozePreset.FIFTEEN_MINUTES,
            SnoozePreset.ONE_HOUR,
            SnoozePreset.THIS_EVENING,
            SnoozePreset.TOMORROW_MORNING,
            SnoozePreset.WEEKEND
        )

        for (i in 1..10_000) {
            val nowMillis = minEpoch + (random.nextDouble() * span).toLong()

            // Random due date: 33% past, 33% null, 33% future
            val dueMode = random.nextInt(3)
            val dueMillis: Long? = when (dueMode) {
                0 -> nowMillis - random.nextInt(100_000_000).toLong() - 1L // Overdue
                1 -> null // Null
                else -> nowMillis + random.nextInt(100_000_000).toLong() + 1L // Proactive
            }

            // Invariant 1: T_base = max(now, due)
            val base = SnoozeEngine.getBaseTime(nowMillis, dueMillis)
            if (dueMillis == null || dueMillis <= nowMillis) {
                assertEquals("T_base must equal now when due is null or overdue", nowMillis, base)
            } else {
                assertEquals("T_base must equal dueMillis when proactive", dueMillis, base)
            }

            // Invariant 2 & 3: Clock Truncation & Strict Future Monotonicity
            for (preset in presets) {
                val target = SnoozeEngine.calculateSnooze(
                    nowMillis = nowMillis,
                    dueMillis = dueMillis,
                    preset = preset,
                    zoneId = utcZone
                )

                // Must be truncated to exact minute
                assertEquals(
                    "Target must be truncated to minute for $preset at now=$nowMillis",
                    0L,
                    target % 60_000L
                )

                // Must be strictly in the future of now
                assertTrue(
                    "Target ($target) must be > now ($nowMillis) for $preset",
                    target > nowMillis
                )

                // Invariant 4: Overdue Immunity (due <= now yields identical result as due == null)
                if (dueMillis != null && dueMillis <= nowMillis) {
                    val targetWithNullDue = SnoozeEngine.calculateSnooze(
                        nowMillis = nowMillis,
                        dueMillis = null,
                        preset = preset,
                        zoneId = utcZone
                    )
                    assertEquals(
                        "Overdue task must produce identical target as null due for $preset",
                        targetWithNullDue,
                        target
                    )
                }

                // Invariant 5: Determinism / Purity
                val targetSecondCall = SnoozeEngine.calculateSnooze(
                    nowMillis = nowMillis,
                    dueMillis = dueMillis,
                    preset = preset,
                    zoneId = utcZone
                )
                assertEquals("Snooze calculation must be purely deterministic", target, targetSecondCall)
            }

            // Rotary detent test with randomized detents (-50 to 100)
            val detents = random.nextInt(151) - 50
            val rotaryTarget = SnoozeEngine.calculateRotarySnooze(
                detents = detents,
                nowMillis = nowMillis,
                dueMillis = dueMillis
            )
            assertEquals(0L, rotaryTarget % 60_000L)
            assertTrue(rotaryTarget > nowMillis)
        }
    }

    // =========================================================================
    // 3. Sub-Second & Micro-Boundary Precision (-1ms, 0ms, +1ms)
    // =========================================================================

    @Test
    fun `test 07 - sub-second boundaries at 59s999, 00s000, 00s001`() {
        // 10:15:59.999
        val at59s = Instant.parse("2026-09-11T10:15:59.999Z").toEpochMilli()
        val target59s = SnoozeEngine.calculate15Minutes(at59s)
        val expected59s = Instant.parse("2026-09-11T10:30:00.000Z").toEpochMilli()
        assertEquals(expected59s, target59s)
        assertTrue("Must be in future", target59s > at59s)

        // 10:16:00.000
        val at00s = Instant.parse("2026-09-11T10:16:00.000Z").toEpochMilli()
        val target00s = SnoozeEngine.calculate15Minutes(at00s)
        val expected00s = Instant.parse("2026-09-11T10:31:00.000Z").toEpochMilli()
        assertEquals(expected00s, target00s)
        assertTrue(target00s > at00s)

        // 10:16:00.001
        val at001ms = Instant.parse("2026-09-11T10:16:00.001Z").toEpochMilli()
        val target001ms = SnoozeEngine.calculate15Minutes(at001ms)
        val expected001ms = Instant.parse("2026-09-11T10:31:00.000Z").toEpochMilli()
        assertEquals(expected001ms, target001ms)
        assertTrue(target001ms > at001ms)
    }

    @Test
    fun `test 08 - overdue vs proactive micro-boundaries (-1ms, 0ms, +1ms)`() {
        val now = Instant.parse("2026-09-11T12:00:00.000Z").toEpochMilli()

        // due = now - 1ms (overdue by 1ms) -> T_base = now
        val duePast1ms = now - 1L
        assertEquals(now, SnoozeEngine.getBaseTime(now, duePast1ms))
        assertEquals(
            SnoozeEngine.calculate15Minutes(now, null),
            SnoozeEngine.calculate15Minutes(now, duePast1ms)
        )

        // due = now (exact boundary) -> T_base = now
        assertEquals(now, SnoozeEngine.getBaseTime(now, now))
        assertEquals(
            SnoozeEngine.calculate15Minutes(now, null),
            SnoozeEngine.calculate15Minutes(now, now)
        )

        // due = now + 1ms (proactive by 1ms) -> T_base = due
        val dueFuture1ms = now + 1L
        assertEquals(dueFuture1ms, SnoozeEngine.getBaseTime(now, dueFuture1ms))
        val targetProactive = SnoozeEngine.calculate15Minutes(now, dueFuture1ms)
        // 12:00:00.001 + 15m = 12:15:00.001 -> truncated to 12:15:00.000
        assertEquals(Instant.parse("2026-09-11T12:15:00.000Z").toEpochMilli(), targetProactive)
    }

    @Test
    fun `test 09 - ancient overdue task (due 50 years ago)`() {
        val now = Instant.parse("2026-09-11T12:00:00.000Z").toEpochMilli()
        val ancientDue = Instant.parse("1976-09-11T12:00:00.000Z").toEpochMilli()

        val base = SnoozeEngine.getBaseTime(now, ancientDue)
        assertEquals(now, base)

        val target15m = SnoozeEngine.calculate15Minutes(now, ancientDue)
        assertEquals(Instant.parse("2026-09-11T12:15:00.000Z").toEpochMilli(), target15m)

        val target1h = SnoozeEngine.calculate1Hour(now, ancientDue)
        assertEquals(Instant.parse("2026-09-11T13:00:00.000Z").toEpochMilli(), target1h)
    }

    // =========================================================================
    // 4. Evening Rollover Critical Boundary (18:30:00 cutoff)
    // =========================================================================

    @Test
    fun `test 10 - evening rollover exact threshold behavior`() {
        // 18:29:59.999 UTC -> today 19:00:00
        val beforeThreshold = ZonedDateTime.of(2026, 9, 11, 18, 29, 59, 999_000_000, utcZone)
        val targetBefore = SnoozeEngine.calculateThisEvening(beforeThreshold.toInstant().toEpochMilli(), utcZone)
        val zonedBefore = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetBefore), utcZone)
        assertEquals(11, zonedBefore.dayOfMonth)
        assertEquals(19, zonedBefore.hour)

        // 18:30:00.000 UTC -> rolls over to tomorrow 19:00:00
        val exactThreshold = ZonedDateTime.of(2026, 9, 11, 18, 30, 0, 0, utcZone)
        val targetExact = SnoozeEngine.calculateThisEvening(exactThreshold.toInstant().toEpochMilli(), utcZone)
        val zonedExact = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetExact), utcZone)
        assertEquals("Exact 18:30 must roll over to tomorrow", 12, zonedExact.dayOfMonth)
        assertEquals(19, zonedExact.hour)

        // 18:30:00.001 UTC -> rolls over to tomorrow 19:00:00
        val afterThreshold = ZonedDateTime.of(2026, 9, 11, 18, 30, 0, 1_000_000, utcZone)
        val targetAfter = SnoozeEngine.calculateThisEvening(afterThreshold.toInstant().toEpochMilli(), utcZone)
        val zonedAfter = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetAfter), utcZone)
        assertEquals(12, zonedAfter.dayOfMonth)
        assertEquals(19, zonedAfter.hour)

        // 00:00:00.000 UTC -> today 19:00:00
        val midnight = ZonedDateTime.of(2026, 9, 11, 0, 0, 0, 0, utcZone)
        val targetMidnight = SnoozeEngine.calculateThisEvening(midnight.toInstant().toEpochMilli(), utcZone)
        val zonedMidnight = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMidnight), utcZone)
        assertEquals(11, zonedMidnight.dayOfMonth)
        assertEquals(19, zonedMidnight.hour)
    }

    // =========================================================================
    // 5. Weekend Rollover Critical Boundary (Saturday 09:00 cutoff)
    // =========================================================================

    @Test
    fun `test 11 - weekend rollover exact threshold behavior`() {
        // Saturday 08:59:59.999 UTC -> today Saturday 09:00:00
        val satBeforeNine = ZonedDateTime.of(2026, 9, 12, 8, 59, 59, 999_000_000, utcZone)
        val targetSatBefore = SnoozeEngine.calculateWeekend(satBeforeNine.toInstant().toEpochMilli(), utcZone)
        val zonedSatBefore = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetSatBefore), utcZone)
        assertEquals(12, zonedSatBefore.dayOfMonth)
        assertEquals(9, zonedSatBefore.hour)
        assertTrue(targetSatBefore > satBeforeNine.toInstant().toEpochMilli())

        // Saturday 09:00:00.000 UTC -> advances +7 days to next Saturday
        val satExactNine = ZonedDateTime.of(2026, 9, 12, 9, 0, 0, 0, utcZone)
        val targetSatExact = SnoozeEngine.calculateWeekend(satExactNine.toInstant().toEpochMilli(), utcZone)
        val zonedSatExact = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetSatExact), utcZone)
        assertEquals(19, zonedSatExact.dayOfMonth)
        assertEquals(9, zonedSatExact.hour)
        assertTrue(targetSatExact > satExactNine.toInstant().toEpochMilli())

        // Saturday 09:00:00.001 UTC -> advances +7 days to next Saturday
        val satAfterNine = ZonedDateTime.of(2026, 9, 12, 9, 0, 0, 1_000_000, utcZone)
        val targetSatAfter = SnoozeEngine.calculateWeekend(satAfterNine.toInstant().toEpochMilli(), utcZone)
        val zonedSatAfter = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetSatAfter), utcZone)
        assertEquals(19, zonedSatAfter.dayOfMonth)
        assertEquals(9, zonedSatAfter.hour)

        // Sunday 00:00:00.000 UTC -> advances to upcoming Saturday (+6 days)
        val sunMidnight = ZonedDateTime.of(2026, 9, 13, 0, 0, 0, 0, utcZone)
        val targetSun = SnoozeEngine.calculateWeekend(sunMidnight.toInstant().toEpochMilli(), utcZone)
        val zonedSun = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetSun), utcZone)
        assertEquals(19, zonedSun.dayOfMonth)
        assertEquals(9, zonedSun.hour)
    }

    // =========================================================================
    // 6. Leap Year, Century Rules & Month Rollovers
    // =========================================================================

    @Test
    fun `test 12 - leap year 2024 and 2028 transitions`() {
        // 2024-02-28 12:00 -> advances to Feb 29 (leap day)
        val feb28_2024 = ZonedDateTime.of(2024, 2, 28, 12, 0, 0, 0, utcZone)
        val targetLeapDay = SnoozeEngine.calculateTomorrowMorning(feb28_2024.toInstant().toEpochMilli(), utcZone)
        val zonedLeapDay = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetLeapDay), utcZone)
        assertEquals(2, zonedLeapDay.monthValue)
        assertEquals(29, zonedLeapDay.dayOfMonth)
        assertEquals(9, zonedLeapDay.hour)

        // 2024-02-29 12:00 -> advances to March 01
        val feb29_2024 = ZonedDateTime.of(2024, 2, 29, 12, 0, 0, 0, utcZone)
        val targetMarch = SnoozeEngine.calculateTomorrowMorning(feb29_2024.toInstant().toEpochMilli(), utcZone)
        val zonedMarch = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetMarch), utcZone)
        assertEquals(3, zonedMarch.monthValue)
        assertEquals(1, zonedMarch.dayOfMonth)

        // 2024-02-29 23:50:30 + 15m -> 2024-03-01 00:05:00
        val target15m = SnoozeEngine.calculate15Minutes(Instant.parse("2024-02-29T23:50:30.000Z").toEpochMilli())
        assertEquals(Instant.parse("2024-03-01T00:05:00.000Z").toEpochMilli(), target15m)

        // 2028 leap year
        val feb28_2028 = ZonedDateTime.of(2028, 2, 28, 14, 0, 0, 0, utcZone)
        val target2028 = SnoozeEngine.calculateTomorrowMorning(feb28_2028.toInstant().toEpochMilli(), utcZone)
        val zoned2028 = ZonedDateTime.ofInstant(Instant.ofEpochMilli(target2028), utcZone)
        assertEquals(29, zoned2028.dayOfMonth)
    }

    @Test
    fun `test 13 - century leap year 2000 vs century non-leap year 2100`() {
        // Year 2000 is a leap year (divisible by 400)
        val feb28_2000 = ZonedDateTime.of(2000, 2, 28, 10, 0, 0, 0, utcZone)
        val target2000 = SnoozeEngine.calculateTomorrowMorning(feb28_2000.toInstant().toEpochMilli(), utcZone)
        val zoned2000 = ZonedDateTime.ofInstant(Instant.ofEpochMilli(target2000), utcZone)
        assertEquals(2, zoned2000.monthValue)
        assertEquals("Year 2000 has Feb 29", 29, zoned2000.dayOfMonth)

        // Year 2100 is NOT a leap year (divisible by 100, not 400)
        val feb28_2100 = ZonedDateTime.of(2100, 2, 28, 10, 0, 0, 0, utcZone)
        val target2100 = SnoozeEngine.calculateTomorrowMorning(feb28_2100.toInstant().toEpochMilli(), utcZone)
        val zoned2100 = ZonedDateTime.ofInstant(Instant.ofEpochMilli(target2100), utcZone)
        assertEquals("Year 2100 rolls directly to March", 3, zoned2100.monthValue)
        assertEquals(1, zoned2100.dayOfMonth)
    }

    @Test
    fun `test 14 - all 30-day month endings rollover cleanly`() {
        val thirtyDayMonths = listOf(4 to 30, 6 to 30, 9 to 30, 11 to 30)

        for ((month, lastDay) in thirtyDayMonths) {
            val endOfMonth = ZonedDateTime.of(2026, month, lastDay, 22, 0, 0, 0, utcZone)
            val target = SnoozeEngine.calculateTomorrowMorning(endOfMonth.toInstant().toEpochMilli(), utcZone)
            val zonedTarget = ZonedDateTime.ofInstant(Instant.ofEpochMilli(target), utcZone)

            assertEquals("Must advance to next month", month + 1, zonedTarget.monthValue)
            assertEquals("Must be 1st of next month", 1, zonedTarget.dayOfMonth)
            assertEquals(9, zonedTarget.hour)
        }
    }

    // =========================================================================
    // 7. Timezone Invariance & DST Shifts
    // =========================================================================

    @Test
    fun `test 15 - DST spring-forward shift across 02 00 in America New_York`() {
        // 2026-03-08 is US Spring Forward (02:00 -> 03:00)
        // 06:45:00 UTC is 01:45:00 EST. 15 minutes later is 07:00:00 UTC (03:00:00 EDT)
        val preSpring = Instant.parse("2026-03-08T06:45:30.000Z").toEpochMilli()
        val target15m = SnoozeEngine.calculate15Minutes(preSpring)
        assertEquals(Instant.parse("2026-03-08T07:00:00.000Z").toEpochMilli(), target15m)

        // 1 hour later
        val preSpring1h = Instant.parse("2026-03-08T06:30:00.000Z").toEpochMilli()
        val target1h = SnoozeEngine.calculate1Hour(preSpring1h)
        assertEquals(Instant.parse("2026-03-08T07:30:00.000Z").toEpochMilli(), target1h)

        // Tomorrow morning set on evening before DST (2026-03-07 22:00 NY time)
        val eveningBeforeDst = ZonedDateTime.of(2026, 3, 7, 22, 0, 0, 0, newYorkZone)
        val targetTomorrow = SnoozeEngine.calculateTomorrowMorning(
            eveningBeforeDst.toInstant().toEpochMilli(),
            newYorkZone
        )
        val zonedTomorrow = ZonedDateTime.ofInstant(Instant.ofEpochMilli(targetTomorrow), newYorkZone)
        assertEquals(8, zonedTomorrow.dayOfMonth)
        assertEquals(9, zonedTomorrow.hour)
        assertEquals(0, zonedTomorrow.minute)
    }

    @Test
    fun `test 16 - DST fall-back shift across 02 00 in America New_York`() {
        // 2026-11-01 is US Fall Back (02:00 EDT -> 01:00 EST)
        val preFallBack = Instant.parse("2026-11-01T05:50:00.000Z").toEpochMilli()
        val target15m = SnoozeEngine.calculate15Minutes(preFallBack)
        assertEquals(Instant.parse("2026-11-01T06:05:00.000Z").toEpochMilli(), target15m)
    }

    @Test
    fun `test 17 - fractional timezone clock truncation (Kolkata +05 30 and Chatham +12 45)`() {
        val now = Instant.parse("2026-09-11T10:15:30.500Z").toEpochMilli()

        // Asia/Kolkata (+05:30)
        val targetKolkataEvening = SnoozeEngine.calculateThisEvening(now, kolkataZone)
        assertEquals(0L, targetKolkataEvening % 60_000L)
        val targetKolkataMorning = SnoozeEngine.calculateTomorrowMorning(now, kolkataZone)
        assertEquals(0L, targetKolkataMorning % 60_000L)

        // Pacific/Chatham (+12:45 / +13:45)
        val targetChathamEvening = SnoozeEngine.calculateThisEvening(now, chathamZone)
        assertEquals(0L, targetChathamEvening % 60_000L)
        val targetChathamMorning = SnoozeEngine.calculateTomorrowMorning(now, chathamZone)
        assertEquals(0L, targetChathamMorning % 60_000L)
    }

    // =========================================================================
    // 8. Rotary Bezel Dialing Adversarial Input Defense
    // =========================================================================

    @Test
    fun `test 18 - rotary detent boundary clamping and extreme values`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // Int.MIN_VALUE (-2,147,483,648) clamps to minMinutes (5m)
        val targetMinInt = SnoozeEngine.calculateRotarySnooze(Int.MIN_VALUE, nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), targetMinInt)

        // -100 detents clamps to minMinutes (5m)
        val targetNeg = SnoozeEngine.calculateRotarySnooze(-100, nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), targetNeg)

        // 0 detents clamps to minMinutes (5m)
        val targetZero = SnoozeEngine.calculateRotarySnooze(0, nowMillis)
        assertEquals(Instant.parse("2026-09-11T10:05:00.000Z").toEpochMilli(), targetZero)

        // 36 detents * 5m = 180m (exact default max)
        val target36 = SnoozeEngine.calculateRotarySnooze(36, nowMillis)
        assertEquals(Instant.parse("2026-09-11T13:00:00.000Z").toEpochMilli(), target36)

        // 37 detents * 5m = 185m -> clamped to 180m
        val target37 = SnoozeEngine.calculateRotarySnooze(37, nowMillis)
        assertEquals(Instant.parse("2026-09-11T13:00:00.000Z").toEpochMilli(), target37)

        // Int.MAX_VALUE (2,147,483,647) clamps to maxMinutes (180m)
        val targetMaxInt = SnoozeEngine.calculateRotarySnooze(Int.MAX_VALUE, nowMillis)
        assertEquals(Instant.parse("2026-09-11T13:00:00.000Z").toEpochMilli(), targetMaxInt)
    }

    @Test
    fun `test 19 - rotary invalid configuration parameters rejected`() {
        val nowMillis = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        // stepMinutes <= 0
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateRotarySnooze(1, nowMillis, stepMinutes = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateRotarySnooze(1, nowMillis, stepMinutes = -5)
        }

        // minMinutes <= 0
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateRotarySnooze(1, nowMillis, minMinutes = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateRotarySnooze(1, nowMillis, minMinutes = -1)
        }

        // maxMinutes < minMinutes
        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateRotarySnooze(1, nowMillis, minMinutes = 30, maxMinutes = 15)
        }
    }

    // =========================================================================
    // 9. Rapid Consecutive Snooze Accumulator
    // =========================================================================

    @Test
    fun `test 20 - 100 consecutive +15m snoozes in 0ms elapsed time (+1500m)`() {
        val now = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()
        var currentDue = now

        for (step in 1..100) {
            val nextTarget = SnoozeEngine.calculate15Minutes(now, currentDue)
            assertEquals("Step $step must advance by 15 minutes", currentDue + 15 * 60_000L, nextTarget)
            assertEquals(0L, nextTarget % 60_000L)
            assertTrue(nextTarget > currentDue)
            currentDue = nextTarget
        }

        // 100 * 15m = 1500m = 25 hours -> 2026-09-12T11:00:00.000Z
        val expectedEnd = Instant.parse("2026-09-12T11:00:00.000Z").toEpochMilli()
        assertEquals(expectedEnd, currentDue)
    }

    @Test
    fun `test 21 - 50 consecutive +1h snoozes in 0ms elapsed time (+50h)`() {
        val now = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()
        var currentDue = now

        for (step in 1..50) {
            val nextTarget = SnoozeEngine.calculate1Hour(now, currentDue)
            assertEquals("Step $step must advance by 1 hour", currentDue + 3_600_000L, nextTarget)
            currentDue = nextTarget
        }

        // 50 hours -> 2026-09-13T12:00:00.000Z
        val expectedEnd = Instant.parse("2026-09-13T12:00:00.000Z").toEpochMilli()
        assertEquals(expectedEnd, currentDue)
    }

    // =========================================================================
    // 10. Unified Dispatcher Invariants & Exception Matrix
    // =========================================================================

    @Test
    fun `test 22 - unified calculateSnooze dispatcher covers all presets`() {
        val now = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        assertEquals(
            SnoozeEngine.calculate15Minutes(now),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.FIFTEEN_MINUTES)
        )
        assertEquals(
            SnoozeEngine.calculate1Hour(now),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.ONE_HOUR)
        )
        assertEquals(
            SnoozeEngine.calculateThisEvening(now, utcZone),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.THIS_EVENING, zoneId = utcZone)
        )
        assertEquals(
            SnoozeEngine.calculateTomorrowMorning(now, utcZone),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.TOMORROW_MORNING, zoneId = utcZone)
        )
        assertEquals(
            SnoozeEngine.calculateWeekend(now, utcZone),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.WEEKEND, zoneId = utcZone)
        )
        assertEquals(
            SnoozeEngine.calculateCustomMinutes(45, now),
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.CUSTOM, customMinutes = 45)
        )
    }

    @Test
    fun `test 23 - calculateSnooze CUSTOM without parameters throws IllegalArgumentException`() {
        val now = Instant.parse("2026-09-11T10:00:00.000Z").toEpochMilli()

        assertThrows(IllegalArgumentException::class.java) {
            SnoozeEngine.calculateSnooze(now, null, SnoozePreset.CUSTOM)
        }
    }
}
