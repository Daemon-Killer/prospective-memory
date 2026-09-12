package com.remy.wear.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import com.remy.wear.MainActivity
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.tile.TileActionContracts
import com.remy.wear.surfaces.tile.TileActionHandler
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Unit Test Battery for Milestone 2:
 * Watch-Side Outbound Sync Dispatcher (RemySyncManager.kt).
 *
 * Verifies:
 * 1. Pending upload polling from Room (ReminderDao.getPendingUploads).
 * 2. Serialization into valid SyncContracts.ReminderBatchPayload wire payload and deserialization roundtrip.
 * 3. Dispatch handling over DataClient (WearableDataSender) and MessageClient (WearableMessageSender).
 * 4. Atomic markSynced transition from PENDING_UPLOAD to SYNCED guarded by updatedAt (optimistic concurrency).
 * 5. Surface invalidation triggered on Complications and Tiles upon sync completion.
 * 6. Offline / failure behavior: if node sending fails or no network is available, items remain PENDING_UPLOAD without corruption.
 * 7. No-op behavior when getPendingUploads() is empty.
 * 8. Static helper RemySyncManager.triggerSync() background execution.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class RemySyncManagerTest {

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
                NodeInfo(id = "phone-node-1", displayName = "Galaxy S24", isNearby = true)
            )
        }

        complicationUpdateCount.set(0)
        tileUpdateCount.set(0)
        RemySyncManager.resetTestOverrides()
    }

    @After
    fun tearDown() {
        RemySyncManager.resetTestOverrides()
        MainActivity.testDaoOverride = null
        database.close()
    }

    private fun createSyncManager(
        requireConnectedNodes: Boolean = true
    ): RemySyncManager {
        return RemySyncManager(
            context = context,
            reminderDao = dao,
            dataSender = fakeDataSender,
            messageSender = fakeMessageSender,
            nodeProvider = fakeNodeProvider,
            complicationUpdater = { complicationUpdateCount.incrementAndGet() },
            tileUpdater = { tileUpdateCount.incrementAndGet() },
            dispatcher = testDispatcher,
            requireConnectedNodes = requireConnectedNodes
        )
    }

    private fun createReminder(
        id: String,
        title: String = "Test Reminder $id",
        notes: String? = null,
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
    // 1. Pending Upload Polling Tests
    // =========================================================================

    @Test
    fun syncPending_pollsOnlyPendingUploadRecordsFromRoom() = testScope.runTest {
        // Insert items with different sync statuses
        dao.upsert(createReminder("rem-1", title = "Pending 1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        dao.upsert(createReminder("rem-2", title = "Synced item", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
        dao.upsert(createReminder("rem-3", title = "Conflict item", syncStatus = ReminderEntity.SYNC_STATUS_CONFLICT))
        dao.upsert(createReminder("rem-4", title = "Pending 2", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        assertThat(success.count).isEqualTo(2)

        // Verify that data payload contains exactly the 2 PENDING_UPLOAD reminders
        assertThat(fakeDataSender.recordedPuts).hasSize(1)
        val put = fakeDataSender.recordedPuts.first()
        val batch = SyncContracts.ReminderBatchPayload.fromByteArray(put.second)
        val idsInBatch = batch.reminders.map { it.id }
        assertThat(idsInBatch).containsExactly("rem-1", "rem-4")
    }

    // =========================================================================
    // 2. Serialization & Wire Roundtrip Tests
    // =========================================================================

    @Test
    fun syncPending_serializesValidReminderBatchPayload_andMatchesDeserializationRoundtrip() = testScope.runTest {
        val reminder = createReminder(
            id = "roundtrip-uuid-42",
            title = "Specialist Consultation",
            notes = "Bring blood test panel",
            dueDate = 1_700_500_000_000L,
            status = ReminderEntity.STATUS_SNOOZED,
            snoozeCount = 3,
            lastSnoozedAt = 1_700_400_000_000L,
            createdAt = 1_700_000_000_000L,
            updatedAt = 1_700_400_000_000L,
            completedAt = null,
            isDeleted = false,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(reminder)

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)

        // Verify DataClient payload bytes
        val dataPut = fakeDataSender.recordedPuts.first()
        assertThat(dataPut.first).isEqualTo(SyncContracts.PATH_REMINDERS)
        val payloadBytes = dataPut.second

        // Deserialize wire bytes back into DTO
        val parsedBatch = SyncContracts.ReminderBatchPayload.fromByteArray(payloadBytes)
        assertThat(parsedBatch.reminders).hasSize(1)

        val dto = parsedBatch.reminders.first()
        assertThat(dto.id).isEqualTo(reminder.id)
        assertThat(dto.title).isEqualTo(reminder.title)
        assertThat(dto.notes).isEqualTo(reminder.notes)
        assertThat(dto.dueDate).isEqualTo(reminder.dueDate)
        assertThat(dto.status).isEqualTo(reminder.status)
        assertThat(dto.snoozeCount).isEqualTo(reminder.snoozeCount)
        assertThat(dto.lastSnoozedAt).isEqualTo(reminder.lastSnoozedAt)
        assertThat(dto.createdAt).isEqualTo(reminder.createdAt)
        assertThat(dto.updatedAt).isEqualTo(reminder.updatedAt)
        assertThat(dto.completedAt).isNull()
        assertThat(dto.isDeleted).isFalse()

        // Verify conversion back to entity retains all critical fields
        val restoredEntity = dto.toEntity(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(restoredEntity.id).isEqualTo(reminder.id)
        assertThat(restoredEntity.title).isEqualTo(reminder.title)
        assertThat(restoredEntity.dueDate).isEqualTo(reminder.dueDate)
        assertThat(restoredEntity.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
    }

    // =========================================================================
    // 3. Dispatch Handling: DataClient & MessageClient Tests
    // =========================================================================

    @Test
    fun syncPending_dispatchesOverDataClient_andAllConnectedNodesOverMessageClient() = testScope.runTest {
        fakeNodeProvider.nodes = listOf(
            NodeInfo(id = "phone-node-1", displayName = "Primary Phone", isNearby = true),
            NodeInfo(id = "tablet-node-2", displayName = "Secondary Tablet", isNearby = false)
        )

        dao.upsert(createReminder("item-alpha", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)

        // Verify DataClient received urgent putData at SyncContracts.PATH_REMINDERS
        assertThat(fakeDataSender.recordedPuts).hasSize(1)
        val put = fakeDataSender.recordedPuts.first()
        assertThat(put.first).isEqualTo(SyncContracts.PATH_REMINDERS)
        assertThat(put.third).isGreaterThan(0L) // Valid timestampEpochMs

        // Verify MessageClient broadcast to BOTH connected nodes
        assertThat(fakeMessageSender.recordedMessages).hasSize(2)
        val msg1 = fakeMessageSender.recordedMessages[0]
        assertThat(msg1.first).isEqualTo("phone-node-1")
        assertThat(msg1.second).isEqualTo(SyncContracts.PATH_REMINDERS)
        assertThat(msg1.third).isEqualTo(put.second) // Identical serialized wire payload

        val msg2 = fakeMessageSender.recordedMessages[1]
        assertThat(msg2.first).isEqualTo("tablet-node-2")
        assertThat(msg2.second).isEqualTo(SyncContracts.PATH_REMINDERS)
        assertThat(msg2.third).isEqualTo(put.second)
    }

    // =========================================================================
    // 4. Atomic markSynced Transition Guarded by updatedAt
    // =========================================================================

    @Test
    fun syncPending_atomicallyTransitionsPendingUploadToSynced_guardedByUpdatedAt() = testScope.runTest {
        val initialUpdatedAt = 1_500_000L
        dao.upsert(
            createReminder(
                id = "rem-concurrency-1",
                updatedAt = initialUpdatedAt,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        )

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        assertThat(success.count).isEqualTo(1)

        val updatedRecord = dao.getReminderById("rem-concurrency-1")
        assertThat(updatedRecord).isNotNull()
        assertThat(updatedRecord?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(updatedRecord?.updatedAt).isEqualTo(initialUpdatedAt)
    }

    @Test
    fun syncPending_preservesPendingUploadIfConcurrentMutationOccurredDuringFlight() = testScope.runTest {
        val initialUpdatedAt = 2_000_000L
        dao.upsert(
            createReminder(
                id = "rem-race-1",
                title = "Original Title",
                updatedAt = initialUpdatedAt,
                syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
            )
        )

        // Custom data sender that mutates the database mid-flight before markSynced is called
        val mutatingDataSender = object : WearableDataSender {
            override suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean {
                // Simulate local user action modifying the reminder mid-flight
                val newerUpdatedAt = 2_500_000L
                dao.snoozeReminder("rem-race-1", 1_800_000_000_000L, newerUpdatedAt)
                return true
            }
        }

        val manager = RemySyncManager(
            context = context,
            reminderDao = dao,
            dataSender = mutatingDataSender,
            messageSender = fakeMessageSender,
            nodeProvider = fakeNodeProvider,
            complicationUpdater = { complicationUpdateCount.incrementAndGet() },
            tileUpdater = { tileUpdateCount.incrementAndGet() },
            dispatcher = testDispatcher,
            requireConnectedNodes = true
        )

        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        // Concurrency guard: markSynced(id, 2_000_000) matched 0 rows because updatedAt became 2_500_000
        assertThat(success.count).isEqualTo(0)

        // Record must remain PENDING_UPLOAD with the newer mutation preserved
        val recordInDb = dao.getReminderById("rem-race-1")
        assertThat(recordInDb).isNotNull()
        assertThat(recordInDb?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(recordInDb?.updatedAt).isEqualTo(2_500_000L)
    }

    // =========================================================================
    // 5. Push-Driven Surface Invalidation Tests
    // =========================================================================

    @Test
    fun syncPending_triggersSurfaceInvalidationOnComplicationsAndTilesUponCompletion() = testScope.runTest {
        dao.upsert(createReminder("rem-surface-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        assertThat(complicationUpdateCount.get()).isEqualTo(1)
        assertThat(tileUpdateCount.get()).isEqualTo(1)
    }

    // =========================================================================
    // 6. No-Op Behavior When getPendingUploads() is Empty
    // =========================================================================

    @Test
    fun syncPending_whenNoPendingUploads_returnsNoPending_andMakesNoNetworkCalls() = testScope.runTest {
        // Only synced items in database
        dao.upsert(createReminder("rem-clean-1", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
        dao.upsert(createReminder("rem-clean-2", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isEqualTo(SyncResult.NoPending)
        assertThat(fakeDataSender.recordedPuts).isEmpty()
        assertThat(fakeMessageSender.recordedMessages).isEmpty()
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun syncPending_whenDatabaseEmpty_returnsNoPending() = testScope.runTest {
        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isEqualTo(SyncResult.NoPending)
        assertThat(fakeDataSender.recordedPuts).isEmpty()
        assertThat(fakeMessageSender.recordedMessages).isEmpty()
    }

    // =========================================================================
    // 7. Offline / Failure Behavior Tests
    // =========================================================================

    @Test
    fun syncPending_whenNoConnectedNodesAvailable_failsAndLeavesItemsPendingUpload() = testScope.runTest {
        // Simulate offline / disconnected watch
        fakeNodeProvider.nodes = emptyList()

        dao.upsert(createReminder("offline-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager(requireConnectedNodes = true)
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        val failure = result as SyncResult.Failure
        assertThat(failure.error).isInstanceOf(IOException::class.java)
        assertThat(failure.error.message).contains("No connected nodes")

        // Crucial invariant: item must remain PENDING_UPLOAD without corruption
        val record = dao.getReminderById("offline-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)

        // Surfaces should NOT be notified on failed sync
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun syncPending_whenMessageClientFails_returnsFailureAndLeavesItemsPendingUpload() = testScope.runTest {
        fakeMessageSender.shouldFail = IOException("Bluetooth socket connection aborted")

        dao.upsert(createReminder("msg-fail-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        val failure = result as SyncResult.Failure
        assertThat(failure.error).isInstanceOf(IOException::class.java)
        assertThat(failure.error.message).contains("Bluetooth socket connection aborted")

        val record = dao.getReminderById("msg-fail-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    @Test
    fun syncPending_whenDataClientFails_returnsFailureAndLeavesItemsPendingUpload() = testScope.runTest {
        fakeDataSender.shouldFail = IOException("Data layer disk store exhausted")

        dao.upsert(createReminder("data-fail-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Failure::class.java)
        val failure = result as SyncResult.Failure
        assertThat(failure.error).isInstanceOf(IOException::class.java)
        assertThat(failure.error.message).contains("Data layer disk store exhausted")

        val record = dao.getReminderById("data-fail-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
        assertThat(complicationUpdateCount.get()).isEqualTo(0)
        assertThat(tileUpdateCount.get()).isEqualTo(0)
    }

    // =========================================================================
    // 8. Static Helper RemySyncManager.triggerSync Tests
    // =========================================================================

    @Test
    fun triggerSync_executesBackgroundDispatch_andNotifiesCompletionListener() = runTest {
        dao.upsert(createReminder("trigger-item-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        var completionResult: SyncResult? = null
        val latch = CountDownLatch(1)

        val customManager = RemySyncManager(
            context = context,
            reminderDao = dao,
            dataSender = fakeDataSender,
            messageSender = fakeMessageSender,
            nodeProvider = fakeNodeProvider,
            complicationUpdater = { complicationUpdateCount.incrementAndGet() },
            tileUpdater = { tileUpdateCount.incrementAndGet() }
        )

        RemySyncManager.syncManagerProvider = { customManager }
        RemySyncManager.syncCompletionListener = { result ->
            completionResult = result
            latch.countDown()
        }

        val job = RemySyncManager.triggerSync(context)
        job.join()
        latch.await(2, TimeUnit.SECONDS)

        assertThat(completionResult).isInstanceOf(SyncResult.Success::class.java)
        val record = dao.getReminderById("trigger-item-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
        assertThat(complicationUpdateCount.get()).isEqualTo(1)
        assertThat(tileUpdateCount.get()).isEqualTo(1)
    }

    @Test
    fun syncPending_handlesLargeBatchOfPendingMutationsCleanly() = testScope.runTest {
        val totalItems = 25
        for (i in 1..totalItems) {
            dao.upsert(createReminder("batch-$i", title = "Task $i", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        }

        val manager = createSyncManager()
        val result = manager.syncPending()

        assertThat(result).isInstanceOf(SyncResult.Success::class.java)
        val success = result as SyncResult.Success
        assertThat(success.count).isEqualTo(totalItems)

        // Single atomic putData with all 25 items
        assertThat(fakeDataSender.recordedPuts).hasSize(1)
        val batch = SyncContracts.ReminderBatchPayload.fromByteArray(fakeDataSender.recordedPuts.first().second)
        assertThat(batch.reminders).hasSize(totalItems)

        // All items in DB now SYNCED
        val pendingRemaining = dao.getPendingUploads()
        assertThat(pendingRemaining).isEmpty()
    }

    // =========================================================================
    // 9. Trigger Integration Tests (TileActionHandler & MainActivity)
    // =========================================================================

    @Test
    fun tileActionHandler_snoozeAction_triggersOutboundSync() = testScope.runTest {
        val triggerCount = AtomicInteger(0)
        RemySyncManager.syncTriggerListener = { triggerCount.incrementAndGet() }

        val reminder = createReminder("tile-rem-1", dueDate = 1_700_000_000_000L)
        dao.upsert(reminder)

        val actionHandler = TileActionHandler(context, dao, testScope)
        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_SNOOZE_15M, "tile-rem-1"
        )
        val result = actionHandler.executeAction(actionId, nowMillis = 1_700_000_100_000L)

        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.SnoozeSuccess::class.java)
        assertThat(triggerCount.get()).isEqualTo(1)
    }

    @Test
    fun tileActionHandler_completeAction_triggersOutboundSync() = testScope.runTest {
        val triggerCount = AtomicInteger(0)
        RemySyncManager.syncTriggerListener = { triggerCount.incrementAndGet() }

        val reminder = createReminder("tile-rem-2", dueDate = 1_700_000_000_000L)
        dao.upsert(reminder)

        val actionHandler = TileActionHandler(context, dao, testScope)
        val actionId = TileActionContracts.buildActionId(
            TileActionContracts.ACTION_PREFIX_COMPLETE, "tile-rem-2"
        )
        val result = actionHandler.executeAction(actionId, nowMillis = 1_700_000_100_000L)

        assertThat(result).isInstanceOf(TileActionHandler.ActionResult.CompleteSuccess::class.java)
        assertThat(triggerCount.get()).isEqualTo(1)
    }

    @Test
    fun mainActivity_snoozeAction_triggersOutboundSync() = runTest {
        val triggerCount = AtomicInteger(0)
        RemySyncManager.syncTriggerListener = { triggerCount.incrementAndGet() }

        val reminder = createReminder("main-rem-1", dueDate = 1_700_000_000_000L)
        dao.upsert(reminder)

        MainActivity.testDaoOverride = dao
        val activityController = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = activityController.get()

        val job = activity.snoozeReminder(reminder)
        job.join()

        assertThat(triggerCount.get()).isAtLeast(1)
        activityController.destroy()
    }

    @Test
    fun mainActivity_completeAction_triggersOutboundSync() = runTest {
        val triggerCount = AtomicInteger(0)
        RemySyncManager.syncTriggerListener = { triggerCount.incrementAndGet() }

        val reminder = createReminder("main-rem-2", dueDate = 1_700_000_000_000L)
        dao.upsert(reminder)

        MainActivity.testDaoOverride = dao
        val activityController = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = activityController.get()

        val job = activity.completeReminder(reminder)
        job.join()

        assertThat(triggerCount.get()).isAtLeast(1)
        activityController.destroy()
    }
}

// =============================================================================
// Test Doubles / Fakes
// =============================================================================

class FakeWearableDataSender : WearableDataSender {
    val recordedPuts = mutableListOf<Triple<String, ByteArray, Long>>()
    var shouldFail: Throwable? = null

    override suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean {
        shouldFail?.let { throw it }
        recordedPuts.add(Triple(path, payloadBytes, timestampEpochMs))
        return true
    }
}

class FakeWearableMessageSender : WearableMessageSender {
    val recordedMessages = mutableListOf<Triple<String, String, ByteArray>>()
    var shouldFail: Throwable? = null

    override suspend fun sendMessage(nodeId: String, path: String, payloadBytes: ByteArray): Boolean {
        shouldFail?.let { throw it }
        recordedMessages.add(Triple(nodeId, path, payloadBytes))
        return true
    }
}

class FakeWearableNodeProvider : WearableNodeProvider {
    var nodes: List<NodeInfo> = listOf(NodeInfo("default-node", "Test Node", true))
    var shouldFail: Throwable? = null

    override suspend fun getConnectedNodes(): List<NodeInfo> {
        shouldFail?.let { throw it }
        return nodes
    }
}
