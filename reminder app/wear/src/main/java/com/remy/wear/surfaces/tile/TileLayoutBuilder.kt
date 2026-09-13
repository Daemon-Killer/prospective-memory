package com.remy.wear.surfaces.tile

import android.content.Context
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.Column
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.LayoutElementBuilders.Spacer
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.TimelineBuilders.Timeline
import androidx.wear.protolayout.TimelineBuilders.TimelineEntry
import androidx.wear.protolayout.material.Button
import androidx.wear.protolayout.material.ButtonColors
import androidx.wear.protolayout.material.ChipColors
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.MultiButtonLayout
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.TileBuilders.Tile
import com.remy.wear.data.local.ReminderEntity
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Visual design system tokens for ProtoLayout 1.2 Swiss Void Tiles.
 */
object RemyTileTheme {
    // Pure AMOLED background (0 mA pixel current)
    const val COLOR_VOID = 0xFF000000.toInt()

    // Primary Swiss typography
    const val COLOR_WHITE = 0xFFFFFFFF.toInt()

    // International Orange - overdue alerts, urgency markers, and primary highlight
    const val COLOR_ORANGE = 0xFFFF4500.toInt()

    // Dark slate surfaces for tactile button backgrounds
    const val COLOR_SURFACE_CHIP = 0xFF222222.toInt()
    const val COLOR_SURFACE_CARD = 0xFF141414.toInt()

    // Secondary typography & subtle accents
    const val COLOR_TEXT_SECONDARY = 0xFF9E9E9E.toInt()
    const val COLOR_TEXT_MUTED = 0xFF666666.toInt()

    // Complete action affirmative accent
    const val COLOR_COMPLETE = 0xFFFFFFFF.toInt()

    // Dimension tokens (dp)
    const val CONTENT_WIDTH_DP = 165f
    const val BUTTON_SIZE_DP = 42f
    const val SPACER_TINY_DP = 4f
    const val SPACER_SMALL_DP = 8f
    const val CHIP_CORNER_RADIUS_DP = 21f
}

/**
 * Pure declarative layout builder for ProtoLayout 1.2 Remy Reminders Tiles.
 *
 * Fully decoupled from TileService lifecycle, enabling 100% automated Robolectric testing.
 */
object TileLayoutBuilder {

    const val ID_ACTION_SNOOZE_15M = "action_snooze_15m"
    const val ID_ACTION_SNOOZE_1H = "action_snooze_1h"
    const val ID_ACTION_COMPLETE = "action_complete"
    const val ID_ACTION_OPEN_APP = "action_open_app"
    const val ID_ACTION_VOICE_CAPTURE = "action_voice_capture"

    private val TIME_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    /**
     * Builds the complete Tile object containing the timeline and freshness window.
     */
    fun renderTile(
        context: Context,
        reminders: List<ReminderEntity>,
        deviceParams: DeviceParameters,
        nowMillis: Long = System.currentTimeMillis()
    ): Tile {
        val rootLayout = buildTileLayout(context, reminders, deviceParams, nowMillis)

        val timeline = Timeline.Builder()
            .addTimelineEntry(
                TimelineEntry.Builder()
                    .setLayout(LayoutElementBuilders.Layout.Builder().setRoot(rootLayout).build())
                    .build()
            )
            .build()

        return Tile.Builder()
            .setTileTimeline(timeline)
            .setFreshnessIntervalMillis(60_000L) // 1 minute auto-refresh
            .build()
    }

    /**
     * Builds the root LayoutElement based on reminder state.
     */
    fun buildTileLayout(
        context: Context,
        reminders: List<ReminderEntity>,
        deviceParams: DeviceParameters,
        nowMillis: Long = System.currentTimeMillis()
    ): LayoutElement {
        return if (reminders.isEmpty()) {
            buildEmptyStateLayout(context, deviceParams)
        } else {
            buildActiveStateLayout(context, reminders, deviceParams, nowMillis)
        }
    }

    /**
     * Convenience helper matching layout spec interface: buildRootLayout.
     */
    fun buildRootLayout(
        context: Context,
        reminder: ReminderEntity?,
        deviceConfig: DeviceParameters,
        nowMillis: Long = System.currentTimeMillis()
    ): LayoutElement {
        return if (reminder == null) {
            buildEmptyStateLayout(context, deviceConfig)
        } else {
            buildActiveStateLayout(context, listOf(reminder), deviceConfig, nowMillis)
        }
    }

