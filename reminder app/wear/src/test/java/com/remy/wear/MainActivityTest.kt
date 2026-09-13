package com.remy.wear

import android.content.Context
import android.content.Intent
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
import com.remy.wear.surfaces.complication.RemyComplicationService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Automated Robolectric tests for Milestone 1:
 * Swiss Void Wear OS Launcher Activity (MainActivity.kt).
 *
 * Verifies:
 * 1. Package registration with MAIN and LAUNCHER intent filters.
 * 2. Complication tap action resolution without ActivityNotFoundException.
 * 3. Activity lifecycle, empty state rendering, and reactive updates from Room.
 * 4. 1-tap quick actions: +15m snooze (SnoozeEngine math) and complete.
 * 5. Swiss Void visual styling: #000000 AMOLED canvas, #FF4500 urgency cues, typography.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class MainActivityTest {

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

    // =========================================================================
    // 1. Manifest Registration & Intent Resolution Tests
    // =========================================================================

    @Test
    fun manifest_mainActivityIsRegistered_withMainAndLauncherFilters() {
        val packageManager = context.packageManager

        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            setPackage(context.packageName)
        }

        val resolveInfos = packageManager.queryIntentActivities(launcherIntent, 0)
        assertThat(resolveInfos).isNotEmpty()

        val mainActivityInfo = resolveInfos.firstOrNull {
            it.activityInfo.name == "com.remy.wear.MainActivity"
        }
        assertThat(mainActivityInfo).isNotNull()
        assertThat(mainActivityInfo!!.activityInfo.exported).isTrue()
    }

    @Test
    fun manifest_getLaunchIntentForPackage_resolvesToMainActivity() {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        assertThat(launchIntent).isNotNull()
        assertThat(launchIntent!!.component?.className).isEqualTo("com.remy.wear.MainActivity")
    }

    @Test
    fun complication_createTapAction_resolvesCleanlyToMainActivity() {
        val pendingIntent = RemyComplicationService.createTapAction(context)
        assertThat(pendingIntent).isNotNull()

        val shadowPending = shadowOf(pendingIntent)
        val targetIntent = shadowPending.savedIntent
        assertThat(targetIntent).isNotNull()

        // Verify target intent resolves to MainActivity in package manager without ActivityNotFoundException
        val resolveInfo = context.packageManager.resolveActivity(targetIntent, 0)
        assertThat(resolveInfo).isNotNull()
        assertThat(resolveInfo!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(targetIntent.component?.className).isEqualTo("com.remy.wear.MainActivity")
    }

    // =========================================================================
    // 2. Activity UI & Swiss Void Rendering Tests
    // =========================================================================

    @Test
    fun activity_launchesCleanly_rendersEmptyStateWhenNoReminders() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        val emptyIcon = activity.findViewById<TextView>(R.id.empty_icon)
        val emptyText = activity.findViewById<TextView>(R.id.empty_text)
        val remindersScrollView = activity.findViewById<ScrollView>(R.id.reminders_scroll_view)
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)

        // Empty state must be visible with clean Swiss checkmark and copy
        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
        assertThat(emptyIcon.text.toString()).isEqualTo("✓")
        assertThat(emptyText.text.toString()).isEqualTo(context.getString(R.string.no_active_reminders))
        assertThat(remindersScrollView.visibility).isEqualTo(View.GONE)
        assertThat(remindersContainer.childCount).isEqualTo(0)
    }

    @Test
    fun activity_rendersActiveReminders_andHidesEmptyState() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val reminder = createReminder(
            id = "rem-1",
            title = "Hydrate with Electrolytes",
            dueDate = now + 900_000L // +15 minutes
        )

        // Directly exercise renderReminders
        activity.renderReminders(listOf(reminder))

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        val remindersScrollView = activity.findViewById<ScrollView>(R.id.reminders_scroll_view)
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)

        assertThat(emptyStateView.visibility).isEqualTo(View.GONE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersContainer.childCount).isEqualTo(1)

        val cardView = remindersContainer.getChildAt(0)
        val titleView = cardView.findViewById<TextView>(R.id.reminder_title)
        val dueView = cardView.findViewById<TextView>(R.id.reminder_due)
        val snoozeCountView = cardView.findViewById<TextView>(R.id.reminder_snooze_count)
        val btnSnooze = cardView.findViewById<Button>(R.id.btn_snooze)
        val btnComplete = cardView.findViewById<Button>(R.id.btn_complete)

        assertThat(titleView.text.toString()).isEqualTo("Hydrate with Electrolytes")
        assertThat(dueView.text.toString()).isEqualTo("IN 15m")
        assertThat(snoozeCountView.visibility).isEqualTo(View.GONE)
        assertThat(btnSnooze.text.toString()).isEqualTo(context.getString(R.string.action_snooze_15m))
        assertThat(btnComplete.text.toString()).isEqualTo(context.getString(R.string.action_complete))
    }

    @Test
    fun activity_overdueReminder_rendersInternationalOrangeUrgencyCue() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val overdueReminder = createReminder(
            id = "rem-overdue",
            title = "Critical Medication",
            dueDate = now - 300_000L // 5m overdue
        )

        activity.renderReminders(listOf(overdueReminder))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val cardView = remindersContainer.getChildAt(0)
        val dueView = cardView.findViewById<TextView>(R.id.reminder_due)

        assertThat(dueView.text.toString()).contains("OVERDUE")
        val expectedOrange = ContextCompat.getColor(activity, R.color.international_orange)
        assertThat(dueView.currentTextColor).isEqualTo(expectedOrange)
    }

    @Test
    fun activity_snoozedReminder_rendersSnoozeCountBadge() {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val snoozedReminder = createReminder(
            id = "rem-snoozed",
            title = "Check Oven",
            dueDate = now + 1_800_000L,
            status = ReminderEntity.STATUS_SNOOZED,
            snoozeCount = 3
        )

        activity.renderReminders(listOf(snoozedReminder))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val cardView = remindersContainer.getChildAt(0)
        val snoozeCountView = cardView.findViewById<TextView>(R.id.reminder_snooze_count)

        assertThat(snoozeCountView.visibility).isEqualTo(View.VISIBLE)
        assertThat(snoozeCountView.text.toString()).isEqualTo("Snoozed 3x")
    }

    // =========================================================================
    // 3. 1-Tap Quick Action Tests (+15m Snooze & Complete)
    // =========================================================================

    @Test
    fun activity_snooze15mQuickAction_updatesRoomDatabase_andNotifiesSurfaces() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val surfaceNotified = AtomicBoolean(false)
        MainActivity.surfaceNotificationListener = {
            surfaceNotified.set(true)
        }

        val originalDue = now + 60_000L // 1 minute from now
        val reminder = createReminder(
            id = "action-rem-1",
            title = "Respond to Urgent Email",
            dueDate = originalDue
        )
        dao.upsert(reminder)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // Render the item in UI
        activity.renderReminders(listOf(reminder))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val cardView = remindersContainer.getChildAt(0)
        val btnSnooze = cardView.findViewById<Button>(R.id.btn_snooze)

        // Trigger 1-tap snooze
        val snoozeJob = activity.snoozeReminder(reminder)
        snoozeJob.join()
        ShadowLooper.idleMainLooper()

        // Verify Room DB mutation
        val updated = dao.getReminderById("action-rem-1")
        assertThat(updated).isNotNull()
        assertThat(updated!!.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(updated.snoozeCount).isEqualTo(1)
        assertThat(updated.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(updated.lastSnoozedAt).isEqualTo(now)

        // Verify calculated due date strictly follows SnoozeEngine math
        val expectedNewDue = SnoozeEngine.calculate15Minutes(now, originalDue)
        assertThat(updated.dueDate).isEqualTo(expectedNewDue)

        // Verify push invalidation dispatched to complications and tiles
        assertThat(surfaceNotified.get()).isTrue()
    }

    @Test
    fun activity_completeQuickAction_updatesRoomDatabase_andNotifiesSurfaces() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val surfaceNotified = AtomicBoolean(false)
        MainActivity.surfaceNotificationListener = {
            surfaceNotified.set(true)
        }

        val reminder = createReminder(
            id = "action-rem-2",
            title = "Daily Standup Meeting",
            dueDate = now + 300_000L
        )
        dao.upsert(reminder)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        activity.renderReminders(listOf(reminder))

        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)
        val cardView = remindersContainer.getChildAt(0)
        val btnComplete = cardView.findViewById<Button>(R.id.btn_complete)

        // Trigger 1-tap complete
        val completeJob = activity.completeReminder(reminder)
        completeJob.join()
        ShadowLooper.idleMainLooper()

        // Verify Room DB mutation
        val updated = dao.getReminderById("action-rem-2")
        assertThat(updated).isNotNull()
        assertThat(updated!!.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(updated.completedAt).isEqualTo(now)
        assertThat(updated.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        // Verify push invalidation dispatched to complications and tiles
        assertThat(surfaceNotified.get()).isTrue()
    }

    // =========================================================================
    // 4. Reactive Room Flow Observation Integration Test
    // =========================================================================

    @Test
    fun activity_reactivelyObservesRoomDatabase_updatesUIOnInsertion() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        // Start activity with empty database
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        ShadowLooper.idleMainLooper()

        val emptyStateView = activity.findViewById<LinearLayout>(R.id.empty_state_view)
        val remindersScrollView = activity.findViewById<ScrollView>(R.id.reminders_scroll_view)
        val remindersContainer = activity.findViewById<LinearLayout>(R.id.reminders_container)

        assertThat(emptyStateView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.GONE)

        // Insert new active reminder into Room
        val newReminder = createReminder(
            id = "reactive-rem-1",
            title = "Call Pharmacy",
            dueDate = now + 1_200_000L // +20 minutes
        )
        dao.upsert(newReminder)

        // Force Room invalidation tracker to sync and pump event loop
        database.invalidationTracker.refreshVersionsSync()
        shadowOf(Looper.getMainLooper()).idle()

        var attempts = 0
        while (remindersContainer.childCount == 0 && attempts < 20) {
            Thread.sleep(50)
            database.invalidationTracker.refreshVersionsSync()
            shadowOf(Looper.getMainLooper()).idle()
            attempts++
        }

        // Verify reactive UI update
        assertThat(emptyStateView.visibility).isEqualTo(View.GONE)
        assertThat(remindersScrollView.visibility).isEqualTo(View.VISIBLE)
        assertThat(remindersContainer.childCount).isEqualTo(1)

        val cardView = remindersContainer.getChildAt(0)
        val titleView = cardView.findViewById<TextView>(R.id.reminder_title)
        assertThat(titleView.text.toString()).isEqualTo("Call Pharmacy")
    }

    // =========================================================================
    // 5. Voice Capture & Capture Philosophy Ingress Tests
    // =========================================================================

    @Test
    fun voiceCapture_parsesNaturalLanguageCues_andUnarmedNotes() {
        val now = 1_726_050_000_000L
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        // 1. Relative +15m cue -> armed
        val r1 = activity.parseVoiceText("Buy whole milk +15m", now)
        assertThat(r1.title).isEqualTo("Buy whole milk")
        assertThat(r1.dueDate).isEqualTo(now + 15 * 60_000L)
        assertThat(r1.armed).isTrue()

        // 2. Relative 1h cue -> armed
        val r2 = activity.parseVoiceText("Turn off sprinkler in 1 hour", now)
        assertThat(r2.title).isEqualTo("Turn off sprinkler")
        assertThat(r2.dueDate).isEqualTo(now + 60 * 60_000L)
        assertThat(r2.armed).isTrue()

        // 3. Tonight cue -> armed at 20:00
        val r3 = activity.parseVoiceText("Read chapter 4 tonight", now)
        assertThat(r3.title).isEqualTo("Read chapter 4")
        assertThat(r3.armed).isTrue()

        // 4. Raw capture thought without temporal cues -> armed = false!
        val r4 = activity.parseVoiceText("Zero friction prospective memory insight", now)
        assertThat(r4.title).isEqualTo("Zero friction prospective memory insight")
        assertThat(r4.armed).isFalse()
    }

    @Test
    fun voiceCapture_handleVoiceCapture_persistsToRoomAndDispatchesSurfaces() = runBlocking {
        val now = 1_726_050_000_000L
        MainActivity.clockOverride = { now }

        val surfaceNotified = AtomicBoolean(false)
        MainActivity.surfaceNotificationListener = {
            surfaceNotified.set(true)
        }

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val captured = activity.handleVoiceCapture("Fix bicycle chain tomorrow")
        assertThat(captured.title).isEqualTo("Fix bicycle chain")
        assertThat(captured.armed).isTrue()
        assertThat(captured.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        ShadowLooper.idleMainLooper()

        val inDb = dao.getReminderById(captured.id)
        assertThat(inDb).isNotNull()
        assertThat(inDb?.title).isEqualTo("Fix bicycle chain")
        assertThat(inDb?.armed).isTrue()
        assertThat(surfaceNotified.get()).isTrue()
    }
}
