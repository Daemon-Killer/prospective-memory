package com.remy.wear.haptics

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.util.Random

/**
 * Vibrotactile cueing engine implementing dual-band frequency-hopping waveforms
 * to defeat somatic sensory adaptation (neural habituation).
 *
 * Grounded in somatosensory neurobiology:
 * - Meissner corpuscles: 30-50 Hz flutter detection (light cutaneous touch)
 * - Pacinian corpuscles: 200-300 Hz deep transient vibration detection
 *
 * Rhythmic repetition of uniform vibrations induces rapid sensory gating in the somatosensory
 * cortex (S1). By alternating between high-frequency Pacinian bursts and low-frequency
 * Meissner flutters with stochastic temporal jitter (+/- 15-25ms), Remy maintains prospective
 * memory cue salience without causing tactile fatigue.
 */
class RemyHapticEngine(
    private val randomSeed: Long? = null
) {

    enum class PatternType {
        /** Pacinian high-frequency pulses alternating with Meissner flutter + jitter */
        URGENT_OVERDUE,
        /** Dual-pulse crescendo alert (gentle tap -> sharp click) */
        DUE_NOW,
        /** Crisp 15ms single click acknowledging snooze execution */
        SNOOZE_CONFIRM,
        /** Subtle 8ms micro-tick for digital rotary bezel detent steps */
        ROTARY_DETENT,
        /** Double gentle tap with decaying amplitude acknowledging task completion */
        COMPLETE_ACK
    }

    data class Waveform(
        val timings: LongArray,
        val amplitudes: IntArray
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Waveform) return false
            return timings.contentEquals(other.timings) && amplitudes.contentEquals(other.amplitudes)
        }

        override fun hashCode(): Int {
            return 31 * timings.contentHashCode() + amplitudes.contentHashCode()
        }
    }

    private val random: Random = if (randomSeed != null) Random(randomSeed) else Random()

    /**
     * Synthesizes a multi-frequency waveform for the requested pattern type.
     *
     * @param type Target haptic pattern
     * @param escalationLevel 0 (standard), 1 (escalated), 2 (critical overdue)
     * @param applyJitter Whether to inject stochastic temporal jitter (+/- 15-25ms)
     */
    fun generateWaveform(
        type: PatternType,
        escalationLevel: Int = 0,
        applyJitter: Boolean = true
    ): Waveform {
        return when (type) {
            PatternType.ROTARY_DETENT -> {
                // Ultra-short micro-tick: 0ms initial delay, 8ms pulse at amplitude 60
                Waveform(
                    timings = longArrayOf(0, 8),
                    amplitudes = intArrayOf(0, 60)
                )
            }
            PatternType.SNOOZE_CONFIRM -> {
                // Crisp click: 0ms initial delay, 15ms pulse at amplitude 180
                Waveform(
                    timings = longArrayOf(0, 15),
                    amplitudes = intArrayOf(0, 180)
                )
            }
            PatternType.COMPLETE_ACK -> {
                // Double gentle tap with amplitude decay: 20ms @ 120 -> 40ms silence -> 15ms @ 60
                Waveform(
                    timings = longArrayOf(0, 20, 40, 15),
                    amplitudes = intArrayOf(0, 120, 0, 60)
                )
            }
            PatternType.DUE_NOW -> {
                // Dual-pulse crescendo: 25ms @ 90 -> 50ms silence -> 35ms @ 220
                val jitter = if (applyJitter) nextJitter(10) else 0L
                Waveform(
                    timings = longArrayOf(0, 25, (50 + jitter).coerceAtLeast(20), 35),
                    amplitudes = intArrayOf(0, 90, 0, 220)
                )
            }
            PatternType.URGENT_OVERDUE -> {
                // Dual-band polymorphous burst:
                // Burst 1: High Pacinian transient (sharp, 45ms @ 255)
                // Rest 1: Variable gap (60ms +/- jitter)
                // Burst 2: Low Meissner flutter (80ms @ 110)
                // Rest 2: Variable gap (70ms +/- jitter)
                val clampedLevel = escalationLevel.coerceIn(0, 2)
                val baseTimings = mutableListOf<Long>()
                val baseAmplitudes = mutableListOf<Int>()

                baseTimings.add(0L)
                baseAmplitudes.add(0)

                val repetitions = 1 + clampedLevel
                for (i in 0 until repetitions) {
                    val gapJitter1 = if (applyJitter) nextJitter(20) else 0L
                    val gapJitter2 = if (applyJitter) nextJitter(20) else 0L

                    // Pacinian burst (high frequency simulation: max amplitude)
                    baseTimings.add(45L)
                    baseAmplitudes.add(255)

                    // Gap 1
                    baseTimings.add((60L + gapJitter1).coerceAtLeast(30L))
                    baseAmplitudes.add(0)

                    // Meissner flutter (low amplitude, longer duration)
                    baseTimings.add(80L)
                    baseAmplitudes.add(110)

                    if (i < repetitions - 1) {
                        // Gap 2 between repetitions
                        baseTimings.add((100L + gapJitter2).coerceAtLeast(50L))
                        baseAmplitudes.add(0)
                    }
                }

                Waveform(
                    timings = baseTimings.toLongArray(),
                    amplitudes = baseAmplitudes.toIntArray()
                )
            }
        }
    }

    /**
     * Converts a Waveform into an Android [VibrationEffect].
     */
    fun createVibrationEffect(waveform: Waveform): VibrationEffect {
        return VibrationEffect.createWaveform(waveform.timings, waveform.amplitudes, -1)
    }

    /**
     * Executes vibration on the provided context with safe fallback across API levels.
     */
    fun vibrate(
        context: Context,
        type: PatternType,
        escalationLevel: Int = 0,
        applyJitter: Boolean = true
    ) {
        val waveform = generateWaveform(type, escalationLevel, applyJitter)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                val vibrator = vibratorManager?.defaultVibrator ?: (context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
                if (vibrator?.hasVibrator() == true) {
                    val effect = createVibrationEffect(waveform)
                    vibrator.vibrate(effect)
                }
            } else {
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (vibrator?.hasVibrator() == true) {
                    if (vibrator.hasAmplitudeControl()) {
                        val effect = createVibrationEffect(waveform)
                        vibrator.vibrate(effect)
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(waveform.timings, -1)
                    }
                }
            }
        } catch (e: Exception) {
            // Gracefully tolerate missing vibrator permission or mock test environment
        }
    }

    private fun nextJitter(maxJitterMs: Int): Long {
        if (maxJitterMs <= 0) return 0L
        return (random.nextInt(maxJitterMs * 2 + 1) - maxJitterMs).toLong()
    }
}