    /**
     * Convenience helper matching layout spec interface: buildEmptyLayout.
     */
    fun buildEmptyLayout(
        context: Context,
        deviceConfig: DeviceParameters
    ): LayoutElement {
        return buildEmptyStateLayout(context, deviceConfig)
    }

    /**
     * Active State: Primary reminder card with countdown, multi-task count, and triage buttons.
     */
    private fun buildActiveStateLayout(
        context: Context,
        reminders: List<ReminderEntity>,
        deviceParams: DeviceParameters,
        nowMillis: Long
    ): PrimaryLayout {
        val primaryReminder = reminders.first()
        val isOverdue = nowMillis >= primaryReminder.dueDate

        // 1. Primary Top Label: Urgency Cues
        val labelText = if (isOverdue) "OVERDUE" else "NEXT REMINDER"
        val labelColor = if (isOverdue) RemyTileTheme.COLOR_ORANGE else RemyTileTheme.COLOR_TEXT_SECONDARY
        val primaryLabel = Text.Builder(context, labelText)
            .setTypography(Typography.TYPOGRAPHY_CAPTION1)
            .setColor(argb(labelColor))
            .build()

        // 2. Center Content: Swiss Typography Card
        val contentColumn = Column.Builder()
            .setWidth(dp(RemyTileTheme.CONTENT_WIDTH_DP))
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(
                // Reminder Title (max 2 lines with ellipsis)
                Text.Builder(context, primaryReminder.title)
                    .setTypography(Typography.TYPOGRAPHY_TITLE3)
                    .setColor(argb(RemyTileTheme.COLOR_WHITE))
                    .setMaxLines(2)
                    .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
                    .setOverflow(LayoutElementBuilders.TEXT_OVERFLOW_ELLIPSIZE)
                    .build()
            )
            .addContent(Spacer.Builder().setHeight(dp(RemyTileTheme.SPACER_TINY_DP)).build())
            .addContent(
                // Due Countdown Ledger
                Text.Builder(context, formatDueCountdown(primaryReminder.dueDate, nowMillis))
                    .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                    .setColor(argb(if (isOverdue) RemyTileTheme.COLOR_ORANGE else RemyTileTheme.COLOR_WHITE))
                    .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                    .build()
            )

        // Add secondary multi-task indicator if > 1 task pending
        if (reminders.size > 1) {
            contentColumn
                .addContent(Spacer.Builder().setHeight(dp(RemyTileTheme.SPACER_TINY_DP)).build())
                .addContent(
                    Text.Builder(context, "+${reminders.size - 1} MORE QUEUED")
                        .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                        .setColor(argb(RemyTileTheme.COLOR_TEXT_MUTED))
                        .build()
                )
        }

        // 3. Action Buttons Row: +15m, +1h, Complete
        val actionRow = MultiButtonLayout.Builder()
            .addButtonContent(
                createActionButton(
                    context = context,
                    label = "+15m",
                    clickableId = "$ID_ACTION_SNOOZE_15M:${primaryReminder.id}",
                    contentDescription = "Snooze 15 minutes",
                    bgColor = RemyTileTheme.COLOR_SURFACE_CHIP,
                    textColor = RemyTileTheme.COLOR_WHITE
                )
            )
            .addButtonContent(
                createActionButton(
                    context = context,
                    label = "+1h",
                    clickableId = "$ID_ACTION_SNOOZE_1H:${primaryReminder.id}",
                    contentDescription = "Snooze 1 hour",
                    bgColor = RemyTileTheme.COLOR_SURFACE_CHIP,
                    textColor = RemyTileTheme.COLOR_WHITE
                )
            )
            .addButtonContent(
                createActionButton(
                    context = context,
                    label = "✓",
                    clickableId = "$ID_ACTION_COMPLETE:${primaryReminder.id}",
                    contentDescription = "Mark complete",
                    bgColor = RemyTileTheme.COLOR_ORANGE,
                    textColor = RemyTileTheme.COLOR_WHITE
                )
            )
            .build()

        return PrimaryLayout.Builder(deviceParams)
            .setResponsiveContentInsetEnabled(true)
            .setPrimaryLabelTextContent(primaryLabel)
            .setContent(contentColumn.build())
            .setPrimaryChipContent(actionRow)
            .build()
    }

