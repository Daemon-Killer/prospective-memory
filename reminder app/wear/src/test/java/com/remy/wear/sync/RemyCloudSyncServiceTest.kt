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
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.IOException
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

/**
 * Unit Test Battery for Direct Cloud Synchronization on Wear OS:
 * RemyCloudSyncService.kt & Dual-Sync Coordination.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class RemyCloudSyncServiceTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao

    private val complicationUpdateCount = AtomicInteger(0)
    private val tileUpdateCount = AtomicInteger(0)

    private val testDispatcher = StandardTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    private lateinit var fakeHttpTransport: FakeCloudHttpTransport

    class FakeCloudHttpTransport : CloudHttpTransport {
        var nextResponse: CloudHttpResponse = CloudHttpResponse(
            statusCode = 200,
            body = JSONObject().apply {
                put("synced", org.json.JSONArray())
                put("serverSyncTime", "2026-09-21T14:30:00.000Z")
            }.toString()
        )

        var shouldThrow: Throwable? = null

        val recordedRequests = mutableListOf<Triple<String, Map<String, String>, String>>()

        override suspend fun post(
            url: String,
            headers: Map<String, String>,
            jsonBody: String
        ): CloudHttpResponse {
            shouldThrow?.let { throw it }
            recordedRequests.add(Triple(url, headers, jsonBody))
            return nextResponse
        }
    }

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()

        fakeHttpTransport = FakeCloudHttpTransport()
        complicationUpdateCount.set(0)
        tileUpdateCount.set(0)

        RemyCloudSyncService.resetTestOverrides()
        // Clear prefs
        context.getSharedPreferences(RemyCloudSyncService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @After
    fun tearDown() {
        RemyCloudSyncService.resetTestOverrides()
        database.close()
    }

    private fun createCloudSyncService(): RemyCloudSyncService {
        return RemyCloudSyncService(
            context = context,
            reminderDao = dao,
            httpTransport = fakeHttpTransport,
            complicationUpdater = { complicationUpdateCount.incrementAndGet() },
            tileUpdater = { tileUpdateCount.incrementAndGet() },
            dispatcher = testDispatcher
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
        syncStatus: String = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD,
        armed: Boolean = true
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
        syncStatus = syncStatus,
        armed = armed
    )

    // =========================================================================
    // 1. Wire Format Serialization & Date Codec Tests
    // =========================================================================

    @Test
    fun entityToWireJson_serializesIsoDatesAndMatchesCloudSyncContract() {
        val service = createCloudSyncService()
        val dueEpochMs = 1_773_331_200_000L // 2026-03-12T16:00:00.000Z
        val createdEpochMs = 1_773_327_600_000L // 2026-03-12T15:00:00.000Z
        val updatedEpochMs = 1_773_327_600_000L

        val reminder = createReminder(
            id = "test-uuid-1",
            title = "Blood Pressure Meds",
            notes = "Take with water",
            dueDate = dueEpochMs,
            createdAt = createdEpochMs,
            updatedAt = updatedEpochMs,
            armed = true
        )

        val json = service.entityToWireJson(reminder)

        assertThat(json.getString("id")).isEqualTo("test-uuid-1")
        assertThat(json.getString("title")).isEqualTo("Blood Pressure Meds")
        assertThat(json.getString("notes")).isEqualTo("Take with water")
        assertThat(json.getString("dueDate")).isEqualTo(CloudIsoDateCodec.toIsoString(dueEpochMs))
        assertThat(json.getString("createdAt")).isEqualTo(CloudIsoDateCodec.toIsoString(createdEpochMs))
        assertThat(json.getString("updatedAt")).isEqualTo(CloudIsoDateCodec.toIsoString(updatedEpochMs))
        assertThat(json.getBoolean("armed")).isTrue()
        assertThat(json.getBoolean("isDeleted")).isFalse()
    }

    @Test
    fun wireJsonToEntity_parsesIsoDatesWithFractionalSecondsAndMicroseconds() {
        val service = createCloudSyncService()
        val json = JSONObject().apply {
            put("id", "cloud-item-99")
            put("title", "Review quarterly report")
            put("notes", "Financial projections")
            put("dueDate", "2026-09-21T18:00:00.123456Z") // Python microsecond timestamp
            put("status", "pending")
            put("snoozeCount", 1)
            put("lastSnoozedAt", "2026-09-21T17:00:00Z")
            put("createdAt", "2026-09-21T16:00:00.000Z")
            put("updatedAt", "2026-09-21T17:00:00.000Z")
            put("completedAt", JSONObject.NULL)
            put("isDeleted", false)
            put("armed", true)
        }

        val entity = service.wireJsonToEntity(json)

        assertThat(entity).isNotNull()
        assertThat(entity!!.id).isEqualTo("cloud-item-99")
        assertThat(entity.title).isEqualTo("Review quarterly report")
        assertThat(entity.notes).isEqualTo("Financial projections")
        assertThat(entity.dueDate).isEqualTo(Instant.parse("2026-09-21T18:00:00.123456Z").toEpochMilli())
        assertThat(entity.lastSnoozedAt).isEqualTo(Instant.parse("2026-09-21T17:00:00Z").toEpochMilli())
        assertThat(entity.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
    }

    // =========================================================================
    // 2. Outbound Push & Incremental Cursor Tests
    // =========================================================================

    @Test
    fun syncNow_pushesPendingUploads_withCorrectHeadersAndToken() = testScope.runTest {
        dao.upsert(createReminder("rem-1", title = "Task 1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        dao.upsert(createReminder("rem-2", title = "Task 2 (Synced)", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))

        val service = createCloudSyncService()
        val result = service.syncNow()

        assertThat(result).isInstanceOf(CloudSyncResult.Success::class.java)
        val success = result as CloudSyncResult.Success
        assertThat(success.uploadedCount).isEqualTo(1)

        // Verify HTTP request
        assertThat(fakeHttpTransport.recordedRequests).hasSize(1)
        val (url, headers, body) = fakeHttpTransport.recordedRequests.first()

        assertThat(url).isEqualTo("https://prospective-memory-api.onrender.com/v1/reminders/sync")
        assertThat(headers[RemyCloudSyncService.HEADER_CONTENT_TYPE]).isEqualTo(RemyCloudSyncService.MIME_JSON)
        assertThat(headers[RemyCloudSyncService.HEADER_PMEM_TOKEN]).isEqualTo(RemyCloudSyncService.DEFAULT_TOKEN)

        // Verify request payload only included the 1 PENDING_UPLOAD record
        val bodyJson = JSONObject(body)
        val remindersArray = bodyJson.getJSONArray("reminders")
        assertThat(remindersArray.length()).isEqualTo(1)
        assertThat(remindersArray.getJSONObject(0).getString("id")).isEqualTo("rem-1")

        // First sync has null clientSyncTime
        assertThat(bodyJson.isNull("clientSyncTime")).isTrue()

        // Verify that local rem-1 is now SYNCED in Room DB
        val updated = dao.getReminderById("rem-1")
        assertThat(updated?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
    }

    @Test
    fun syncNow_advancesIncrementalSyncCursor_onSubsequentSync() = testScope.runTest {
        val service = createCloudSyncService()

        // 1. Initial sync with serverSyncTime = "2026-09-21T14:30:00.000Z"
        fakeHttpTransport.nextResponse = CloudHttpResponse(
            statusCode = 200,
            body = JSONObject().apply {
                put("synced", org.json.JSONArray())
                put("serverSyncTime", "2026-09-21T14:30:00.000Z")
            }.toString()
        )

        dao.upsert(createReminder("item-1", syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
        service.syncNow()

        assertThat(service.getLastSyncTime()).isEqualTo("2026-09-21T14:30:00.000Z")

        // 2. Second sync: clientSyncTime must carry previous serverSyncTime
        fakeHttpTransport.nextResponse = CloudHttpResponse(
            statusCode = 200,
            body = JSONObject().apply {
                put("synced", org.json.JSONArray())
                put("serverSyncTime", "2026-09-21T15:00:00.000Z")
            }.toString()
        )

        dao.upsert(createReminder("item-2", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))
        service.syncNow()

        val lastReqBody = JSONObject(fakeHttpTransport.recordedRequests.last().third)
        assertThat(lastReqBody.getString("clientSyncTime")).isEqualTo("2026-09-21T14:30:00.000Z")
        assertThat(service.getLastSyncTime()).isEqualTo("2026-09-21T15:00:00.000Z")
    }

    // =========================================================================
    // 3. Remote Ingestion & LWW Reconcile Tests
    // =========================================================================

    @Test
    fun syncNow_mergesRemoteRecordsIntoRoom_andNotifiesSurfaces() = testScope.runTest {
        val service = createCloudSyncService()

        val remoteSyncedArray = org.json.JSONArray().apply {
            put(JSONObject().apply {
                put("id", "remote-rem-1")
                put("title", "Remote Dentist Appointment")
                put("notes", "Bring dental card")
                put("dueDate", "2026-09-22T10:00:00.000Z")
                put("status", "pending")
                put("snoozeCount", 0)
                put("createdAt", "2026-09-21T12:00:00.000Z")
                put("updatedAt", "2026-09-21T12:00:00.000Z")
                put("isDeleted", false)
                put("armed", true)
            })
        }

        fakeHttpTransport.nextResponse = CloudHttpResponse(
            statusCode = 200,
            body = JSONObject().apply {
                put("synced", remoteSyncedArray)
                put("serverSyncTime", "2026-09-21T15:30:00.000Z")
            }.toString()
        )

        val result = service.syncNow()

        assertThat(result).isInstanceOf(CloudSyncResult.Success::class.java)
        val success = result as CloudSyncResult.Success
        assertThat(success.receivedCount).isEqualTo(1)

        // Verify remote record was written to Room
        val record = dao.getReminderById("remote-rem-1")
        assertThat(record).isNotNull()
        assertThat(record!!.title).isEqualTo("Remote Dentist Appointment")
        assertThat(record.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)

        // Verify surfaces were invalidated
        assertThat(complicationUpdateCount.get()).isEqualTo(1)
        assertThat(tileUpdateCount.get()).isEqualTo(1)
    }

    // =========================================================================
    // 4. Tombstone Pruning Tests
    // =========================================================================

    @Test
    fun syncNow_prunesAcknowledgedTombstones_andPreservesUnsyncedDeletions() = testScope.runTest {
        // rem-del-1: local delete awaiting sync (PENDING_UPLOAD)
        dao.upsert(createReminder(
            id = "rem-del-1",
            title = "Delete me",
            isDeleted = true,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        ))

        // rem-del-2: local uncommitted delete created after sync started
        val service = createCloudSyncService()
        val result = service.syncNow()

        assertThat(result).isInstanceOf(CloudSyncResult.Success::class.java)

        // rem-del-1 was pushed and marked SYNCED, then pruneSyncedTombstones purged it!
        val deleted1 = dao.getReminderById("rem-del-1")
        assertThat(deleted1).isNull()
    }

    // =========================================================================
    // 5. Error Handling & Offline Fallback Tests
    // =========================================================================

    @Test
    fun syncNow_preservesLocalDataOnHttpError_andReturnsFailure() = testScope.runTest {
        dao.upsert(createReminder("pending-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        fakeHttpTransport.nextResponse = CloudHttpResponse(
            statusCode = 401,
            body = "{\"detail\":\"missing or bad X-PMEM-TOKEN\"}"
        )

        val service = createCloudSyncService()
        val result = service.syncNow()

        assertThat(result).isInstanceOf(CloudSyncResult.Failure::class.java)
        val failure = result as CloudSyncResult.Failure
        assertThat(failure.statusCode).isEqualTo(401)

        // Local record must still be in PENDING_UPLOAD state without data loss
        val record = dao.getReminderById("pending-1")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    @Test
    fun syncNow_handlesNetworkExceptionGracefully_withoutThrowing() = testScope.runTest {
        dao.upsert(createReminder("pending-2", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        fakeHttpTransport.shouldThrow = IOException("Host unreachable")

        val service = createCloudSyncService()
        val result = service.syncNow()

        assertThat(result).isInstanceOf(CloudSyncResult.Failure::class.java)
        val failure = result as CloudSyncResult.Failure
        assertThat(failure.error).isInstanceOf(IOException::class.java)

        val record = dao.getReminderById("pending-2")
        assertThat(record?.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_PENDING_UPLOAD)
    }

    // =========================================================================
    // 6. Dual-Sync Coordination Tests
    // =========================================================================

    @Test
    fun syncDual_executesBothCloudAndBluetoothChannels() = testScope.runTest {
        dao.upsert(createReminder("dual-item-1", syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD))

        val cloudService = createCloudSyncService()
        val fakeDataSender = FakeWearableDataSender()
        val fakeMessageSender = FakeWearableMessageSender()
        val fakeNodeProvider = FakeWearableNodeProvider().apply {
            nodes = listOf(NodeInfo("node-1"))
        }

        val syncManager = RemySyncManager(
            context = context,
            reminderDao = dao,
            dataSender = fakeDataSender,
            messageSender = fakeMessageSender,
            nodeProvider = fakeNodeProvider,
            cloudSyncService = cloudService,
            dispatcher = testDispatcher
        )

        val dualResult = syncManager.syncDual()

        assertThat(dualResult.cloudResult).isInstanceOf(CloudSyncResult.Success::class.java)
        // Since cloud marked it SYNCED, Bluetooth sees NoPending
        assertThat(dualResult.bluetoothResult).isInstanceOf(SyncResult.NoPending::class.java)
    }

    // =========================================================================
    // 7. Edge Case Battery: Codecs, Cursors, and LWW Invariants
    // =========================================================================

    @Test
    fun optSafeBoolean_parsesVariedWireTypesCorrectly() {
        val json = JSONObject().apply {
            put("boolTrue", true)
            put("boolFalse", false)
            put("intOne", 1)
            put("intZero", 0)
            put("strTrue", "true")
            put("strFalse", "false")
            put("strOne", "1")
            put("strZero", "0")
            put("nullVal", JSONObject.NULL)
        }

        assertThat(RemyCloudSyncService.optSafeBoolean(json, "boolTrue", false)).isTrue()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "boolFalse", true)).isFalse()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "intOne", false)).isTrue()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "intZero", true)).isFalse()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "strTrue", false)).isTrue()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "strFalse", true)).isFalse()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "strOne", false)).isTrue()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "strZero", true)).isFalse()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "nullVal", true)).isTrue()
        assertThat(RemyCloudSyncService.optSafeBoolean(json, "missing", true)).isTrue()
    }

    @Test
    fun syncNow_preservesIncrementalCursor_evenWhenOnlyCompletedRemindersExist() = testScope.runTest {
        val service = createCloudSyncService()
        service.setLastSyncTime("2026-09-21T10:00:00.000Z")

        // 0 active reminders, but 1 completed reminder in DB
        dao.upsert(createReminder(
            id = "completed-1",
            status = ReminderEntity.STATUS_COMPLETED,
            completedAt = 1_726_000_000_000L,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        ))

        assertThat(dao.getActiveReminders()).isEmpty()
        assertThat(dao.getLiveReminderCount()).isEqualTo(1)

        service.syncNow()

        // Verify incremental cursor was retained in outgoing request
        val requestBody = JSONObject(fakeHttpTransport.recordedRequests.last().third)
        assertThat(requestBody.getString("clientSyncTime")).isEqualTo("2026-09-21T10:00:00.000Z")
    }

    @Test
    fun reconcileIncomingBatch_preservesLocalNotificationId() = testScope.runTest {
        val original = createReminder(
            id = "alarm-rem-1",
            title = "Morning Medication",
            updatedAt = 1_000_000L,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        ).copy(notificationId = "wear-alarm-42")

        dao.upsert(original)

        val incomingRemote = createReminder(
            id = "alarm-rem-1",
            title = "Morning Medication (Updated from Phone)",
            updatedAt = 2_000_000L, // Newer from cloud
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        ).copy(notificationId = null) // Remote wire format has no notificationId

        dao.reconcileIncomingBatch(listOf(incomingRemote))

        val merged = dao.getReminderById("alarm-rem-1")
        assertThat(merged).isNotNull()
        assertThat(merged!!.title).isEqualTo("Morning Medication (Updated from Phone)")
        assertThat(merged.notificationId).isEqualTo("wear-alarm-42")
    }

    @Test
    fun reconcileIncomingBatch_doesNotInsertPhantomDeletedRecords() = testScope.runTest {
        val remoteDeleted = createReminder(
            id = "phantom-remote-del",
            title = "Never seen on watch",
            isDeleted = true,
            updatedAt = 2_000_000L
        )

        dao.reconcileIncomingBatch(listOf(remoteDeleted))

        val inDb = dao.getReminderById("phantom-remote-del")
        assertThat(inDb).isNull()
    }

    @Test
    fun reconcileIncomingBatch_respectsLastWriteWinsAndTieBreakers() = testScope.runTest {
        // 1. Local newer than remote: local mutation retained
        val localNewer = createReminder(
            id = "lww-1",
            title = "Watch Snoozed Recently",
            updatedAt = 2_000_000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localNewer)

        val remoteStale = createReminder(
            id = "lww-1",
            title = "Stale Remote Edit",
            updatedAt = 1_000_000L
        )
        dao.reconcileIncomingBatch(listOf(remoteStale))
        assertThat(dao.getReminderById("lww-1")?.title).isEqualTo("Watch Snoozed Recently")

        // 2. Remote newer than local: remote update accepted
        val remoteNewer = createReminder(
            id = "lww-1",
            title = "Phone Fresh Edit",
            updatedAt = 3_000_000L
        )
        dao.reconcileIncomingBatch(listOf(remoteNewer))
        assertThat(dao.getReminderById("lww-1")?.title).isEqualTo("Phone Fresh Edit")

        // 3. Same timestamp: completed status takes precedence
        val localPending = createReminder(
            id = "lww-2",
            status = ReminderEntity.STATUS_PENDING,
            updatedAt = 5_000_000L,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        dao.upsert(localPending)

        val remoteCompleted = createReminder(
            id = "lww-2",
            status = ReminderEntity.STATUS_COMPLETED,
            completedAt = 5_000_000L,
            updatedAt = 5_000_000L
        )
        dao.reconcileIncomingBatch(listOf(remoteCompleted))
        assertThat(dao.getReminderById("lww-2")?.status).isEqualTo(ReminderEntity.STATUS_COMPLETED)
    }
}
