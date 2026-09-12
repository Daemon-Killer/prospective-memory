package com.remy.wear

import android.content.Context
import android.graphics.Color
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.domain.SnoozeEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.atomic.AtomicInteger

/**
 * Adversarial Stress & Concurrency Test Battery for Milestone 1:
 * Swiss Void Wear OS Launcher Activity (MainActivity.kt).
 *
 * Authored by Empirical Challenger 1.
 * Stress-tests:
 * 1. Rapid multiple clicks on snooze (+15m) or complete on the same reminder.
 * 2. Dynamic state transitions: 0 reminders (empty state) -> 1 reminder -> empty state (and high frequency oscillation).
 * 3. Overdue tasks vs future tasks vs tasks due right now (including boundary millisecond tests).
 * 4. Reactive UI updates when database is modified externally (e.g. background sync or tile).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class MainActivityAdversarialStressTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()
        MainActivity.testDaoOverride = dao
        MainActivity.clockOverride = null
        MainActivity.surfaceNotificationListener = null
    }

    @After
    fun tearDown() {
        MainActivity.testDaoOverride = null
        MainActivity.clockOverride = null
        MainActivity.surfaceNotificationListener = null
        database.close()
    }

    private fun createReminder(
        id: String,
        title: String,
        dueDate: Long,
        status: String = ReminderEntity.STATUS_PENDING,
        snoozeCount: Int = 0,
        createdAt: Long = 1_000_000L,
        updatedAt: Long = 1_000_000L
    ): ReminderEntity {
        return ReminderEntity(
            id = id,
            title = title,
            dueDate = dueDate,
            status = status,
            snoozeCount = snoozeCount,
            createdAt = createdAt,
            updatedAt = updatedAt,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        )
    }

    private fun flushRoomAndMainLooper() {
        database.invalidationTracker.refreshVersionsSync()
        shadowOf(Looper.getMainLooper()).idle()
        ShadowLooper.idleMainLooper()
    }

    // =========================================================================
    // Dimension 1: Rapid Multiple Clicks & Concurrency Stress
    // =========================================================================

    @Test
    fun rapidMultipleSnoozeClicks_preservesDatabaseIntegrityAndIncrementsSnooze() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val reminder = createReminder(
            id = "stress-snooze-1",
            title = "Concurrency Snooze Target",
            dueDate = now + 60_000L // 1 minute from now
        )
        dao.upsert(reminder)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        // Render card
        activity.renderReminders(listOf(reminder))

        val notificationCounter = AtomicInteger(0)
        MainActivity.surfaceNotificationListener = {
            notificationCounter.incrementAndGet()
        }

        // Simulate 10 rapid clicks on the snooze quick action
        val clickJobs = (1..10).map {
            activity.snoozeReminder(reminder)
        }
        clickJobs.joinAll()
        flushRoomAndMainLooper()

        // Verify DB record survived without corruption
        val updated = dao.getReminderById("stress-snooze-1")
        assertThat(updated).isNotNull()
        assertThat(updated!!.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(updated.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(updated.snoozeCount).isEqualTo(10) // 10 atomic increments
        assertThat(notificationCounter.get()).isEqualTo(10)
    }

    @Test
    fun rapidMultipleCompleteClicks_isIdempotentAndRemovesCard() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val reminder = createReminder(
            id = "stress-complete-1",
            title = "Concurrency Complete Target",
            dueDate = now + 300_000L
        )
        dao.upsert(reminder)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        // Wait for initial render
        activity.renderReminders(listOf(reminder))

        val notificationCounter = AtomicInteger(0)
        MainActivity.surfaceNotificationListener = {
            notificationCounter.incrementAndGet()
        }

        // Simulate 10 rapid clicks on Complete
        val completeJobs = (1..10).map {
            activity.completeReminder(reminder)
        }
        completeJobs.joinAll()
        flushRoomAndMainLooper()

        // Verify DB record is completed
        val updated = dao.getReminderById("stress-complete-1")
        assertThat(updated).isNotNull()
        assertThat(updated!!.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(updated.completedAt).isEqualTo(now)
        assertThat(updated.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        // After completion, observeActiveReminders filters it out, so empty state should be displayed
        var attempts = 0
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        while (remindersContainer.childCount > 0 && attempts < 20) {
            Thread.sleep(25)
            flushRoomAndMainLooper()
            attempts++
        }

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersContainer.childCount).isEqualTo(0)
    }

    @Test
    fun concurrentSnoozeAndCompleteClicks_handlesRaceConditionWithoutCrash() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val reminder = createReminder(
            id = "stress-race-1",
            title = "Race Condition Reminder",
            dueDate = now + 600_000L
        )
        dao.upsert(reminder)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        // Dispatch 10 concurrent snoozes and 10 concurrent completes interleaved
        val jobs = (1..10).flatMap {
            listOf(
                activity.snoozeReminder(reminder),
                activity.completeReminder(reminder)
            )
        }
        jobs.joinAll()
        flushRoomAndMainLooper()

        // Database must remain in a valid deterministic state (either completed or snoozed)
        val updated = dao.getReminderById("stress-race-1")
        assertThat(updated).isNotNull()
        assertThat(updated!!.status).isIn(listOf(ReminderEntity.STATUS_COMPLETED, ReminderEntity.STATUS_SNOOZED))
        assertThat(updated.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    // =========================================================================
    // Dimension 2: State Transitions (Empty -> Active -> Empty)
    // =========================================================================

    @Test
    fun dynamicLifecycleTransitions_emptyToActiveToEmpty() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        val remindersScrollView = activity.findViewById<ScrollView>(R.id.reminders_scroll_view)
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val emptyIcon = activity.findViewById<TextView>(R.id.empty_icon)
        val emptyText = activity.findViewById<TextView>(R.id.empty_text)

        // Phase 1: Initially 0 reminders -> Empty State Visible
        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.GONE)
        assertThat(remindersContainer.childCount).isEqualTo(0)
        assertThat(emptyIcon.text.toString()).isEqualTo("✓")
        assertThat(emptyText.text.toString()).isEqualTo(context.getString(R.string.no_active_reminders))

        // Phase 2: Insert 1 active reminder into Room DB
        val item = createReminder(
            id = "transition-item-1",
            title = "Doctor Consultation",
            dueDate = now + 1_800_000L // +30m
        )
        dao.upsert(item)

        var attempts = 0
        while (remindersContainer.childCount == 0 && attempts < 25) {
            Thread.sleep(25)
            flushRoomAndMainLooper()
            attempts++
        }

        // UI transitions: Empty State Hidden, Reminders ScrollView Visible
        assertThat(emptyStateView.visibility).isEqualTo(View.GONE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersContainer.childCount).isEqualTo(1)

        val card = remindersContainer.getChildAt(0)
        val titleView = card.findViewById<TextView>(R.id.reminder_title)
        assertThat(titleView.text.toString()).isEqualTo("Doctor Consultation")

        // Phase 3: Complete the 1 reminder in DB
        dao.completeReminder("transition-item-1", now)

        attempts = 0
        while (remindersContainer.childCount > 0 && attempts < 25) {
            Thread.sleep(25)
            flushRoomAndMainLooper()
            attempts++
        }

        // UI transitions back to Empty State
        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.GONE)
        assertThat(remindersContainer.childCount).isEqualTo(0)
    }

    @Test
    fun highFrequencyOscillation_zeroToOneToMultipleToZero_noViewLeaksOrGhosts() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        val remindersScrollView = activity.findViewById<ScrollView>(R.id.reminders_scroll_view)

        // Repeat 5 oscillation cycles: 0 -> 1 -> 3 -> 0
        for (cycle in 1..5) {
            // Step A: Insert 1
            val remA = createReminder("osc-a-$cycle", "Cycle $cycle Task A", now + 60_000L)
            dao.upsert(remA)
            waitForCondition { remindersContainer.childCount == 1 }
            assertThat(emptyStateView.visibility).isEqualTo(View.GONE)
            assertThat(remindersScrollView.visibility).isEqualTo(View.VISIBLE)

            // Step B: Insert 2 more (total 3)
            val remB = createReminder("osc-b-$cycle", "Cycle $cycle Task B", now + 120_000L)
            val remC = createReminder("osc-c-$cycle", "Cycle $cycle Task C", now + 180_000L)
            dao.upsertAll(listOf(remB, remC))
            waitForCondition { remindersContainer.childCount == 3 }
            assertThat(remindersContainer.childCount).isEqualTo(3)

            // Step C: Clear all (total 0)
            dao.clearAll()
            waitForCondition { remindersContainer.childCount == 0 }
            assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
            assertThat(remindersScrollView.visibility).isEqualTo(View.GONE)
        }
    }

    // =========================================================================
    // Dimension 3: Overdue vs Future vs Due Right Now & Boundary Conditions
    // =========================================================================

    @Test
    fun timeCategorization_futureTasksRenderTextSecondary() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val future30m = createReminder("future-1", "Future Task", now + 1_800_000L)
        activity.renderReminders(listOf(future30m))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val card = remindersContainer.getChildAt(0)
        val dueView = card.findViewById<TextView>(R.id.reminder_due)

        assertThat(dueView.text.toString()).isEqualTo("IN 30m")
        val expectedSecondary = ContextCompat.getColor(activity, R.color.text_secondary)
        assertThat(dueView.currentTextColor).isEqualTo(expectedSecondary)
    }

    @Test
    fun timeCategorization_dueRightNow_rendersDueNowAndOrange() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // Reminder due at exact current millisecond
        val dueNowReminder = createReminder("due-now-1", "Due Right Now", now)
        activity.renderReminders(listOf(dueNowReminder))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val card = remindersContainer.getChildAt(0)
        val dueView = card.findViewById<TextView>(R.id.reminder_due)

        assertThat(dueView.text.toString()).isEqualTo("DUE NOW")
        val expectedOrange = ContextCompat.getColor(activity, R.color.international_orange)
        assertThat(dueView.currentTextColor).isEqualTo(expectedOrange)
    }

    @Test
    fun timeCategorization_overdueTasks_renderInternationalOrangeWithOverdueLabel() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // 12 minutes overdue
        val overdue12m = createReminder("overdue-1", "Overdue Medication", now - 720_000L)
        activity.renderReminders(listOf(overdue12m))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val card = remindersContainer.getChildAt(0)
        val dueView = card.findViewById<TextView>(R.id.reminder_due)

        assertThat(dueView.text.toString()).isEqualTo("+12m OVERDUE")
        val expectedOrange = ContextCompat.getColor(activity, R.color.international_orange)
        assertThat(dueView.currentTextColor).isEqualTo(expectedOrange)
    }

    @Test
    fun timeCategorization_subMinuteBoundaries() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // Case A: 30 seconds into the future
        val future30s = createReminder("b-future-30s", "30s Future", now + 30_000L)
        activity.renderReminders(listOf(future30s))
        var card = activity.findViewById<LinearLayout>(R.id.reminders_container).getChildAt(0)
        var dueView = card.findViewById<TextView>(R.id.reminder_due)
        assertThat(dueView.text.toString()).isEqualTo("DUE NOW")
        // Not overdue yet (now < dueDate) -> text_secondary
        assertThat(dueView.currentTextColor).isEqualTo(ContextCompat.getColor(activity, R.color.text_secondary))

        // Case B: 30 seconds overdue
        val overdue30s = createReminder("b-overdue-30s", "30s Overdue", now - 30_000L)
        activity.renderReminders(listOf(overdue30s))
        card = activity.findViewById<LinearLayout>(R.id.reminders_container).getChildAt(0)
        dueView = card.findViewById<TextView>(R.id.reminder_due)
        // Format returns DUE NOW (integer minutes == 0), but now >= dueDate triggers orange urgency cue
        assertThat(dueView.text.toString()).isEqualTo("DUE NOW")
        assertThat(dueView.currentTextColor).isEqualTo(ContextCompat.getColor(activity, R.color.international_orange))
    }

    @Test
    fun timeCategorization_extremeTimestamps_noCrash() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val extremeReminders = listOf(
            createReminder("ext-1", "Epoch Zero", 0L),
            createReminder("ext-2", "Far Future", now + 86_400_000L * 30), // +30 days
            createReminder("ext-3", "Max Int Diff", now + 2_147_483_647L)
        )

        // Verify rendering doesn't throw or crash
        activity.renderReminders(extremeReminders)
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        assertThat(remindersContainer.childCount).isEqualTo(3)
    }

    // =========================================================================
    // Dimension 4: External Database Mutations (Sync & Tile)
    // =========================================================================

    @Test
    fun externalMutation_tileCompletion_reactivelyRemovesCardInMainActivity() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val rem1 = createReminder("ext-tile-1", "Task 1", now + 600_000L)
        val rem2 = createReminder("ext-tile-2", "Task 2", now + 1200_000L)
        dao.upsertAll(listOf(rem1, rem2))

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        waitForCondition { remindersContainer.childCount == 2 }

        // External Actor (TileActionHandler or Complication) marks rem1 as completed
        dao.completeReminder("ext-tile-1", now)

        waitForCondition { remindersContainer.childCount == 1 }

        val remainingCard = remindersContainer.getChildAt(0)
        val remainingTitle = remainingCard.findViewById<TextView>(R.id.reminder_title)
        assertThat(remainingTitle.text.toString()).isEqualTo("Task 2")
    }

    @Test
    fun externalMutation_tileSnooze_reactivelyUpdatesSnoozeBadgeAndCountdown() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val rem = createReminder("ext-snooze-1", "Tile Snooze Target", now + 300_000L)
        dao.upsert(rem)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        waitForCondition { remindersContainer.childCount == 1 }

        val card = remindersContainer.getChildAt(0)
        val snoozeCountView = card.findViewById<TextView>(R.id.reminder_snooze_count)
        assertThat(snoozeCountView.visibility).isEqualTo(View.GONE)

        // External Tile snoozes the reminder by +15m
        val newDue = SnoozeEngine.calculate15Minutes(now, rem.dueDate)
        dao.snoozeReminder("ext-snooze-1", newDue, now)

        waitForCondition {
            val countView = remindersContainer.getChildAt(0)?.findViewById<TextView>(R.id.reminder_snooze_count)
            countView?.visibility == View.VISIBLE
        }

        val updatedCard = remindersContainer.getChildAt(0)
        val updatedBadge = updatedCard.findViewById<TextView>(R.id.reminder_snooze_count)
        assertThat(updatedBadge.text.toString()).isEqualTo("Snoozed 1x")
    }

    @Test
    fun externalMutation_syncReconciliation_updatesTitleAndAddsItems() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val initial = createReminder("sync-rem-1", "Original Local Title", now + 600_000L)
        dao.upsert(initial)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        waitForCondition { remindersContainer.childCount == 1 }

        // External mobile host sync pushes update with newer updatedAt
        val updatedFromPhone = initial.copy(
            title = "Updated Title From Phone Host",
            updatedAt = initial.updatedAt + 50_000L
        )
        val newFromPhone = createReminder("sync-rem-2", "New Task From Phone", now + 900_000L)
        dao.reconcileIncomingBatch(listOf(updatedFromPhone, newFromPhone))

        waitForCondition { remindersContainer.childCount == 2 }

        val card0 = remindersContainer.getChildAt(0)
        val title0 = card0.findViewById<TextView>(R.id.reminder_title)
        assertThat(title0.text.toString()).isEqualTo("Updated Title From Phone Host")

        val card1 = remindersContainer.getChildAt(1)
        val title1 = card1.findViewById<TextView>(R.id.reminder_title)
        assertThat(title1.text.toString()).isEqualTo("New Task From Phone")
    }

    @Test
    fun externalMutation_softDelete_reactivelyRemovesCard() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val rem = createReminder("soft-del-1", "To Be Deleted", now + 600_000L)
        dao.upsert(rem)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        flushRoomAndMainLooper()

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        waitForCondition { remindersContainer.childCount == 1 }

        // External soft delete
        dao.markDeleted("soft-del-1", now)

        waitForCondition { remindersContainer.childCount == 0 }

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
    }

    // =========================================================================
    // Helper Waiter
    // =========================================================================

    private fun waitForCondition(maxAttempts: Int = 30, intervalMs: Long = 30, condition: () -> Boolean) {
        var attempts = 0
        while (!condition() && attempts < maxAttempts) {
            Thread.sleep(intervalMs)
            flushRoomAndMainLooper()
            attempts++
        }
        assertThat(condition()).isTrue()
    }
}