    /**
     * Empty State: Swiss Void editorial card with quick-launch action.
     */
    private fun buildEmptyStateLayout(
        context: Context,
        deviceParams: DeviceParameters
    ): PrimaryLayout {
        val primaryLabel = Text.Builder(context, "REMY REMINDERS")
            .setTypography(Typography.TYPOGRAPHY_CAPTION1)
            .setColor(argb(RemyTileTheme.COLOR_TEXT_SECONDARY))
            .build()

        val contentColumn = Column.Builder()
            .setWidth(dp(RemyTileTheme.CONTENT_WIDTH_DP))
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(
                Text.Builder(context, "ALL CLEAR")
                    .setTypography(Typography.TYPOGRAPHY_TITLE2)
                    .setColor(argb(RemyTileTheme.COLOR_WHITE))
                    .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                    .setMultilineAlignment(LayoutElementBuilders.TEXT_ALIGN_CENTER)
                    .build()
            )
            .addContent(Spacer.Builder().setHeight(dp(RemyTileTheme.SPACER_TINY_DP)).build())
            .addContent(
                Text.Builder(context, "0 TASKS PENDING")
                    .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                    .setColor(argb(RemyTileTheme.COLOR_TEXT_MUTED))
                    .build()
            )
            .build()

        val launchAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(context.packageName)
                    .setClassName("com.remy.wear.MainActivity")
                    .build()
            )
            .build()

        val openAppChip = CompactChip.Builder(
            context,
            "OPEN REMY",
            ModifiersBuilders.Clickable.Builder()
                .setId(ID_ACTION_OPEN_APP)
                .setOnClick(launchAction)
                .build(),
            deviceParams
        )
            .setChipColors(
                ChipColors(
                    argb(RemyTileTheme.COLOR_SURFACE_CHIP),
                    argb(RemyTileTheme.COLOR_WHITE)
                )
            )
            .build()

        return PrimaryLayout.Builder(deviceParams)
            .setResponsiveContentInsetEnabled(true)
            .setPrimaryLabelTextContent(primaryLabel)
            .setContent(contentColumn)
            .setPrimaryChipContent(openAppChip)
            .build()
    }

    /**
     * Builds a quick voice ingress chip that launches speech recognition directly.
     */
    fun buildVoiceCaptureChip(
        context: Context,
        deviceParams: DeviceParameters
    ): CompactChip {
        val voiceAction = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(
                ActionBuilders.AndroidActivity.Builder()
                    .setPackageName(context.packageName)
                    .setClassName("com.remy.wear.MainActivity")
                    .build()
            )
            .build()

        return CompactChip.Builder(
            context,
            "+ VOICE",
            ModifiersBuilders.Clickable.Builder()
                .setId(ID_ACTION_VOICE_CAPTURE)
                .setOnClick(voiceAction)
                .build(),
            deviceParams
        )
            .setChipColors(
                ChipColors(
                    argb(RemyTileTheme.COLOR_SURFACE_CHIP),
                    argb(RemyTileTheme.COLOR_WHITE)
                )
            )
            .build()
    }

    /**
     * Helper to construct compact action buttons with tactile click targets.
     */
    private fun createActionButton(
        context: Context,
        label: String,
        clickableId: String,
        contentDescription: String,
        bgColor: Int,
        textColor: Int
    ): LayoutElement {
        val clickable = ModifiersBuilders.Clickable.Builder()
            .setId(clickableId)
            .setOnClick(ActionBuilders.LoadAction.Builder().build())
            .build()

        return Button.Builder(context, clickable)
            .setTextContent(label)
            .setContentDescription(contentDescription)
            .setButtonColors(ButtonColors(argb(bgColor), argb(textColor)))
            .build()
    }

    /**
     * Formats due countdown string with clean tabular precision.
     */
    fun formatDueCountdown(dueDateMillis: Long, nowMillis: Long): String {
        val diffMillis = dueDateMillis - nowMillis
        val diffMinutes = diffMillis / 60_000L

        return when {
            diffMinutes < 0 -> "+${-diffMinutes}m OVERDUE"
            diffMinutes == 0L -> "DUE NOW"
            diffMinutes < 60L -> "IN ${diffMinutes}m"
            diffMinutes < 1440L -> {
                val hours = diffMinutes / 60L
                val mins = diffMinutes % 60L
                if (mins == 0L) "IN ${hours}h" else "IN ${hours}h ${mins}m"
            }
            else -> {
                val timeStr = Instant.ofEpochMilli(dueDateMillis)
                    .atZone(ZoneId.systemDefault())
                    .format(TIME_FORMATTER)
                "TOMORROW $timeStr"
            }
        }
    }
}

/**
 * Type alias preserving compatibility with layout spec naming.
 */
typealias RemyTileRenderer = TileLayoutBuilder
