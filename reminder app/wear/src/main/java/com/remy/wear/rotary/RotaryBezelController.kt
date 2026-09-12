package com.remy.wear.rotary

import com.remy.wear.domain.SnoozeEngine

/**
 * Controller for Wear OS digital rotary crown and capacitive touch bezel input.
 *
 * Implements physical detent simulation with deadband thresholds, discrete 5-minute
 * quantization, tactile haptic tick triggering, and boundaries clamping.
 *
 * Designed for Samsung Galaxy Watch 7 capacitive touch bezel & rotary hardware.
 */
class RotaryBezelController(
    val detentThresholdPx: Float = DEFAULT_DETENT_THRESHOLD_PX,
    val stepMinutes: Int = DEFAULT_STEP_MINUTES,
    val minMinutes: Int = DEFAULT_MIN_MINUTES,
    val maxMinutes: Int = DEFAULT_MAX_MINUTES,
    initialMinutes: Int = DEFAULT_INITIAL_MINUTES,
    var onDetentStep: (currentMinutes: Int, direction: Int) -> Unit = { _, _ -> },
    var onDetentTick: () -> Unit = {}
) {

    companion object {
        const val DEFAULT_DETENT_THRESHOLD_PX = 28f
        const val DEFAULT_STEP_MINUTES = 5
        const val DEFAULT_MIN_MINUTES = 5
        const val DEFAULT_MAX_MINUTES = 180 // 3 hours
        const val DEFAULT_INITIAL_MINUTES = 15
    }

    init {
        require(detentThresholdPx > 0f) { "detentThresholdPx must be > 0: $detentThresholdPx" }
        require(stepMinutes > 0) { "stepMinutes must be > 0: $stepMinutes" }
        require(minMinutes > 0) { "minMinutes must be > 0: $minMinutes" }
        require(maxMinutes >= minMinutes) { "maxMinutes ($maxMinutes) must be >= minMinutes ($minMinutes)" }
    }

    var currentMinutes: Int = initialMinutes.coerceIn(minMinutes, maxMinutes)
        private set

    var accumulatedDelta: Float = 0f
        private set

    /**
     * Processes raw rotary scroll delta (from crown motion or circular touch bezel).
     *
     * @param delta Scroll displacement in pixels or degrees (positive = clockwise / down)
     * @return true if at least one detent step was triggered, false otherwise
     */
    fun handleScroll(delta: Float): Boolean {
        if (delta == 0f || delta.isNaN()) return false

        accumulatedDelta += delta
        var detentTriggered = false

        while (Math.abs(accumulatedDelta) >= detentThresholdPx) {
            val direction = if (accumulatedDelta > 0f) 1 else -1
            accumulatedDelta -= direction * detentThresholdPx

            val newMinutes = (currentMinutes + direction * stepMinutes).coerceIn(minMinutes, maxMinutes)
            val changed = newMinutes != currentMinutes

            currentMinutes = newMinutes
            detentTriggered = true

            // Trigger tactile detent feedback and step callback
            onDetentTick()
            onDetentStep(currentMinutes, direction)
        }

        return detentTriggered
    }

    /**
     * Resets accumulated scroll delta and restores current snooze duration to [minutes].
     */
    fun reset(minutes: Int = DEFAULT_INITIAL_MINUTES) {
        currentMinutes = minutes.coerceIn(minMinutes, maxMinutes)
        accumulatedDelta = 0f
    }

    /**
     * Computes the target snooze epoch milliseconds based on the current rotary dial setting,
     * enforcing strict T_base = max(T_now, T_due) calculation via [SnoozeEngine].
     */
    fun computeTargetEpochMillis(nowMillis: Long, dueMillis: Long? = null): Long {
        return SnoozeEngine.calculateCustomMinutes(currentMinutes.toLong(), nowMillis, dueMillis)
    }
}
