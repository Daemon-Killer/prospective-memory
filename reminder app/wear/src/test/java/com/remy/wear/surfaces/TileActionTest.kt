package com.remy.wear.surfaces

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.tile.TileActionContracts
import com.remy.wear.surfaces.tile.TileActionHandler
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class TileActionTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao
    private lateinit var actionHandler: TileActionHandler
    private val testScope = TestScope()

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()
        actionHandler = TileActionHandler(context, dao, testScope)
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun createReminder(
        id: String,
        dueDate: Long,
        status: String = ReminderEntity.STATUS_PENDING,
        snoozeCount: Int = 0
    ): ReminderEntity = ReminderEntity(
        id = id,
        title = "Test Task $id",
        dueDate = dueDate,
        status = status,
        snoozeCount = snoozeCount,
        createdAt = 1000L,
        updatedAt = 1000L
    )

    @Test
    fun `test 01 - snooze 15m advances due date and updates sync status`() = testScope.runTest {
        val due = Instant.parse("2026-09-11T10:00:00Z").toEpochMilli()
        val now = Instant.parse("2026-09-11T10:05:00Z").toEpochMilli() // Overdue by 5m
        dao.upsert(createReminder("rem-1", due))

        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_SNOOZE_15M, "rem-1"
        )
        val result = actionHandler.executeAction(actionId, now)

        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.SnoozeSuccess::class.java)

        val updated = dao.getReminderById("rem-1")
        assertThat(updated).isNotNull()
        // T_base = max(10:05, 10:00) = 10:05. +15m = 10:20:00
        val expectedDue = Instant.parse("2026-09-11T10:20:00Z").toEpochMilli()
        assertThat(updated?.dueDate).isEqualTo(expectedDue)
        assertThat(updated?.snoozeCount).isEqualTo(1)
        assertThat(updated?.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(updated?.lastSnoozedAt).isEqualTo(now)
        assertThat(updated?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    @Test
    fun `test 02 - snooze 1h on future reminder extends from due date`() = testScope.runTest {
        val due = Instant.parse("2026-09-11T14:00:00Z").toEpochMilli()
        val now = Instant.parse("2026-09-11T13:00:00Z").toEpochMilli() // Proactive
        dao.upsert(createReminder("rem-2", due))

        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_SNOOZE_1H, "rem-2"
        )
        val result = actionHandler.executeAction(actionId, now)

        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.SnoozeSuccess::class.java)

        val updated = dao.getReminderById("rem-2")
        // T_base = max(13:00, 14:00) = 14:00. +1h = 15:00:00
        val expectedDue = Instant.parse("2026-09-11T15:00:00Z").toEpochMilli()
        assertThat(updated?.dueDate).isEqualTo(expectedDue)
        assertThat(updated?.snoozeCount).isEqualTo(1)
        assertThat(updated?.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(updated?.lastSnoozedAt).isEqualTo(now)
        assertThat(updated?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    @Test
    fun `test 03 - complete action marks reminder completed`() = testScope.runTest {
        val due = Instant.parse("2026-09-11T10:00:00Z").toEpochMilli()
        val now = Instant.parse("2026-09-11T10:01:00Z").toEpochMilli()
        dao.upsert(createReminder("rem-3", due))

        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_COMPLETE, "rem-3"
        )
        val result = actionHandler.executeAction(actionId, now)

        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.CompleteSuccess::class.java)

        val updated = dao.getReminderById("rem-3")
        assertThat(updated?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(updated?.completedAt).isEqualTo(now)
        assertThat(updated?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        // Verifying it is excluded from active reminders query
        val active = dao.getActiveReminders()
        assertThat(active).isEmpty()
    }

    @Test
    fun `test 04 - idempotent skip on already completed or deleted reminder`() = testScope.runTest {
        val due = Instant.parse("2026-09-11T10:00:00Z").toEpochMilli()
        val now = Instant.parse("2026-09-11T10:05:00Z").toEpochMilli()
        // Insert already completed reminder
        dao.upsert(createReminder("rem-4", due, status = ReminderEntity.STATUS_COMPLETED))

        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_SNOOZE_15M, "rem-4"
        )
        val result = actionHandler.executeAction(actionId, now)

        assertThat(result).isEqualTo(TileActionHandler.ActionResult.SkippedInactiveOrNotFound)
    }

    @Test
    fun `test 05 - idempotent skip on nonexistent reminder`() = testScope.runTest {
        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_SNOOZE_15M, "nonexistent-id"
        )
        val result = actionHandler.executeAction(actionId)

        assertThat(result).isEqualTo(TileActionHandler.ActionResult.SkippedInactiveOrNotFound)
    }

    @Test
    fun `test 06 - compound action ID parsing`() {
        val parsed = TileActionContracts.parseActionId("action_snooze_15m:uuid-1234")
        assertThat(parsed).isNotNull()
        assertThat(parsed?.prefix).isEqualTo("action_snooze_15m")
        assertThat(parsed?.reminderId).isEqualTo("uuid-1234")

        val invalid = TileActionContracts.parseActionId(null)
        assertThat(invalid).isNull()

        val blank = TileActionContracts.parseActionId("")
        assertThat(blank).isNull()
    }

    @Test
    fun `test 07 - fallback to nearest active reminder when ID missing`() = testScope.runTest {
        val due1 = Instant.parse("2026-09-11T10:00:00Z").toEpochMilli()
        val due2 = Instant.parse("2026-09-11T11:00:00Z").toEpochMilli()
        val now = Instant.parse("2026-09-11T09:00:00Z").toEpochMilli()

        dao.upsert(createReminder("rem-early", due1))
        dao.upsert(createReminder("rem-late", due2))

        // No ID specified in clickableId
        val result = actionHandler.executeAction(TileActionContracts.ACTION_PREFIX_COMPLETE, now)
        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.CompleteSuccess::class.java)

        val completed = dao.getReminderById("rem-early")
        assertThat(completed?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)

        val remaining = dao.getActiveReminders()
        assertThat(remaining).hasSize(1)
        assertThat(remaining.first().id).isEqualTo("rem-late")
    }

    @Test
    fun `test 08 - null or unrecognized action returns IgnoredNoAction`() = testScope.runTest {
        val nullResult = actionHandler.executeAction(null)
        assertThat(nullResult).isEqualTo(TileActionHandler.ActionResult.IgnoredNoAction)

        val unknownResult = actionHandler.executeAction("action_unknown:rem-1")
        assertThat(unknownResult).isEqualTo(TileActionHandler.ActionResult.IgnoredNoAction)
    }
}
