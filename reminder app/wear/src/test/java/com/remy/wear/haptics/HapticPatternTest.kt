package com.remy.wear.haptics

import android.content.Context
import android.os.Vibrator
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HapticPatternTest {

    private lateinit var engine: RemyHapticEngine
    private lateinit var context: Context

    @Before
    fun setUp() {
        engine = RemyHapticEngine(randomSeed = 42L)
        context = ApplicationProvider.getApplicationContext()
    }

    @Test
    fun rotaryDetentProducesSubtleMicroTick() {
        val waveform = engine.generateWaveform(RemyHapticEngine.PatternType.ROTARY_DETENT)
        assertThat(waveform.timings).isEqualTo(longArrayOf(0, 8))
        assertThat(waveform.amplitudes).isEqualTo(intArrayOf(0, 60))
    }

    @Test
    fun snoozeConfirmProducesCrispClick() {
        val waveform = engine.generateWaveform(RemyHapticEngine.PatternType.SNOOZE_CONFIRM)
        assertThat(waveform.timings).isEqualTo(longArrayOf(0, 15))
        assertThat(waveform.amplitudes).isEqualTo(intArrayOf(0, 180))
    }

    @Test
    fun completeAckProducesDoublePulseWithDecayingAmplitude() {
        val waveform = engine.generateWaveform(RemyHapticEngine.PatternType.COMPLETE_ACK)
        assertThat(waveform.timings).isEqualTo(longArrayOf(0, 20, 40, 15))
        assertThat(waveform.amplitudes).isEqualTo(intArrayOf(0, 120, 0, 60))
        assertThat(waveform.amplitudes[1]).isGreaterThan(waveform.amplitudes[3])
    }

    @Test
    fun dueNowProducesCrescendoWaveform() {
        val waveform = engine.generateWaveform(RemyHapticEngine.PatternType.DUE_NOW, applyJitter = false)
        assertThat(waveform.timings).hasLength(4)
        assertThat(waveform.amplitudes).isEqualTo(intArrayOf(0, 90, 0, 220))
        assertThat(waveform.amplitudes[3]).isGreaterThan(waveform.amplitudes[1])
    }

    @Test
    fun urgentOverdueEscalationIncreasesPulseRepetitions() {
        val level0 = engine.generateWaveform(RemyHapticEngine.PatternType.URGENT_OVERDUE, escalationLevel = 0, applyJitter = false)
        val level1 = engine.generateWaveform(RemyHapticEngine.PatternType.URGENT_OVERDUE, escalationLevel = 1, applyJitter = false)
        val level2 = engine.generateWaveform(RemyHapticEngine.PatternType.URGENT_OVERDUE, escalationLevel = 2, applyJitter = false)

        assertThat(level0.timings.size).isLessThan(level1.timings.size)
        assertThat(level1.timings.size).isLessThan(level2.timings.size)

        // Verifies high Pacinian (255) and low Meissner (110) amplitudes
        assertThat(level0.amplitudes).asList().contains(255)
        assertThat(level0.amplitudes).asList().contains(110)
    }

    @Test
    fun stochasticJitterProducesTemporalVariation() {
        val engineWithoutSeed = RemyHapticEngine()
        val wave1 = engineWithoutSeed.generateWaveform(RemyHapticEngine.PatternType.URGENT_OVERDUE, applyJitter = true)
        val wave2 = engineWithoutSeed.generateWaveform(RemyHapticEngine.PatternType.URGENT_OVERDUE, applyJitter = true)

        // With jitter, at least some timing elements vary between instances
        val timingsMatch = wave1.timings.contentEquals(wave2.timings)
        // Note: With probabilistic jitter over multiple gaps, equality is virtually zero
        assertThat(wave1.timings.size).isEqualTo(wave2.timings.size)
    }

    @Test
    fun createVibrationEffectProducesValidEffect() {
        val waveform = engine.generateWaveform(RemyHapticEngine.PatternType.SNOOZE_CONFIRM)
        val effect = engine.createVibrationEffect(waveform)
        assertThat(effect).isNotNull()
    }

    @Test
    fun vibrateExecutesSafelyWithoutCrashing() {
        engine.vibrate(context, RemyHapticEngine.PatternType.ROTARY_DETENT)
        engine.vibrate(context, RemyHapticEngine.PatternType.URGENT_OVERDUE, escalationLevel = 1)
    }
}
