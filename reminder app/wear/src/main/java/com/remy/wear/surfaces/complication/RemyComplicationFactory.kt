package com.remy.wear.surfaces.complication

import android.app.PendingIntent
import androidx.wear.watchface.complications.data.ColorRamp
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.CountUpTimeReference
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import com.remy.wear.data.local.ReminderEntity
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Pure transformation engine producing compliant Wear OS 5 ComplicationData payloads.
 * Decoupled from Android Service lifecycle for deterministic unit testing.
 */
object RemyComplicationFactory {

    // Color tokens matching Swiss Void specification
    const val COLOR_INTERNATIONAL_ORANGE = 0xFFFF4500.toInt()
    const val COLOR_SWISS_WHITE = 0xFFFFFFFF.toInt()
    const val COLOR_SLATE_MUTED = 0xFF555555.toInt()
    const val COLOR_SLATE_DARK = 0xFF222222.toInt()

    private const val MINIMUM_DURATION_SPAN_MS = 60_000L

    /**
     * Builds a [ShortTextComplicationData] payload for active countdown, overdue alert, or all-clear.
     */
    fun buildShortTextComplication(
        reminder: ReminderEntity?,
        nowMillis: Long,
        tapAction: PendingIntent? = null
    ): ShortTextComplicationData {
        if (reminder == null) {
            val clearText = PlainComplicationText.Builder("✓").build()
            val clearTitle = PlainComplicationText.Builder("CLEAR").build()
            val clearDesc = PlainComplicationText.Builder("No active reminders, memory stack clear").build()

            return ShortTextComplicationData.Builder(
                text = clearText,
                contentDescription = clearDesc
            )
                .setTitle(clearTitle)
                .setTapAction(tapAction)
                .build()
        }

        val isOverdue = nowMillis > reminder.dueDate
        val targetInstant = Instant.ofEpochMilli(reminder.dueDate)

        val complicationText = if (isOverdue) {
            // Count-up timer from dueDate to now (e.g. "+14m")
            TimeDifferenceComplicationText.Builder(
                TimeDifferenceStyle.SHORT_DUAL_UNIT,
                CountUpTimeReference(targetInstant)
            )
                .setMinimumTimeUnit(TimeUnit.MINUTES)
                .setText("+^1")
                .build()
        } else {
            // Dynamic ticking countdown to dueDate without waking CPU
            TimeDifferenceComplicationText.Builder(
                TimeDifferenceStyle.SHORT_DUAL_UNIT,
                CountDownTimeReference(targetInstant)
            )
                .setMinimumTimeUnit(TimeUnit.MINUTES)
                .setText("^1")
                .build()
        }

        val titleText = PlainComplicationText.Builder(if (isOverdue) "OVERDUE" else "REMY").build()
        val contentDesc = PlainComplicationText.Builder(
            if (isOverdue) "Overdue reminder: ${reminder.title}" else "Reminder: ${reminder.title}"
        ).build()

        return ShortTextComplicationData.Builder(
            text = complicationText,
            contentDescription = contentDesc
        )
            .setTitle(titleText)
            .setTapAction(tapAction)
            .build()
    }

    /**
     * Builds a [RangedValueComplicationData] payload representing elapsed time proportion.
     */
    fun buildRangedValueComplication(
        reminder: ReminderEntity?,
        nowMillis: Long,
        tapAction: PendingIntent? = null
    ): RangedValueComplicationData {
        if (reminder == null) {
            val emptyText = PlainComplicationText.Builder("0").build()
            val emptyTitle = PlainComplicationText.Builder("CLEAR").build()
            val emptyDesc = PlainComplicationText.Builder("No active reminders, progress 0%").build()

            return RangedValueComplicationData.Builder(
                value = 0f,
                min = 0f,
                max = 100f,
                contentDescription = emptyDesc
            )
                .setText(emptyText)
                .setTitle(emptyTitle)
                .setValueType(RangedValueComplicationData.TYPE_PERCENTAGE)
                .setColorRamp(ColorRamp(intArrayOf(COLOR_SLATE_DARK, COLOR_SLATE_MUTED), false))
                .setTapAction(tapAction)
                .build()
        }

        val totalDurationMs = maxOf(MINIMUM_DURATION_SPAN_MS, reminder.dueDate - reminder.createdAt)
        val elapsedMs = maxOf(0L, nowMillis - reminder.createdAt)
        val progressRatio = elapsedMs.toFloat() / totalDurationMs.toFloat()
        val clampedProgress = progressRatio.coerceIn(0f, 1f)
        val percentageValue = clampedProgress * 100f

        val isOverdue = nowMillis > reminder.dueDate

        val centerText = if (isOverdue) {
            val overdueMinutes = maxOf(1L, (nowMillis - reminder.dueDate) / 60_000L)
            PlainComplicationText.Builder("+${overdueMinutes}m").build()
        } else {
            val remainingMinutes = maxOf(0L, (reminder.dueDate - nowMillis) / 60_000L)
            PlainComplicationText.Builder("${remainingMinutes}m").build()
        }

        val titleText = PlainComplicationText.Builder(if (isOverdue) "OVERDUE" else "REMY").build()
        val contentDesc = PlainComplicationText.Builder(
            if (isOverdue) "Overdue progress: ${reminder.title}" else "Progress: ${reminder.title}"
        ).build()

        val colorRamp = if (isOverdue) {
            // International Orange accent for overdue urgency
            ColorRamp(intArrayOf(COLOR_INTERNATIONAL_ORANGE, COLOR_INTERNATIONAL_ORANGE), false)
        } else {
            // Swiss Slate to White active progress track
            ColorRamp(intArrayOf(COLOR_SLATE_MUTED, COLOR_SWISS_WHITE), true)
        }

        return RangedValueComplicationData.Builder(
            value = percentageValue,
            min = 0f,
            max = 100f,
            contentDescription = contentDesc
        )
            .setText(centerText)
            .setTitle(titleText)
            .setValueType(RangedValueComplicationData.TYPE_PERCENTAGE)
            .setColorRamp(colorRamp)
            .setTapAction(tapAction)
            .build()
    }

    /**
     * Preview data for watch face configuration editors.
     */
    fun buildPreviewData(type: ComplicationType, tapAction: PendingIntent? = null): ComplicationData? {
        val previewTitle = PlainComplicationText.Builder("REMY").build()
        val previewText = PlainComplicationText.Builder("15m").build()
        val previewDesc = PlainComplicationText.Builder("Remy Reminders Preview").build()

        return when (type) {
            ComplicationType.SHORT_TEXT -> {
                ShortTextComplicationData.Builder(
                    text = previewText,
                    contentDescription = previewDesc
                )
                    .setTitle(previewTitle)
                    .setTapAction(tapAction)
                    .build()
            }
            ComplicationType.RANGED_VALUE -> {
                RangedValueComplicationData.Builder(
                    value = 75f,
                    min = 0f,
                    max = 100f,
                    contentDescription = previewDesc
                )
                    .setText(previewText)
                    .setTitle(previewTitle)
                    .setValueType(RangedValueComplicationData.TYPE_PERCENTAGE)
                    .setColorRamp(ColorRamp(intArrayOf(COLOR_SLATE_MUTED, COLOR_SWISS_WHITE), true))
                    .setTapAction(tapAction)
                    .build()
            }
            else -> null
        }
    }
}
