package com.remy.wear.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.cash.turbine.test
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34]) // Wear OS 5 / API 34
class ReminderDaoTest {

    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // =========================================================================
    // Test Helpers
    // =========================================================================

    private fun createReminder(
        id: String,
        title: String = "Test Reminder $id",
        notes: String? = null,
        dueDate: Long = 1726050000000L,
        status: String = ReminderEntity.STATUS_PENDING,
        snoozeCount: Int = 0,
        lastSnoozedAt: Long? = null,
        createdAt: Long = 1726040000000L,
        updatedAt: Long = 1726040000000L,
        completedAt: Long? = null,
        notificationId: String? = null,
        isDeleted: Boolean = false,
        syncStatus: String = ReminderEntity.SYNC_STATUS_SYNCED,
        armed: Boolean = true
    ): ReminderEntity {
        return ReminderEntity(
            id = id,
            title = title,
            notes = notes,
            dueDate = dueDate,
            status = status,
            snoozeCount = snoozeCount,
            lastSnoozedAt = lastSnoozedAt,
            createdAt = createdAt,
            updatedAt = updatedAt,
            completedAt = completedAt,
            notificationId = notificationId,
            isDeleted = isDeleted,
            syncStatus = syncStatus,
            armed = armed
        )
    }

    // =========================================================================
    // Test Cases
    // =========================================================================

