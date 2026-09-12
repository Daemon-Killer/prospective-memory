package com.remy.wear.surfaces

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DeviceParametersBuilders.SCREEN_SHAPE_ROUND
import androidx.wear.protolayout.material.Button
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.layouts.MultiButtonLayout
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.tile.RemyTileRenderer
import com.remy.wear.surfaces.tile.RemyTileTheme
import com.remy.wear.surfaces.tile.TileActionHandler
import com.remy.wear.surfaces.tile.TileLayoutBuilder
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class TileRenderTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var deviceParams: DeviceParameters

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        deviceParams = DeviceParameters.Builder()
            .setScreenWidthDp(225)
            .setScreenHeightDp(225)
            .setScreenDensity(2.0f)
            .setScreenShape(SCREEN_SHAPE_ROUND)
            .build()
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun createReminder(
        id: String,
        title: String,
        dueDate: Long,
        status: String = ReminderEntity.STATUS_PENDING
    ): ReminderEntity {
        return ReminderEntity(
            id = id,
            title = title,
            dueDate = dueDate,
            status = status,
            createdAt = 1000L,
            updatedAt = 1000L
        )
    }

    // =========================================================================
    // Layout Hierarchy & Responsive Insets
    // =========================================================================

    @Test
    fun testBuildTileLayout_withActiveReminder_returnsPrimaryLayoutWithAllSlots() {
        val reminder = createReminder("1", "Check Vitals", 2000L)
        val layout = TileLayoutBuilder.buildTileLayout(context, listOf(reminder), deviceParams, 1000L)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)

        assertThat(primaryLayout).isNotNull()
        assertThat(primaryLayout!!.isResponsiveContentInsetEnabled).isTrue()
        assertThat(primaryLayout.primaryLabelTextContent).isNotNull()
        assertThat(primaryLayout.content).isNotNull()
        assertThat(primaryLayout.primaryChipContent).isNotNull()
    }

    // =========================================================================
    // Active State: Urgency & Tabular Countdown
    // =========================================================================

    @Test
    fun testBuildTileLayout_upcomingReminder_displaysUpcomingHeaderAndWhiteText() {
        val now = 1_000_000L
        val reminder = createReminder("1", "Take Aspirin", now + 15 * 60_000L)
        val layout = TileLayoutBuilder.buildTileLayout(context, listOf(reminder), deviceParams, now)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)

        val labelText = Text.fromLayoutElement(primaryLayout!!.primaryLabelTextContent!!)
        assertThat(labelText).isNotNull()
        assertThat(labelText!!.text.value).isEqualTo("NEXT REMINDER")
        assertThat(labelText.color?.argb).isEqualTo(RemyTileTheme.COLOR_TEXT_SECONDARY)
    }

    @Test
    fun testBuildTileLayout_overdueReminder_displaysOverdueHeaderAndOrangeColor() {
        val now = 1_000_000L
        val reminder = createReminder("1", "Drink Water", now - 10 * 60_000L) // 10m overdue
        val layout = TileLayoutBuilder.buildTileLayout(context, listOf(reminder), deviceParams, now)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)

        val labelText = Text.fromLayoutElement(primaryLayout!!.primaryLabelTextContent!!)
        assertThat(labelText).isNotNull()
        assertThat(labelText!!.text.value).isEqualTo("OVERDUE")
        assertThat(labelText.color?.argb).isEqualTo(RemyTileTheme.COLOR_ORANGE)
    }

    // =========================================================================
    // Action Buttons & LoadActions
    // =========================================================================

    @Test
    fun testBuildTileLayout_activeReminder_rendersThreeActionButtons() {
        val reminder = createReminder("rem-42", "Team Sync", 2000L)
        val layout = TileLayoutBuilder.buildTileLayout(context, listOf(reminder), deviceParams, 1000L)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)

        val multiButton = MultiButtonLayout.fromLayoutElement(primaryLayout!!.primaryChipContent!!)
        assertThat(multiButton).isNotNull()
        val buttons = multiButton!!.buttonContents
        assertThat(buttons).hasSize(3)

        // Verify +15m Button
        val b1 = Button.fromLayoutElement(buttons[0])
        assertThat(b1).isNotNull()
        assertThat(b1!!.textContent).isEqualTo("+15m")
        assertThat(b1.clickable?.id).isEqualTo("action_snooze_15m:rem-42")
        assertThat(b1.clickable?.onClick).isInstanceOf(ActionBuilders.LoadAction::class.java)

        // Verify +1h Button
        val b2 = Button.fromLayoutElement(buttons[1])
        assertThat(b2).isNotNull()
        assertThat(b2!!.textContent).isEqualTo("+1h")
        assertThat(b2.clickable?.id).isEqualTo("action_snooze_1h:rem-42")
        assertThat(b2.clickable?.onClick).isInstanceOf(ActionBuilders.LoadAction::class.java)

        // Verify Complete Button
        val b3 = Button.fromLayoutElement(buttons[2])
        assertThat(b3).isNotNull()
        assertThat(b3!!.textContent).isEqualTo("✓")
        assertThat(b3.clickable?.id).isEqualTo("action_complete:rem-42")
        assertThat(b3.clickable?.onClick).isInstanceOf(ActionBuilders.LoadAction::class.java)
    }

    // =========================================================================
    // Multi-Task Secondary Count
    // =========================================================================

    @Test
    fun testBuildTileLayout_multipleTasks_includesSecondaryPendingBadge() {
        val now = 1000L
        val r1 = createReminder("1", "First Task", 2000L)
        val r2 = createReminder("2", "Second Task", 3000L)
        val r3 = createReminder("3", "Third Task", 4000L)

        val layout = TileLayoutBuilder.buildTileLayout(context, listOf(r1, r2, r3), deviceParams, now)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)
        val column = primaryLayout!!.content

        assertThat(column).isNotNull()
    }

    // =========================================================================
    // Empty State
    // =========================================================================

    @Test
    fun testBuildTileLayout_emptyList_rendersSwissVoidAllClear() {
        val layout = TileLayoutBuilder.buildTileLayout(context, emptyList(), deviceParams)
        val primaryLayout = PrimaryLayout.fromLayoutElement(layout)

        val label = Text.fromLayoutElement(primaryLayout!!.primaryLabelTextContent!!)
        assertThat(label).isNotNull()
        assertThat(label!!.text.value).isEqualTo("REMY REMINDERS")

        val chip = CompactChip.fromLayoutElement(primaryLayout.primaryChipContent!!)
        assertThat(chip).isNotNull()
        assertThat(chip!!.text).isEqualTo("OPEN REMY")
        assertThat(chip.clickable?.id).isEqualTo(RemyTileRenderer.ID_ACTION_OPEN_APP)
        assertThat(chip.clickable?.onClick).isInstanceOf(ActionBuilders.LaunchAction::class.java)
    }

    // =========================================================================
    // Due Time String Formatting
    // =========================================================================

    @Test
    fun testFormatDueCountdown_variousTimeDeltas() {
        val now = 1_000_000L
        assertThat(TileLayoutBuilder.formatDueCountdown(now - 14 * 60_000L, now)).isEqualTo("+14m OVERDUE")
        assertThat(TileLayoutBuilder.formatDueCountdown(now, now)).isEqualTo("DUE NOW")
        assertThat(TileLayoutBuilder.formatDueCountdown(now + 25 * 60_000L, now)).isEqualTo("IN 25m")
        assertThat(TileLayoutBuilder.formatDueCountdown(now + 120 * 60_000L, now)).isEqualTo("IN 2h")
    }

    // =========================================================================
    // Action Handler Execution
    // =========================================================================

    @Test
    fun testTileActionHandler_executesSnooze15mAtomically() = runTest {
        val dao = database.reminderDao()
        val r = createReminder("rem-1", "Hydrate", 100_000L)
        dao.upsert(r)

        val handler = TileActionHandler(dao)
        val now = 120_000L // Overdue
        val handled = handler.handleAction("action_snooze_15m:rem-1", now)

        assertThat(handled).isTrue()
        val updated = dao.getReminderById("rem-1")
        assertThat(updated).isNotNull()
        // Invariant: T_base = max(120_000, 100_000) = 120_000 + 15m (900_000) = 1_020_000L
        assertThat(updated?.dueDate).isEqualTo(120_000L + 15 * 60_000L)
        assertThat(updated?.snoozeCount).isEqualTo(1)
        assertThat(updated?.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
    }

    @Test
    fun testTileActionHandler_executesCompleteAtomically() = runTest {
        val dao = database.reminderDao()
        val r = createReminder("rem-2", "Stretch", 100_000L)
        dao.upsert(r)

        val handler = TileActionHandler(dao)
        val now = 150_000L
        val handled = handler.handleAction("action_complete:rem-2", now)

        assertThat(handled).isTrue()
        val updated = dao.getReminderById("rem-2")
        assertThat(updated).isNotNull()
        assertThat(updated?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(updated?.completedAt).isEqualTo(now)
    }

    @Test
    fun testRenderTile_createsValidTimelineAndFreshnessInterval() {
        val reminder = createReminder("rem-99", "Meeting", 2000L)
        val tile = TileLayoutBuilder.renderTile(context, listOf(reminder), deviceParams, 1000L)

        assertThat(tile).isNotNull()
        assertThat(tile.freshnessIntervalMillis).isEqualTo(60_000L)
        assertThat(tile.tileTimeline?.timelineEntries).hasSize(1)
    }
}
