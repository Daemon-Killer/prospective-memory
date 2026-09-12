package com.remy.wear.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.json.JSONException
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

/**
 * Adversarial Stress Test Suite for Milestone 2:
 * Watch-Side Outbound Sync Dispatcher (RemySyncManager.kt).
 *
 * Authored by Empirical Challenger 1 (challenger_wear_sync_m2_1).
 *
 * Adversarially probes:
 * 1. Concurrent local modification race conditions: proves that if a user snoozes or completes an item
 *    locally while an earlier sync is mid-flight, the newer updatedAt strictly prevents markSynced from
 *    marking the modified item SYNCED, preserving the newer mutation in PENDING_UPLOAD.
 * 2. Network failure injection: proves that failures in DataClient, MessageClient, or NodeClient leave
 *    all records in PENDING_UPLOAD without data loss, truncation, or corruption.
 * 3. Empty batch handling: verifies zero IO overhead and no surface spam when there are no pending uploads.
 * 4. High-volume burst synchronization: validates clean batching, wire roundtrip, and atomic transition
 *    under high item counts (100 items) and rapid successive invocation bursts.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class RemySyncManagerAdversarialStressTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao

    private lateinit var fakeDataSender: FakeWearableDataSender
    private lateinit var fakeMessageSender: FakeWearableMessageSender
    private lateinit var fakeNodeProvider: FakeWearableNodeProvider

    private val complicationUpdateCount = AtomicInteger(0)
    private val tileUpdateCount = AtomicInteger(0)

    private val testDispatcher = StandardTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()

        fakeDataSender = FakeWearableDataSender()
        fakeMessageSender = FakeWearableMessageSender()
        fakeNodeProvider = FakeWearableNodeProvider().apply {
            nodes = listOf(
                NodeInfo(id = "phone-node-primary", displayName = "Galaxy S24 Ultra", isNearby = true)
            )
        }

        complicationUpdateCount.set(0)
        tileUpdateCount.set(0)
        RemySyncManager.resetTestOverrides()
    }

    @After
    fun tearDown() {
        RemySyncManager.resetTestOverrides()
        database.close()
    }

    private fun createSyncManager(
        dataSender: WearableDataSender = fakeDataSender,
        messageSender: WearableMessageSender = fakeMessageSender,
        nodeProvider: WearableNodeProvider = fakeNodeProvider,
        requireConnectedNodes: Boolean = true
    ): RemySyncManager {
        return RemySyncManager(
            context = context,
            reminderDao = dao,
            dataSender = dataSender,
            messageSender = messageSender,
            nodeProvider = nodeProvider,
            complicationUpdater = { complicationUpdateCount.incrementAndGet() },
            tileUpdater = { tileUpdateCount.incrementAndGet() },
            dispatcher = testDispatcher,
            requireConnectedNodes = requireConnectedNodes
        )
    }

    private fun createReminder(
        id: String,
        title: String = "Stress Reminder $id",
        notes: String? = "Notes for $id",
        dueDate: Long = 1_700_000_000_000L,
        status: String = ReminderEntity.STATUS_PENDING,
        snoozeCount: Int = 0,
        lastSnoozedAt: Long? = null,
        createdAt: Long = 1_000_000L,
        updatedAt: Long = 1_000_000L,
        completedAt: Long? = null,
        isDeleted: Boolean = false,
        syncStatus: String = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
    ): ReminderEntity = ReminderEntity(
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
        isDeleted = isDeleted,
        syncStatus = syncStatus
    )

    // =========================================================================
    // CATEGORY 1: Concurrent Local Modification Race Conditions
    // =========================================================================

    @Test
    fun concurrentLocalSnoozeRace_preservesPendingUploadAndNewerUpdatedAt() = testScope.runTest {
        val tInitial = 1_000_000L
        val tSnooze = 2_000_000L
        val newDueDate = 1_700_000_900_000L

        dao.upsert(
            createReminder(
                id = "race-snooze-1",
                title = "Critical Medication",
                dueDate = 1_700_000_000_000L,
                status = ReminderEntity.STATUS_PENDING,
                snoozeCount = 0,
                updatedAt = tInitial,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        )

        // Intercept during DataClient transmission: user snoozes the reminder locally
        val midFlightInterceptingDataSender = object : WearableDataSender {
            override suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean {
                // Local user snooze action executes mid-flight
                dao.snoozeReminder("race-snooze-1", newDueDate, tSnooze)
                return true
            }
        }

        val manager = createSyncManager(dataSender = midFlightInterceptingDataSender)
        val result = manager.syncPending()

        // Sync completed successfully in terms of transmission, but marked 0 rows as SYNCED
        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        assertThat(success.count).isEqualTo(0)

        // EMPIRICAL PROOF: The database record MUST still be PENDING_UPLOAD with the new snooze state
        val record = dao.getReminderById("race-snooze-1")
        assertThat(record).isNotNull()
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(record?.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(record?.snoozeCount).isEqualTo(1)
        assertThat(record?.dueDate).isEqualTo(newDueDate)
        assertThat(record?.updatedAt).isEqualTo(tSnooze)

        // Verify subsequent sync cycle picks up the newer modification and marks it SYNCED
        val cleanManager = createSyncManager(dataSender = fakeDataSender)
        val secondResult = cleanManager.syncPending()

        assertThat(secondResult).isInstanceOf(SyncResult.Success::class.java)
        assertThat((secondResult as SyncResult.Success).count).isEqualTo(1)

        val syncedRecord = dao.getReminderById("race-snooze-1")
        assertThat(syncedRecord?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(syncedRecord?.updatedAt).isEqualTo(tSnooze)
        assertThat(dao.getPendingUploads()).isEmpty()
    }

    @Test
    fun concurrentLocalCompleteRace_preservesPendingUploadAndNewerUpdatedAt() = testScope.runTest {
        val tInitial = 1_500_000L
        val tComplete = 2_500_000L

        dao.upsert(
            createReminder(
                id = "race-complete-1",
                title = "Check Vitals",
                status = ReminderEntity.STATUS_PENDING,
                updatedAt = tInitial,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        )

        // Intercept during MessageClient transmission: user completes the reminder locally
        val midFlightInterceptingMessageSender = object : WearableMessageSender {
            override suspend fun sendMessage(nodeId: String, path: String, payloadBytes: ByteArray): Boolean {
                // Local user complete action executes mid-flight
                dao.completeReminder("race-complete-1", tComplete)
                return true
            }
        }

        val manager = createSyncManager(messageSender = midFlightInterceptingMessageSender)
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        assertThat((result as SyncResult.Success).count).isEqualTo(0)

        // EMPIRICAL PROOF: Record remains PENDING_UPLOAD with completed status preserved
        val record = dao.getReminderById("race-complete-1")
        assertThat(record).isNotNull()
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(record?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(record?.completedAt).isEqualTo(tComplete)
        assertThat(record?.updatedAt).isEqualTo(tComplete)

        // Subsequent sync dispatches completion state cleanly
        val secondResult = createSyncManager().syncPending()
        assertThat(secondResult).isInstanceOf(SyncResult.Success::class.java)
        assertThat((secondResult as SyncResult.Success).count).isEqualTo(1)

        val syncedRecord = dao.getReminderById("race-complete-1")
        assertThat(syncedRecord?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(syncedRecord?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
    }

    @Test
    fun multiItemMixedConcurrency_onlyUnmodifiedItemsTransitionToSynced() = testScope.runTest {
        val tInitial = 10_000L
        val tSnooze = 20_000L
        val tComplete = 30_000L

        // 5 items initial pending upload
        val items = (1..5).map { i ->
            createReminder(
                id = "mixed-item-$i",
                title = "Task $i",
                updatedAt = tInitial,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        }
        items.forEach { dao.upsert(it) }

        // Mid-flight: snooze item-2, complete item-4, leave 1, 3, 5 untouched
        val midFlightDataSender = object : WearableDataSender {
            override suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean {
                dao.snoozeReminder("mixed-item-2", 1_700_001_000_000L, tSnooze)
                dao.completeReminder("mixed-item-4", tComplete)
                return true
            }
        }

        val manager = createSyncManager(dataSender = midFlightDataSender)
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        // Exactly 3 unmodified items transitioned to SYNCED
        assertThat(success.count).isEqualTo(3)

        // Verify items 1, 3, 5 are SYNCED
        assertThat(dao.getReminderById("mixed-item-1")?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(dao.getReminderById("mixed-item-3")?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(dao.getReminderById("mixed-item-5")?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)

        // EMPIRICAL PROOF: items 2 and 4 MUST remain PENDING_UPLOAD
        val item2 = dao.getReminderById("mixed-item-2")
        assertThat(item2?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(item2?.status).isEqualTo(ReminderEntity.STATUS_SNOOZED)
        assertThat(item2?.updatedAt).isEqualTo(tSnooze)

        val item4 = dao.getReminderById("mixed-item-4")
        assertThat(item4?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(item4?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
        assertThat(item4?.updatedAt).isEqualTo(tComplete)

        // Pending uploads in DB are strictly the 2 modified items
        val remainingPending = dao.getPendingUploads()
        assertThat(remainingPending.map { it.id }).containsExactly("mixed-item-2", "mixed-item-4")

        // Second sync cycle clears the remaining 2
        val secondResult = createSyncManager().syncPending()
        assertThat((secondResult as SyncResult.Success).count).isEqualTo(2)
        assertThat(dao.getPendingUploads()).isEmpty()
    }

    // =========================================================================
    // CATEGORY 2: Network Failure Injection
    // =========================================================================

    @Test
    fun networkFailure_dataClientThrowsIOException_leavesAllRecordsPendingUpload() = testScope.runTest {
        dao.upsert(createReminder("fail-data-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        dao.upsert(createReminder("fail-data-2", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        fakeDataSender.shouldFail = IOException("Bluetooth transport connection severed mid-flight")

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        val failure = result as SyncResult.Failure
        assertThat(failure.error).isInstanceOf(IOException::class.java)
        assertThat(failure.error.message).contains("Bluetooth transport connection severed")

        // Invariant: Both items remain strictly PENDING_UPLOAD without corruption
        val items = dao.getPendingUploads()
        assertThat(items.map { it.id }).containsExactly("fail-data-1", "fail-data-2")

        // Surfaces must NOT be notified on failed sync
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun networkFailure_dataClientThrowsRuntimeException_handledGracefullyWithoutCrash() = testScope.runTest {
        dao.upsert(createReminder("fail-data-runtime", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        fakeDataSender.shouldFail = IllegalStateException("Play Services process died unexpectedly")

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        val failure = result as SyncResult.Failure
        assertThat(failure.error).isInstanceOf(IllegalStateException::class.java)

        val record = dao.getReminderById("fail-data-runtime")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    @Test
    fun networkFailure_messageClientThrowsIOException_leavesAllRecordsPendingUpload() = testScope.runTest {
        dao.upsert(createReminder("fail-msg-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        dao.upsert(createReminder("fail-msg-2", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        fakeMessageSender.shouldFail = IOException("MessageClient socket buffer overflow")

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        assertThat((result as SyncResult.Failure).error.message).contains("MessageClient socket buffer overflow")

        // DataClient put may have succeeded, but failure in MessageClient MUST prevent markSynced
        val items = dao.getPendingUploads()
        assertThat(items.map { it.id }).containsExactly("fail-msg-1", "fail-msg-2")
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun networkFailure_partialNodeMessageFailure_abortsBeforeMarkSynced() = testScope.runTest {
        fakeNodeProvider.nodes = listOf(
            NodeInfo("node-healthy-1", "Healthy Node", true),
            NodeInfo("node-failing-2", "Failing Node", false)
        )

        val selectiveFailingSender = object : WearableMessageSender {
            override suspend fun sendMessage(nodeId: String, path: String, payloadBytes: ByteArray): Boolean {
                if (nodeId == "node-failing-2") {
                    throw IOException("Node node-failing-2 is unreachable")
                }
                return true
            }
        }

        dao.upsert(createReminder("partial-fail-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager(messageSender = selectiveFailingSender)
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        assertThat((result as SyncResult.Failure).error.message).contains("node-failing-2 is unreachable")

        // Item must NOT transition to SYNCED because full broadcast did not complete
        val record = dao.getReminderById("partial-fail-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun networkFailure_nodeProviderThrowsException_handledCleanly() = testScope.runTest {
        dao.upsert(createReminder("node-fail-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        fakeNodeProvider.shouldFail = SecurityException("Wearable API permission revoked")

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        assertThat((result as SyncResult.Failure).error).isInstanceOf(SecurityException::class.java)

        val record = dao.getReminderById("node-fail-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    @Test
    fun flakyNetwork_repeatedFailuresFollowedByRecovery_preservesCompleteDataIntegrity() = testScope.runTest {
        val originalTitle = "Complex Medical Regimen"
        val originalNotes = "Take with 250ml water, avoid grapefruit"
        val originalDue = 1_700_500_000_000L
        val originalCreated = 1_699_000_000_000L
        val originalUpdated = 1_699_500_000_000L

        dao.upsert(
            createReminder(
                id = "flaky-rem-1",
                title = originalTitle,
                notes = originalNotes,
                dueDate = originalDue,
                status = ReminderEntity.STATUS_SNOOZED,
                snoozeCount = 2,
                lastSnoozedAt = originalUpdated,
                createdAt = originalCreated,
                updatedAt = originalUpdated,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        )

        // Attempt 1: DataClient fails
        fakeDataSender.shouldFail = IOException("Attempt 1 failure")
        val res1 = createSyncManager().syncPending()
        assertThat(res1).isInstanceOf(SyncResult.Failure::class.java)

        // Attempt 2: MessageClient fails
        fakeDataSender.shouldFail = null
        fakeMessageSender.shouldFail = IOException("Attempt 2 failure")
        val res2 = createSyncManager().syncPending()
        assertThat(res2).isInstanceOf(SyncResult.Failure::class.java)

        // Attempt 3: Node provider offline
        fakeMessageSender.shouldFail = null
        fakeNodeProvider.nodes = emptyList()
        val res3 = createSyncManager(requireConnectedNodes = true).syncPending()
        assertThat(res3).isInstanceOf(SyncResult.Failure::class.java)

        // Invariant check: Data in DB has suffered zero corruption or mutation
        val intermediateRecord = dao.getReminderById("flaky-rem-1")
        assertThat(intermediateRecord).isNotNull()
        assertThat(intermediateRecord?.title).isEqualTo(originalTitle)
        assertThat(intermediateRecord?.notes).isEqualTo(originalNotes)
        assertThat(intermediateRecord?.dueDate).isEqualTo(originalDue)
        assertThat(intermediateRecord?.snoozeCount).isEqualTo(2)
        assertThat(intermediateRecord?.lastSnoozedAt).isEqualTo(originalUpdated)
        assertThat(intermediateRecord?.updatedAt).isEqualTo(originalUpdated)
        assertThat(intermediateRecord?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        // Attempt 4: Full network recovery
        fakeNodeProvider.nodes = listOf(NodeInfo("recovered-phone", "Recovered Phone", true))
        val res4 = createSyncManager().syncPending()
        assertThat(res4).isInstanceOf(SyncResult.Success::class.java)
        assertThat((res4 as SyncResult.Success).count).isEqualTo(1)

        val finalRecord = dao.getReminderById("flaky-rem-1")
        assertThat(finalRecord?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(finalRecord?.title).isEqualTo(originalTitle)
        assertThat(finalRecord?.notes).isEqualTo(originalNotes)
        assertThat(dao.getPendingUploads()).isEmpty()
        assertThat(complicationUpdateCount.get()).isEqualTo(1)
        assertThat(tileUpdateCount.get()).isEqualTo(1)
    }

    // =========================================================================
    // CATEGORY 3: Empty Batch Handling & High-Volume Burst Synchronization
    // =========================================================================

    @Test
    fun emptyBatch_whenNoPendingUploads_returnsNoPendingAndPerformsNoIOWork() = testScope.runTest {
        // Insert 10 reminders, but all are already SYNCED
        for (i in 1..10) {
            dao.upsert(createReminder("synced-$i", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
        }

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isEqualTo(SyncResult.NoPending)
        assertThat(fakeDataSender.recordedPuts).isEmpty()
        assertThat(fakeMessageSender.recordedMessages).isEmpty()
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun emptyBatch_whenDatabaseIsEmpty_returnsNoPending() = testScope.runTest {
        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isEqualTo(SyncResult.NoPending)
        assertThat(fakeDataSender.recordedPuts).isEmpty()
        assertThat(fakeMessageSender.recordedMessages).isEmpty()
    }

    @Test
    fun highVolumeBurst_synchronizes100ItemsInSingleBatch() = testScope.runTest {
        val itemCount = 100
        for (i in 1..itemCount) {
            dao.upsert(
                createReminder(
                    id = "high-volume-$i",
                    title = "Burst Reminder Item $i",
                    notes = "Payload payload details for item $i with extensive unicode: ?????",
                    dueDate = 1_700_000_000_000L + (i * 60_000L),
                    updatedAt = 1_000_000L + i,
                    syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
                )
            )
        }

        assertThat(dao.getPendingUploads()).hasSize(itemCount)

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        assertThat(success.count).isEqualTo(itemCount)

        // Exactly 1 DataClient transmission containing all 100 serialized items
        assertThat(fakeDataSender.recordedPuts).hasSize(1)
        val putData = fakeDataSender.recordedPuts.first()
        val batchPayload = SyncContracts.ReminderBatchPayload.fromByteArray(putData.second)
        assertThat(batchPayload.reminders).hasSize(itemCount)

        // Verify wire contents for first and last items
        val firstDto = batchPayload.reminders.first()
        assertThat(firstDto.id).isEqualTo("high-volume-1")
        assertThat(firstDto.title).isEqualTo("Burst Reminder Item 1")

        val lastDto = batchPayload.reminders.last()
        assertThat(lastDto.id).isEqualTo("high-volume-100")
        assertThat(lastDto.title).isEqualTo("Burst Reminder Item 100")

        // Database verification: all 100 items atomically transitioned to SYNCED
        val pendingRemaining = dao.getPendingUploads()
        assertThat(pendingRemaining).isEmpty()

        for (i in 1..itemCount) {
            val record = dao.getReminderById("high-volume-$i")
            assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        }

        assertThat(complicationUpdateCount.get()).isEqualTo(1)
        assertThat(tileUpdateCount.get()).isEqualTo(1)
    }

    @Test
    fun burstInvocations_rapidSuccessiveSyncCallsAreIdempotent() = testScope.runTest {
        // 10 pending items
        for (i in 1..10) {
            dao.upsert(createReminder("burst-idemp-$i", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        }

        val manager = createSyncManager()

        // Rapid successive invocations: call 1 syncs all 10; subsequent calls are clean NoPending
        val res1 = manager.syncPending()
        val res2 = manager.syncPending()
        val res3 = manager.syncPending()
        val res4 = manager.syncPending()
        val res5 = manager.syncPending()

        assertThat(res1).isInstanceOf(SyncResult.Success::class.java)
        assertThat((res1 as SyncResult.Success).count).isEqualTo(10)

        assertThat(res2).isEqualTo(SyncResult.NoPending)
        assertThat(res3).isEqualTo(SyncResult.NoPending)
        assertThat(res4).isEqualTo(SyncResult.NoPending)
        assertThat(res5).isEqualTo(SyncResult.NoPending)

        // Only 1 DataClient dispatch occurred despite 5 invocations
        assertThat(fakeDataSender.recordedPuts).hasSize(1)
        assertThat(fakeMessageSender.recordedMessages).hasSize(1)
    }

    @Test
    fun wirePayload_malformedBytes_throwsExpectedExceptionCleanly() {
        // Empty bytes
        assertThrows(IllegalArgumentException::class.java) {
            SyncContracts.ReminderBatchPayload.fromByteArray(ByteArray(0))
        }

        // Garbage bytes
        assertThrows(JSONException::class.java) {
            SyncContracts.ReminderBatchPayload.fromByteArray("not a valid json string".toByteArray(Charsets.UTF_8))
        }

        // Truncated JSON
        assertThrows(JSONException::class.java) {
            SyncContracts.ReminderBatchPayload.fromByteArray("{\"reminders\": [".toByteArray(Charsets.UTF_8))
        }
    }
}
