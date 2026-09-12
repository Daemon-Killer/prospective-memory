package com.remy.wear.domain

import com.remy.wear.domain.model.SnoozePreset
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/**
 * Remy Reminders - Wear OS Snooze Engine
 *
 * Enforces:
 * 1. Strict baseline reference time: T_base = max(T_now, T_due)
 * 2. Clock truncation to 00 seconds and 000 milliseconds
 * 3. Calendar boundaries (leap year, month rollovers, year ends)
 * 4. Rotary bezel detent quantization (5m steps, [5m, 180m] clamp)
 * 5. Monotonic future invariant (T_target > T_now)
 *
 * Full mathematical parity with React Native host (src/utils/snoozeCalculator.ts).
 */
object SnoozeEngine {

    const val MILLIS_PER_SECOND = 1_000L
    const val MILLIS_PER_MINUTE = 60_000L
    const val MILLIS_PER_HOUR = 3_600_000L
    const val MILLIS_PER_DAY = 86_400_000L

    // Evening preset rules
    val EVENING_TARGET_TIME: LocalTime = LocalTime.of(19, 0, 0, 0)
    val EVENING_ROLLOVER_THRESHOLD: LocalTime = LocalTime.of(18, 30, 0, 0)

    // Morning preset rules
    val MORNING_TARGET_TIME: LocalTime = LocalTime.of(9, 0, 0, 0)

    // Rotary bezel detent constraints
    const val DEFAULT_ROTARY_STEP_MINUTES = 5
    const val DEFAULT_ROTARY_MIN_MINUTES = 5
    const val DEFAULT_ROTARY_MAX_MINUTES = 180 // 3 hours

    // -------------------------------------------------------------------------
    // Core Temporal Invariants
    // -------------------------------------------------------------------------

    /**
     * Computes the baseline reference time for snooze calculations:
     * T_base = max(T_now, T_due)
     *
     * If dueMillis is null or absent, T_base defaults to nowMillis.
     */
    @JvmStatic
    fun getBaseTime(nowMillis: Long, dueMillis: Long?): Long {
        if (dueMillis == null) return nowMillis
        return maxOf(nowMillis, dueMillis)
    }

    /**
     * Truncates seconds and milliseconds to 00 for clean clock alignment:
     * T_truncated = T - (T mod 60_000)
     */
    @JvmStatic
    fun truncateToMinute(epochMillis: Long): Long {
        val remainder = Math.floorMod(epochMillis, MILLIS_PER_MINUTE)
        return epochMillis - remainder
    }

    // -------------------------------------------------------------------------
    // Preset Calculators (Epoch Milliseconds API)
    // -------------------------------------------------------------------------

    /**
     * Preset: +15 minutes
     * Adds 15 minutes to T_base with seconds truncated to 00.
     */
    @JvmStatic
    fun calculate15Minutes(nowMillis: Long, dueMillis: Long? = null): Long {
        val base = getBaseTime(nowMillis, dueMillis)
        val target = truncateToMinute(base + 15 * MILLIS_PER_MINUTE)
        requireTargetInFuture(target, nowMillis, "15m")
        return target
    }

    /**
     * Preset: +1 hour
     * Adds 60 minutes to T_base with seconds truncated to 00.
     */
    @JvmStatic
    fun calculate1Hour(nowMillis: Long, dueMillis: Long? = null): Long {
        val base = getBaseTime(nowMillis, dueMillis)
        val target = truncateToMinute(base + MILLIS_PER_HOUR)
        requireTargetInFuture(target, nowMillis, "1h")
        return target
    }

    /**
     * Preset: This Evening (19:00:00 local time)
     *
     * - If current local time < 18:30:00: schedules for today at 19:00:00.
     * - If current local time >= 18:30:00: rolls over to tomorrow at 19:00:00.
     */
    @JvmStatic
    @JvmOverloads
    fun calculateThisEvening(
        nowMillis: Long,
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Long {
        val nowZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMillis), zoneId)
        val thresholdToday = nowZoned.with(EVENING_ROLLOVER_THRESHOLD)
        val targetToday = nowZoned.with(EVENING_TARGET_TIME)

        val targetZoned = if (!nowZoned.isBefore(thresholdToday)) {
            // Already at or past 18:30:00 -> push to tomorrow at 19:00:00
            targetToday.plusDays(1)
        } else {
            targetToday
        }

