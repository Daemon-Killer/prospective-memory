package com.remy.wear.rotary

import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test

class RotaryDialTest {

    private lateinit var controller: RotaryBezelController
    private var tickCount = 0
    private var lastReportedMinutes = -1
    private var lastReportedDirection = 0

    @Before
    fun setUp() {
        tickCount = 0
        lastReportedMinutes = -1
        lastReportedDirection = 0

        controller = RotaryBezelController(
            detentThresholdPx = 28f,
            stepMinutes = 5,
            minMinutes = 5,
            maxMinutes = 180,
            initialMinutes = 15,
            onDetentStep = { minutes, direction ->
                lastReportedMinutes = minutes
                lastReportedDirection = direction
            },
            onDetentTick = {
                tickCount++
            }
        )
    }

    @Test
    fun initialValuesAreCorrect() {
        assertThat(controller.currentMinutes).isEqualTo(15)
        assertThat(controller.accumulatedDelta).isEqualTo(0f)
        assertThat(controller.detentThresholdPx).isEqualTo(28f)
        assertThat(controller.stepMinutes).isEqualTo(5)
    }

    @Test
    fun subThresholdScrollAccumulatesWithoutTriggeringDetent() {
        val triggered = controller.handleScroll(14f)
        assertThat(triggered).isFalse()
        assertThat(controller.currentMinutes).isEqualTo(15)
        assertThat(controller.accumulatedDelta).isEqualTo(14f)
        assertThat(tickCount).isEqualTo(0)
    }

    @Test
    fun reachingThresholdTriggersDetentAndTactileTick() {
        // First scroll: 14f (accumulated = 14f)
        controller.handleScroll(14f)
        // Second scroll: 15f (total = 29f >= 28f)
        val triggered = controller.handleScroll(15f)

        assertThat(triggered).isTrue()
        assertThat(controller.currentMinutes).isEqualTo(20)
        assertThat(controller.accumulatedDelta).isEqualTo(1f) // 29 - 28 = 1f
        assertThat(tickCount).isEqualTo(1)
        assertThat(lastReportedMinutes).isEqualTo(20)
        assertThat(lastReportedDirection).isEqualTo(1)
    }

    @Test
    fun counterClockwiseScrollDecreasesMinutes() {
        val triggered = controller.handleScroll(-30f)
        assertThat(triggered).isTrue()
        assertThat(controller.currentMinutes).isEqualTo(10) // 15 - 5
        assertThat(controller.accumulatedDelta).isEqualTo(-2f) // -30 - (-28) = -2f
        assertThat(tickCount).isEqualTo(1)
        assertThat(lastReportedDirection).isEqualTo(-1)
    }

    @Test
    fun largeDisplacementTriggersMultipleDetents() {
        // Scroll 60f -> 2 full 28f detents (56f) with 4f remainder
        val triggered = controller.handleScroll(60f)
        assertThat(triggered).isTrue()
        assertThat(controller.currentMinutes).isEqualTo(25) // 15 + (2 * 5)
        assertThat(controller.accumulatedDelta).isEqualTo(4f)
        assertThat(tickCount).isEqualTo(2)
    }

    @Test
    fun clampsAtMinimumMinutes() {
        // Starting at 15m, scroll CCW by -100f
        controller.handleScroll(-100f)
        assertThat(controller.currentMinutes).isEqualTo(5) // Clamped at min (5)
    }

    @Test
    fun clampsAtMaximumMinutes() {
        // Starting at 15m, scroll CW by 2000f
        controller.handleScroll(2000f)
        assertThat(controller.currentMinutes).isEqualTo(180) // Clamped at max (180)
    }

    @Test
    fun resetRestoresState() {
        controller.handleScroll(35f)
        assertThat(controller.currentMinutes).isEqualTo(20)

        controller.reset(15)
        assertThat(controller.currentMinutes).isEqualTo(15)
        assertThat(controller.accumulatedDelta).isEqualTo(0f)
    }

    @Test
    fun computeTargetEpochMillisEnforcesTBaseMax() {
        val nowMillis = 1_700_000_040_000L // Exactly minute-aligned (divisible by 60,000)
        val overdueDueMillis = nowMillis - 600_000L // 10m overdue

        // Controller set to 15m
        val target = controller.computeTargetEpochMillis(nowMillis, overdueDueMillis)
        // With overdue, T_base = nowMillis, target = nowMillis + 15 * 60_000
        assertThat(target).isEqualTo(nowMillis + 15 * 60_000L)
    }
}
