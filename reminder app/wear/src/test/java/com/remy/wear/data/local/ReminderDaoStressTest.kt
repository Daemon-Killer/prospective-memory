package com.remy.wear.data.local

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.cash.turbine.test
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
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

/**
 * Empirical adversarial stress test harness for Remy Reminders Room database.
 *
 * Tests:
 * 1. SQLite EXPLAIN QUERY PLAN verification for index scan vs full table scan.
 * 2. Multi-threaded concurrency, atomic updates, and Flow emission stability.
 * 3. Tombstone resurrection resistance against stale and out-of-order batches.
 * 4. Last-Write-Wins (LWW) conflict resolution and COMPLETED priority tie-breaking.
 * 5. Scale and sorting invariants under 500+ active/inactive reminders.
 * 6. Mutation boundary guards and sync acknowledge guards.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class ReminderDaoStressTest {

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

    private fun createEntity(
        id: String,
        title: String = "Title $id",
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
        syncStatus: String = ReminderEntity.SYNC_STATUS_SYNCED
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
            syncStatus = syncStatus
        )
    }

    private fun explainQueryPlan(sql: String): List<String> {
        val plans = mutableListOf<String>()
        val db = database.openHelper.readableDatabase
        val cursor = db.query("EXPLAIN QUERY PLAN $sql")
        cursor.use { c ->
            val detailIndex = c.getColumnIndex("detail")
            while (c.moveToNext()) {
                plans.add(c.getString(detailIndex))
            }
        }
        return plans
    }

    // =========================================================================
    // 1. SQLite Index Plan Verification (Adversarial Focus #2)
    // =========================================================================

    @Test
    fun queryPlan_observeActiveReminders_usesCompositeIndexWithoutFullTableScan() {
        // Query under test:
        // SELECT * FROM reminders WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') ORDER BY dueDate ASC
        val plan = explainQueryPlan(
            "SELECT * FROM reminders WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') ORDER BY dueDate ASC"
        )
        val combinedPlan = plan.joinToString("; ")
        println("EXPLAIN QUERY PLAN (observeActiveReminders): $combinedPlan")

        // Must utilize idx_active_reminders
        assertTrue(
            "Query plan must use idx_active_reminders. Actual plan: $combinedPlan",
            combinedPlan.contains("idx_active_reminders")
        )
        // Must NOT do an unindexed table scan
        assertFalse(
            "Query plan must NOT execute an unindexed SCAN TABLE reminders. Actual plan: $combinedPlan",
            combinedPlan.contains("SCAN TABLE reminders") && !combinedPlan.contains("USING INDEX")
        )
    }

    @Test
    fun queryPlan_observeNearestActiveReminder_usesCompositeIndexWithoutFullTableScan() {
        val plan = explainQueryPlan(
            "SELECT * FROM reminders WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') ORDER BY dueDate ASC LIMIT 1"
        )
        val combinedPlan = plan.joinToString("; ")
        println("EXPLAIN QUERY PLAN (observeNearestActiveReminder): $combinedPlan")

        assertTrue(
            "Query plan must use idx_active_reminders. Actual plan: $combinedPlan",
            combinedPlan.contains("idx_active_reminders")
        )
        assertFalse(
            "Query plan must NOT execute an unindexed table scan. Actual plan: $combinedPlan",
            combinedPlan.contains("SCAN TABLE reminders") && !combinedPlan.contains("USING INDEX")
        )
    }

    @Test
    fun queryPlan_observeOverdueCount_usesCompositeIndex() {
        val plan = explainQueryPlan(
            "SELECT COUNT(*) FROM reminders WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') AND dueDate <= 1726050000000"
        )
        val combinedPlan = plan.joinToString("; ")
        println("EXPLAIN QUERY PLAN (observeOverdueCount): $combinedPlan")

        assertTrue(
            "Query plan must use idx_active_reminders. Actual plan: $combinedPlan",
            combinedPlan.contains("idx_active_reminders")
        )
    }

    @Test
    fun queryPlan_getPendingUploads_usesSyncStatusIndex() {
        val plan = explainQueryPlan(
            "SELECT * FROM reminders WHERE syncStatus = 'PENDING_UPLOAD'"
        )
        val combinedPlan = plan.joinToString("; ")
        println("EXPLAIN QUERY PLAN (getPendingUploads): $combinedPlan")

        assertTrue(
            "Query plan must use idx_sync_status. Actual plan: $combinedPlan",
            combinedPlan.contains("idx_sync_status")
        )
    }

    // =========================================================================
    // 2. Tombstone Resurrection Attack Scenarios (Adversarial Focus #1)
    // =========================================================================

    @Test
    fun tombstoneResurrection_staleIncomingBatchDoesNotResurrectLocallyDeletedRecord() = runTest {
        // Watch user deletes reminder at t = 5000
        val localDeleted = createEntity(
            id = "tombstone-1",
            isDeleted = true,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localDeleted)

        // Incoming phone batch has stale record prior to deletion (t = 4000)
        val staleIncoming = createEntity(
            id = "tombstone-1",
            title = "Resurrect Attempt",
            isDeleted = false,
            updatedAt = 4000L,
            status = ReminderEntity.STATUS_PENDING
        )

        dao.reconcileIncomingBatch(listOf(staleIncoming))

        val result = dao.getReminderById("tombstone-1")
        assertNotNull(result)
        assertTrue("Tombstone must not be resurrected by older phone record", result!!.isDeleted)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result.syncStatus)
        assertEquals(5000L, result.updatedAt)
    }

    @Test
    fun tombstoneResurrection_equalTimestampPendingStatusDoesNotResurrectTombstone() = runTest {
        // Local tombstone at t = 5000
        val localDeleted = createEntity(
            id = "tombstone-2",
            isDeleted = true,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localDeleted)

        // Phone batch arrives with identical timestamp t = 5000 but status = PENDING
        val equalIncoming = createEntity(
            id = "tombstone-2",
            isDeleted = false,
            updatedAt = 5000L,
            status = ReminderEntity.STATUS_PENDING
        )

        dao.reconcileIncomingBatch(listOf(equalIncoming))

        val result = dao.getReminderById("tombstone-2")
        assertNotNull(result)
        assertTrue("Equal timestamp PENDING must not resurrect local tombstone", result!!.isDeleted)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result.syncStatus)
    }

    @Test
    fun tombstoneResurrection_equalTimestampSnoozedStatusDoesNotResurrectTombstone() = runTest {
        val localDeleted = createEntity(
            id = "tombstone-3",
            isDeleted = true,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localDeleted)

        val equalIncoming = createEntity(
            id = "tombstone-3",
            isDeleted = false,
            updatedAt = 5000L,
            status = ReminderEntity.STATUS_SNOOZED
        )

        dao.reconcileIncomingBatch(listOf(equalIncoming))

        val result = dao.getReminderById("tombstone-3")
        assertNotNull(result)
        assertTrue("Equal timestamp SNOOZED must not resurrect local tombstone", result!!.isDeleted)
    }

    @Test
    fun tombstoneResurrection_syncedTombstoneNotResurrectedByStalePhoneSnapshot() = runTest {
        // Local deletion was already synced to cloud/phone (syncStatus = SYNCED)
        val localDeletedSynced = createEntity(
            id = "tombstone-4",
            isDeleted = true,
            updatedAt = 6000L,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        )
        dao.upsert(localDeletedSynced)

        // Delayed or duplicate phone packet arrives with old state t = 4500
        val staleIncoming = createEntity(
            id = "tombstone-4",
            isDeleted = false,
            updatedAt = 4500L,
            status = ReminderEntity.STATUS_PENDING
        )

        dao.reconcileIncomingBatch(listOf(staleIncoming))

        val result = dao.getReminderById("tombstone-4")
        assertNotNull(result)
        assertTrue("Stale incoming record must not resurrect synced tombstone", result!!.isDeleted)
    }

    @Test
    fun tombstoneResurrection_massBatchResistanceUnderAdversarialAssault() = runTest {
        // Create 100 local tombstones
        val count = 100
        val tombstones = (1..count).map { i ->
            createEntity(
                id = "mass-del-$i",
                isDeleted = true,
                updatedAt = 10000L,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        }
        dao.upsertAll(tombstones)

        // Attack with 100 stale active records with timestamps ranging from 1000L to 9999L
        val staleAssault = (1..count).map { i ->
            createEntity(
                id = "mass-del-$i",
                title = "Zombie $i",
                isDeleted = false,
                updatedAt = 1000L + (i * 80L), // strictly < 10000L
                status = ReminderEntity.STATUS_PENDING
            )
        }
        dao.reconcileIncomingBatch(staleAssault)

        // Verify active query contains ZERO zombie items
        val active = dao.getActiveReminders()
        assertEquals(0, active.size)

        // Verify all 100 tombstones remain intact
        for (i in 1..count) {
            val item = dao.getReminderById("mass-del-$i")
            assertNotNull(item)
            assertTrue(item!!.isDeleted)
            assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, item.syncStatus)
        }
    }

    // =========================================================================
    // 3. Last-Write-Wins (LWW) Tie-Breaking & Conflict Priority
    // =========================================================================

    @Test
    fun lwwTieBreaker_completedPriorityOverPending() = runTest {
        val localPending = createEntity(
            id = "lww-1",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localPending)

        // Phone sends COMPLETED with identical timestamp
        val incomingCompleted = createEntity(
            id = "lww-1",
            status = ReminderEntity.STATUS_COMPLETED,
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingCompleted))

        val result = dao.getReminderById("lww-1")
        assertEquals(ReminderEntity.STATUS_COMPLETED, result?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, result?.syncStatus)
    }

    @Test
    fun lwwTieBreaker_completedPriorityOverSnoozed() = runTest {
        val localSnoozed = createEntity(
            id = "lww-2",
            status = ReminderEntity.STATUS_SNOOZED,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localSnoozed)

        val incomingCompleted = createEntity(
            id = "lww-2",
            status = ReminderEntity.STATUS_COMPLETED,
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingCompleted))

        val result = dao.getReminderById("lww-2")
        assertEquals(ReminderEntity.STATUS_COMPLETED, result?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, result?.syncStatus)
    }

    @Test
    fun lwwTieBreaker_localCompletedProtectedAgainstIncomingPending() = runTest {
        val localCompleted = createEntity(
            id = "lww-3",
            status = ReminderEntity.STATUS_COMPLETED,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localCompleted)

        val incomingPending = createEntity(
            id = "lww-3",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingPending))

        val result = dao.getReminderById("lww-3")
        assertEquals("Local COMPLETED must not be overridden by equal timestamp PENDING",
            ReminderEntity.STATUS_COMPLETED, result?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result?.syncStatus)
    }

    @Test
    fun lwwTieBreaker_localCompletedProtectedAgainstIncomingSnoozed() = runTest {
        val localCompleted = createEntity(
            id = "lww-4",
            status = ReminderEntity.STATUS_COMPLETED,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localCompleted)

        val incomingSnoozed = createEntity(
            id = "lww-4",
            status = ReminderEntity.STATUS_SNOOZED,
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingSnoozed))

        val result = dao.getReminderById("lww-4")
        assertEquals("Local COMPLETED must not be overridden by equal timestamp SNOOZED",
            ReminderEntity.STATUS_COMPLETED, result?.status)
    }

    @Test
    fun lwwTieBreaker_localPendingPreservedAgainstIncomingSnoozedAtEqualTimestamp() = runTest {
        val localPending = createEntity(
            id = "lww-5",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localPending)

        val incomingSnoozed = createEntity(
            id = "lww-5",
            status = ReminderEntity.STATUS_SNOOZED,
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingSnoozed))

        val result = dao.getReminderById("lww-5")
        // Because neither is completed, local pending upload takes precedence to protect uncommitted offline work
        assertEquals(ReminderEntity.STATUS_PENDING, result?.status)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result?.syncStatus)
    }

    @Test
    fun lwwStrictTimestamp_strictlyNewerPhoneUpdateAlwaysWins() = runTest {
        val localRecord = createEntity(
            id = "lww-6",
            title = "Watch Title",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 5000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localRecord)

        val incomingRecord = createEntity(
            id = "lww-6",
            title = "Phone Overwrite Title",
            status = ReminderEntity.STATUS_SNOOZED,
            updatedAt = 5001L // Strictly 1ms newer
        )

        dao.reconcileIncomingBatch(listOf(incomingRecord))

        val result = dao.getReminderById("lww-6")
        assertEquals("Phone Overwrite Title", result?.title)
        assertEquals(ReminderEntity.STATUS_SNOOZED, result?.status)
        assertEquals(5001L, result?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, result?.syncStatus)
    }

    @Test
    fun lwwStrictTimestamp_strictlyNewerLocalMutationPreservedAgainstStalePhone() = runTest {
        val localRecord = createEntity(
            id = "lww-7",
            title = "Watch Newer Title",
            updatedAt = 5001L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localRecord)

        val incomingRecord = createEntity(
            id = "lww-7",
            title = "Phone Stale Title",
            updatedAt = 5000L
        )

        dao.reconcileIncomingBatch(listOf(incomingRecord))

        val result = dao.getReminderById("lww-7")
        assertEquals("Watch Newer Title", result?.title)
        assertEquals(5001L, result?.updatedAt)
        assertEquals(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, result?.syncStatus)
    }

    // =========================================================================
    // 4. Concurrency Stress Test & Flow Reactivity
    // =========================================================================

    @Test
    fun concurrency_parallelMutationsAndReconciliationsMaintainIntegrity() = runTest {
        // Seed database with 50 items
        val count = 50
        val seed = (1..count).map { i ->
            createEntity(id = "conc-$i", dueDate = 1000L * i, updatedAt = 1000L)
        }
        dao.upsertAll(seed)

        // Launch concurrent mutators across coroutine dispatchers
        val jobs = (1..count).map { i ->
            async(Dispatchers.Default) {
                when (i % 4) {
                    0 -> dao.snoozeReminder("conc-$i", 50000L + i, 2000L)
                    1 -> dao.completeReminder("conc-$i", 2000L)
                    2 -> dao.markDeleted("conc-$i", 2000L)
                    3 -> dao.reconcileIncomingBatch(listOf(
                        createEntity(
                            id = "conc-$i",
                            title = "Phone Concurrent Title $i",
                            updatedAt = 3000L
                        )
                    ))
                }
            }
        }
        jobs.awaitAll()

        // Verify database is completely consistent and readable
        val allRemaining = (1..count).mapNotNull { dao.getReminderById("conc-$it") }
        assertEquals(count, allRemaining.size)

        // Verify active list is correctly filtered and sorted
        val active = dao.getActiveReminders()
        for (i in 0 until active.size - 1) {
            assertTrue(
                "Active reminders must remain strictly sorted by dueDate",
                active[i].dueDate <= active[i + 1].dueDate
            )
            assertFalse(active[i].isDeleted)
            assertTrue(active[i].status == ReminderEntity.STATUS_PENDING || active[i].status == ReminderEntity.STATUS_SNOOZED)
        }
    }

    @Test
    fun concurrency_flowObserverDoesNotDropEventsUnderContinuousLoad() = runTest {
        val initial = createEntity(id = "flow-test-1", dueDate = 1000L)
        dao.upsert(initial)

        dao.observeActiveReminders().test {
            val first = awaitItem()
            assertEquals(1, first.size)

            // Concurrently perform 10 rapid mutations
            for (i in 2..10) {
                dao.upsert(createEntity(id = "flow-test-$i", dueDate = 1000L * i))
            }

            // Await emission with all 10 items
            var latest: List<ReminderEntity> = emptyList()
            while (latest.size < 10) {
                latest = awaitItem()
            }
            assertEquals(10, latest.size)
            // Verify strict ordering
            for (k in 0 until latest.size - 1) {
                assertTrue(latest[k].dueDate <= latest[k + 1].dueDate)
            }
            cancelAndIgnoreRemainingEvents()
        }
    }

    // =========================================================================
    // 5. Scale & Boundary Verification
    // =========================================================================

    @Test
    fun scale_500InterleavedReminders_strictlyMaintainsOrderAndNearestInvariants() = runTest {
        val total = 500
        val items = (1..total).map { i ->
            // Pseudo-random pseudo-shuffled due dates
            val pseudoDueDate = ((i * 37) % total + 1) * 1000L
            val isDeleted = (i % 5 == 0) // 20% deleted
            val status = when (i % 3) {
                0 -> ReminderEntity.STATUS_COMPLETED
                1 -> ReminderEntity.STATUS_SNOOZED
                else -> ReminderEntity.STATUS_PENDING
            }
            createEntity(
                id = "scale-$i",
                dueDate = pseudoDueDate,
                status = status,
                isDeleted = isDeleted
            )
        }

        dao.upsertAll(items)

        val active = dao.getActiveReminders()
        val nearest = dao.getNearestActiveReminder()

        // Manual filter oracle
        val expectedActive = items
            .filter { !it.isDeleted && (it.status == ReminderEntity.STATUS_PENDING || it.status == ReminderEntity.STATUS_SNOOZED) }
            .sortedBy { it.dueDate }

        assertEquals("Active count must strictly match filter oracle", expectedActive.size, active.size)
        assertEquals("Nearest item must match earliest active due date", expectedActive.first().id, nearest?.id)
        assertEquals("Nearest item due date must match earliest", expectedActive.first().dueDate, nearest?.dueDate)

        // Strict ordering verification
        for (i in 0 until active.size - 1) {
            assertTrue(active[i].dueDate <= active[i + 1].dueDate)
        }
    }

    @Test
    fun boundary_markSyncedTimestampGuardPreventsRaceConditions() = runTest {
        // Scenario: Watch sends upload packet with updatedAt = 1000.
        // Before cloud ACK arrives, watch user snoozes reminder at t = 1500 (updatedAt becomes 1500).
        // Cloud ACK arrives acknowledging old snapshot t = 1000.
        val item = createEntity(
            id = "race-1",
            updatedAt = 1500L, // Already mutated again
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(item)

        // Cloud ACK attempts to markSynced with old timestamp 1000L
        val rowsAffected = dao.markSynced("race-1", 1000L)
        assertEquals("Out-of-date sync ACK must NOT affect mutated row", 0, rowsAffected)

        val check = dao.getReminderById("race-1")
        assertEquals(
            "Sync status must remain PENDING_UPLOAD because local mutation occurred after snapshot",
            ReminderEntity.SYNC_STATUS_PENDING_UPLOAD, check?.syncStatus
        )

        // Now ACK with matching timestamp 1500L
        val validRowsAffected = dao.markSynced("race-1", 1500L)
        assertEquals(1, validRowsAffected)

        val validCheck = dao.getReminderById("race-1")
        assertEquals(ReminderEntity.SYNC_STATUS_SYNCED, validCheck?.syncStatus)
    }

    @Test
    fun boundary_nonexistentIdsReturnZeroRowsUpdated() = runTest {
        assertEquals(0, dao.snoozeReminder("non-existent", 2000L, 1000L))
        assertEquals(0, dao.completeReminder("non-existent", 1000L))
        assertEquals(0, dao.markDeleted("non-existent", 1000L))
        assertEquals(0, dao.markSynced("non-existent", 1000L))
        assertNull(dao.getReminderById("non-existent"))
    }

    @Test
    fun boundary_emptyBatchReconciliationIsNoOp() = runTest {
        dao.reconcileIncomingBatch(emptyList())
        assertEquals(0, dao.getActiveReminders().size)
    }

    @Test
    fun boundary_extremeDueDates_handleMinMaxEpochCorrectly() = runTest {
        val minEpoch = createEntity(id = "min-epoch", dueDate = 0L)
        val maxEpoch = createEntity(id = "max-epoch", dueDate = Long.MAX_VALUE)

        dao.upsertAll(listOf(maxEpoch, minEpoch))

        val active = dao.getActiveReminders()
        assertEquals(2, active.size)
        assertEquals("min-epoch", active[0].id)
        assertEquals(0L, active[0].dueDate)
        assertEquals("max-epoch", active[1].id)
        assertEquals(Long.MAX_VALUE, active[1].dueDate)
    }
}