    @Test
    fun insertAndRetrieveReminder_persistsAllFieldsCorrectly() = runTest {
        val reminder = createReminder(
            id = "rem-001",
            title = "Medication Refill",
            notes = "Take with water",
            dueDate = 1726053600000L,
            status = ReminderEntity.STATUS_PENDING,
            snoozeCount = 2,
            lastSnoozedAt = 1726050000000L,
            createdAt = 1726040000000L,
            updatedAt = 1726050000000L,
            completedAt = null,
            notificationId = "notif-99",
            isDeleted = false,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        )

        dao.upsert(reminder)

        val retrieved = dao.getReminderById("rem-001")
        assertNotNull(retrieved)
        assertEquals("rem-001", retrieved?.id)
        assertEquals("Medication Refill", retrieved?.title)
        assertEquals("Take with water", retrieved?.notes)
        assertEquals(1726053600000L, retrieved?.dueDate)
        assertEquals(ReminderEntity.STATUS_PENDING, retrieved?.status)
        assertEquals(2, retrieved?.snoozeCount)
        assertEquals(1726050000000L, retrieved?.lastSnoozedAt)
        assertEquals(1726040000000L, retrieved?.createdAt)
        assertEquals(1726050000000L, retrieved?.updatedAt)
        assertNull(retrieved?.completedAt)
        assertEquals("notif-99", retrieved?.notificationId)
        assertFalse(retrieved?.isDeleted ?: true)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, retrieved?.syncStatus)
    }

    @Test
    fun observeActiveReminders_emitsAscendingByDueDate() = runTest {
        val r1 = createReminder(id = "1", dueDate = 3000L)
        val r2 = createReminder(id = "2", dueDate = 1000L)
        val r3 = createReminder(id = "3", dueDate = 2000L)

        dao.upsertAll(listOf(r1, r2, r3))

        dao.observeActiveReminders().test {
            val list = awaitItem()
            assertEquals(3, list.size)
            assertEquals("2", list[0].id) // 1000L
            assertEquals("3", list[1].id) // 2000L
            assertEquals("1", list[2].id) // 3000L
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeNearestActiveReminder_emitsSingleEarliestReminder() = runTest {
        val r1 = createReminder(id = "late", dueDate = 5000L)
        val r2 = createReminder(id = "early", dueDate = 1000L)

        dao.upsertAll(listOf(r1, r2))

        dao.observeNearestActiveReminder().test {
            val nearest = awaitItem()
            assertNotNull(nearest)
            assertEquals("early", nearest?.id)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeNearestActiveReminder_emitsNullWhenNoActiveReminders() = runTest {
        dao.observeNearestActiveReminder().test {
            val nearest = awaitItem()
            assertNull(nearest)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeActiveReminders_excludesCompletedReminders() = runTest {
        val pending = createReminder(id = "p1", status = ReminderEntity.STATUS_PENDING)
        val snoozed = createReminder(id = "s1", status = ReminderEntity.STATUS_SNOOZED)
        val completed = createReminder(id = "c1", status = ReminderEntity.STATUS_COMPLETED)

        dao.upsertAll(listOf(pending, snoozed, completed))

        dao.observeActiveReminders().test {
            val list = awaitItem()
            assertEquals(2, list.size)
            assertTrue(list.any { it.id == "p1" })
            assertTrue(list.any { it.id == "s1" })
            assertFalse(list.any { it.id == "c1" })
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeActiveReminders_excludesSoftDeletedTombstones() = runTest {
        val active = createReminder(id = "act", isDeleted = false)
        val deleted = createReminder(id = "del", isDeleted = true)

        dao.upsertAll(listOf(active, deleted))

        dao.observeActiveReminders().test {
            val list = awaitItem()
            assertEquals(1, list.size)
            assertEquals("act", list[0].id)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun snoozeReminder_incrementsCountAndUpdatesTimestamps() = runTest {
        val original = createReminder(
            id = "snooze-test",
            dueDate = 1000L,
            snoozeCount = 0,
            lastSnoozedAt = null,
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 500L
        )
        dao.upsert(original)

        val newDueDate = 2500L
        val now = 1200L

        val updatedRows = dao.snoozeReminder("snooze-test", newDueDate, now)
        assertEquals(1, updatedRows)

        val updated = dao.getReminderById("snooze-test")
        assertNotNull(updated)
        assertEquals(newDueDate, updated?.dueDate)
        assertEquals(1, updated?.snoozeCount)
        assertEquals(now, updated?.lastSnoozedAt)
        assertEquals(now, updated?.updatedAt)
        assertEquals(ReminderEntity.STATUS_SNOOZED, updated?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, updated?.syncStatus)
    }

    @Test
    fun completeReminder_setsCompletedStatusAndTimestamp() = runTest {
        val original = createReminder(id = "comp-test", status = ReminderEntity.STATUS_PENDING)
        dao.upsert(original)

        val now = 1500L
        val updatedRows = dao.completeReminder("comp-test", now)
        assertEquals(1, updatedRows)

        val updated = dao.getReminderById("comp-test")
        assertNotNull(updated)
        assertEquals(ReminderEntity.STATUS_COMPLETED, updated?.status)
        assertEquals(now, updated?.completedAt)
        assertEquals(now, updated?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, updated?.syncStatus)
    }

    @Test
    fun markDeleted_setsTombstoneAndPendingUpload() = runTest {
        val original = createReminder(id = "del-test", isDeleted = false)
        dao.upsert(original)

        val now = 2000L
        val updatedRows = dao.markDeleted("del-test", now)
        assertEquals(1, updatedRows)

        val updated = dao.getReminderById("del-test")
        assertNotNull(updated)
        assertTrue(updated?.isDeleted ?: false)
        assertEquals(now, updated?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, updated?.syncStatus)
    }

    @Test
    fun getPendingUploads_and_markSynced_managesSyncLifecycle() = runTest {
        val r1 = createReminder(id = "clean", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED)
        val r2 = createReminder(id = "dirty", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, updatedAt = 5000L)

        dao.upsertAll(listOf(r1, r2))

        val pending = dao.getPendingUploads()
        assertEquals(1, pending.size)
        assertEquals("dirty", pending[0].id)

        val updatedCount = dao.markSynced("dirty", 5000L)
        assertEquals(1, updatedCount)

        val synced = dao.getReminderById("dirty")
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, synced?.syncStatus)
    }

    @Test
    fun reconcileIncomingBatch_insertsNewRecordsAsSynced() = runTest {
        val phoneRecord = createReminder(
            id = "phone-new",
            title = "New from phone",
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD // Should be converted to SYNCED
        )

        dao.reconcileIncomingBatch(listOf(phoneRecord))

        val local = dao.getReminderById("phone-new")
        assertNotNull(local)
        assertEquals("New from phone", local?.title)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, local?.syncStatus)
    }

    @Test
    fun reconcileIncomingBatch_overwritesOlderLocalWithNewerPhoneRecord() = runTest {
        val localRecord = createReminder(
            id = "shared-1",
            title = "Local Old Title",
            updatedAt = 1000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localRecord)

        val phoneRecord = createReminder(
            id = "shared-1",
            title = "Phone Newer Title",
            updatedAt = 2000L
        )

        dao.reconcileIncomingBatch(listOf(phoneRecord))

        val result = dao.getReminderById("shared-1")
        assertEquals("Phone Newer Title", result?.title)
        assertEquals(2000L, result?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, result?.syncStatus)
    }

    @Test
    fun reconcileIncomingBatch_preservesNewerLocalPendingUpload() = runTest {
        val localRecord = createReminder(
            id = "shared-2",
            title = "Local Newer Title",
            updatedAt = 3000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localRecord)

        val stalePhoneRecord = createReminder(
            id = "shared-2",
            title = "Phone Stale Title",
            updatedAt = 1000L
        )

        dao.reconcileIncomingBatch(listOf(stalePhoneRecord))

        val result = dao.getReminderById("shared-2")
        assertEquals("Local Newer Title", result?.title)
        assertEquals(3000L, result?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result?.syncStatus)
    }

    @Test
    fun reconcileIncomingBatch_tieBreakerCompleteStatusWins() = runTest {
        val localRecord = createReminder(
            id = "shared-3",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 2000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localRecord)

        val phoneRecord = createReminder(
            id = "shared-3",
            status = ReminderEntity.STATUS_COMPLETED,
            updatedAt = 2000L // Exact timestamp match
        )

        dao.reconcileIncomingBatch(listOf(phoneRecord))

        val result = dao.getReminderById("shared-3")
        assertEquals(ReminderEntity.STATUS_COMPLETED, result?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, result?.syncStatus)
    }

    @Test
    fun purgeOldTombstones_removesOnlyOldDeletedRecords() = runTest {
        val active = createReminder(id = "act", isDeleted = false, updatedAt = 1000L)
        val recentTombstone = createReminder(id = "rec-del", isDeleted = true, updatedAt = 5000L)
        val oldTombstone = createReminder(id = "old-del", isDeleted = true, updatedAt = 2000L)

        dao.upsertAll(listOf(active, recentTombstone, oldTombstone))

        val cutoff = 4000L // old-del (2000L) is older than cutoff; rec-del (5000L) is newer
        val purgedCount = dao.purgeOldTombstones(cutoff)
        assertEquals(1, purgedCount)

        assertNotNull(dao.getReminderById("act"))
        assertNotNull(dao.getReminderById("rec-del"))
        assertNull(dao.getReminderById("old-del"))
    }

    @Test
    fun observeOverdueCount_accuratelyCountsOverdueTasks() = runTest {
        val now = 2000L
        val overdue1 = createReminder(id = "o1", dueDate = 1000L)
        val overdue2 = createReminder(id = "o2", dueDate = 1999L)
        val exactDue = createReminder(id = "o3", dueDate = 2000L) // dueDate <= now
        val upcoming = createReminder(id = "u1", dueDate = 2001L)
        val completedOverdue = createReminder(id = "co", dueDate = 500L, status = ReminderEntity.STATUS_COMPLETED)

        dao.upsertAll(listOf(overdue1, overdue2, exactDue, upcoming, completedOverdue))

        dao.observeOverdueCount(now).test {
            val count = awaitItem()
            assertEquals(3, count) // o1, o2, o3 (completed is excluded)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeOverdueCount_excludesUnarmedThoughts() = runTest {
        val now = 2000L
        val overdueArmed = createReminder(id = "overdue-armed", dueDate = 1000L, armed = true)
        val overdueUnarmed = createReminder(id = "overdue-unarmed", dueDate = 1000L, armed = false)

        dao.upsertAll(listOf(overdueArmed, overdueUnarmed))

        val count = dao.getOverdueCount(now)
        assertEquals(1, count) // Unarmed must NEVER trigger overdue counter

        dao.observeOverdueCount(now).test {
            val observedCount = awaitItem()
            assertEquals(1, observedCount)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun observeNearestActiveReminder_excludesUnarmedThoughts() = runTest {
        val earlierUnarmed = createReminder(id = "earlier-unarmed", dueDate = 1000L, armed = false)
        val laterArmed = createReminder(id = "later-armed", dueDate = 3000L, armed = true)

        dao.upsertAll(listOf(earlierUnarmed, laterArmed))

        val nearest = dao.getNearestActiveReminder()
        assertNotNull(nearest)
        assertEquals("later-armed", nearest?.id) // Complication focuses on scheduled alert

        dao.observeNearestActiveReminder().test {
            val item = awaitItem()
            assertEquals("later-armed", item?.id)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