        val target = truncateToMinute(targetZoned.toInstant().toEpochMilli())
        requireTargetInFuture(target, nowMillis, "evening")
        return target
    }

    /**
     * Preset: Tomorrow Morning (09:00:00 local time tomorrow)
     *
     * Automatically handles leap years (Feb 28 -> Feb 29), month-end rollovers,
     * and year boundaries (Dec 31 -> Jan 01).
     */
    @JvmStatic
    @JvmOverloads
    fun calculateTomorrowMorning(
        nowMillis: Long,
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Long {
        val nowZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMillis), zoneId)
        val tomorrowNineAm = nowZoned.plusDays(1).with(MORNING_TARGET_TIME)
        val target = truncateToMinute(tomorrowNineAm.toInstant().toEpochMilli())
        requireTargetInFuture(target, nowMillis, "tomorrow_morning")
        return target
    }

    /**
     * Preset: This Weekend (Upcoming Saturday at 09:00:00 local time)
     *
     * - Sunday through Friday: advances to upcoming Saturday at 09:00:00.
     * - Saturday before 09:00:00: schedules for today at 09:00:00.
     * - Saturday at or after 09:00:00: advances 7 days to next Saturday at 09:00:00.
     */
    @JvmStatic
    @JvmOverloads
    fun calculateWeekend(
        nowMillis: Long,
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Long {
        val nowZoned = ZonedDateTime.ofInstant(Instant.ofEpochMilli(nowMillis), zoneId)
        val saturdayNineAm = nowZoned.with(MORNING_TARGET_TIME)

        val targetZoned = when (nowZoned.dayOfWeek) {
            DayOfWeek.SATURDAY -> {
                if (nowZoned.isBefore(saturdayNineAm)) {
                    saturdayNineAm
                } else {
                    saturdayNineAm.plusWeeks(1)
                }
            }
            else -> {
                nowZoned.with(TemporalAdjusters.next(DayOfWeek.SATURDAY))
                    .with(MORNING_TARGET_TIME)
            }
        }

        val target = truncateToMinute(targetZoned.toInstant().toEpochMilli())
        requireTargetInFuture(target, nowMillis, "weekend")
        return target
    }

    /**
     * Preset: Custom Interval (in Minutes)
     *
     * Target = truncateToMinute(T_base + minutes * 60_000)
     */
    @JvmStatic
    fun calculateCustomMinutes(
        minutes: Long,
        nowMillis: Long,
        dueMillis: Long? = null
    ): Long {
        require(minutes > 0) { "Custom snooze duration must be strictly positive: $minutes minutes" }
        val base = getBaseTime(nowMillis, dueMillis)
        val target = truncateToMinute(base + minutes * MILLIS_PER_MINUTE)
        requireTargetInFuture(target, nowMillis, "custom ($minutes min)")
        return target
    }

    /**
     * Preset: Rotary Bezel Snooze Dial
     *
     * Calculates quantized snooze interval based on rotary detent clicks:
     * minutes = (detents * stepMinutes).coerceIn(minMinutes, maxMinutes)
     *
     * @param detents Number of detent clicks accumulated (positive or negative)
     * @param nowMillis Current timestamp in epoch milliseconds
     * @param dueMillis Optional original due timestamp
     * @param stepMinutes Duration step per physical detent (default: 5 minutes)
     * @param minMinutes Minimum selectable duration (default: 5 minutes)
     * @param maxMinutes Maximum selectable duration (default: 180 minutes / 3 hours)
     */
    @JvmStatic
    @JvmOverloads
    fun calculateRotarySnooze(
        detents: Int,
        nowMillis: Long,
        dueMillis: Long? = null,
        stepMinutes: Int = DEFAULT_ROTARY_STEP_MINUTES,
        minMinutes: Int = DEFAULT_ROTARY_MIN_MINUTES,
        maxMinutes: Int = DEFAULT_ROTARY_MAX_MINUTES
    ): Long {
        require(stepMinutes > 0) { "Rotary stepMinutes must be positive: $stepMinutes" }
        require(minMinutes > 0) { "Rotary minMinutes must be positive: $minMinutes" }
        require(maxMinutes >= minMinutes) { "Rotary maxMinutes ($maxMinutes) must be >= minMinutes ($minMinutes)" }

        val rawMinutes = detents.toLong() * stepMinutes.toLong()
        val clampedMinutes = rawMinutes.coerceIn(minMinutes.toLong(), maxMinutes.toLong())
        return calculateCustomMinutes(clampedMinutes, nowMillis, dueMillis)
    }

    /**
     * Preset: Custom Exact Date / Milliseconds
     *
     * Truncates provided timestamp to minute and validates strict future monotonicity.
     */
    @JvmStatic
    fun calculateCustomDate(targetDateMillis: Long, nowMillis: Long): Long {
        val target = truncateToMinute(targetDateMillis)
        requireTargetInFuture(target, nowMillis, "customDate")
        return target
    }

    // -------------------------------------------------------------------------
    // Unified Dispatcher
    // -------------------------------------------------------------------------

    /**
     * Unified calculation entry point matching phone app's calculateSnoozeTime.
     */
    @JvmStatic
    @JvmOverloads
    fun calculateSnooze(
        nowMillis: Long,
        dueMillis: Long?,
        preset: SnoozePreset,
        customMinutes: Long? = null,
        customDateMillis: Long? = null,
        zoneId: ZoneId = ZoneId.systemDefault()
    ): Long {
        return when (preset) {
            SnoozePreset.FIFTEEN_MINUTES -> calculate15Minutes(nowMillis, dueMillis)
            SnoozePreset.ONE_HOUR -> calculate1Hour(nowMillis, dueMillis)
            SnoozePreset.THIS_EVENING -> calculateThisEvening(nowMillis, zoneId)
            SnoozePreset.TOMORROW_MORNING -> calculateTomorrowMorning(nowMillis, zoneId)
            SnoozePreset.WEEKEND -> calculateWeekend(nowMillis, zoneId)
            SnoozePreset.CUSTOM -> {
                when {
                    customDateMillis != null -> calculateCustomDate(customDateMillis, nowMillis)
                    customMinutes != null -> calculateCustomMinutes(customMinutes, nowMillis, dueMillis)
                    else -> throw IllegalArgumentException(
                        "SnoozePreset.CUSTOM requires either customMinutes or customDateMillis"
                    )
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Instant / ZonedDateTime Overloads for Developer Ergonomics
    // -------------------------------------------------------------------------

    fun getBaseTime(now: Instant, dueDate: Instant?): Instant =
        Instant.ofEpochMilli(getBaseTime(now.toEpochMilli(), dueDate?.toEpochMilli()))

    fun truncateToMinute(instant: Instant): Instant =
        Instant.ofEpochMilli(truncateToMinute(instant.toEpochMilli()))

    fun calculate15Minutes(now: Instant, dueDate: Instant? = null): Instant =
        Instant.ofEpochMilli(calculate15Minutes(now.toEpochMilli(), dueDate?.toEpochMilli()))

    fun calculate1Hour(now: Instant, dueDate: Instant? = null): Instant =
        Instant.ofEpochMilli(calculate1Hour(now.toEpochMilli(), dueDate?.toEpochMilli()))

    fun calculateThisEvening(now: ZonedDateTime): ZonedDateTime =
        ZonedDateTime.ofInstant(
            Instant.ofEpochMilli(calculateThisEvening(now.toInstant().toEpochMilli(), now.zone)),
            now.zone
        )

    fun calculateTomorrowMorning(now: ZonedDateTime): ZonedDateTime =
        ZonedDateTime.ofInstant(
            Instant.ofEpochMilli(calculateTomorrowMorning(now.toInstant().toEpochMilli(), now.zone)),
            now.zone
        )

    fun calculateWeekend(now: ZonedDateTime): ZonedDateTime =
        ZonedDateTime.ofInstant(
            Instant.ofEpochMilli(calculateWeekend(now.toInstant().toEpochMilli(), now.zone)),
            now.zone
        )

    // -------------------------------------------------------------------------
    // Internal Validation Helper
    // -------------------------------------------------------------------------

    private fun requireTargetInFuture(targetMillis: Long, nowMillis: Long, context: String) {
        require(targetMillis > nowMillis) {
            "Snooze target time ($targetMillis) for '$context' must be strictly in the future of now ($nowMillis)"
        }
    }
}
