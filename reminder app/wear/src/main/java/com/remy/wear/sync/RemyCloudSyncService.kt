package com.remy.wear.sync

import android.content.Context
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.annotation.VisibleForTesting
import androidx.wear.tiles.TileService
import com.remy.wear.MainActivity
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.complication.RemyComplicationUpdater
import com.remy.wear.surfaces.tile.RemyTileService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Result of a direct cloud synchronization cycle against the Prospective Memory API.
 */
sealed class CloudSyncResult {
    /**
     * Successful cloud sync cycle:
     * @param uploadedCount Number of local PENDING_UPLOAD records successfully pushed to the cloud
     * @param receivedCount Number of remote records merged into local storage
     * @param serverSyncTime RFC 3339 / ISO 8601 cursor timestamp returned by the backend
     */
    data class Success(
        val uploadedCount: Int,
        val receivedCount: Int,
        val serverSyncTime: String
    ) : CloudSyncResult()

    /**
     * Indicates synchronization failure. Local PENDING_UPLOAD records remain intact for retry.
     */
    data class Failure(
        val error: Throwable,
        val statusCode: Int? = null,
        val message: String = error.message ?: "Unknown cloud sync failure"
    ) : CloudSyncResult()
}

/**
 * Lightweight HTTP response model.
 */
data class CloudHttpResponse(
    val statusCode: Int,
    val body: String
) {
    val isSuccessful: Boolean get() = statusCode in 200..299
}

/**
 * Pluggable HTTP transport interface for lightweight zero-dependency REST operations and unit testing.
 */
interface CloudHttpTransport {
    suspend fun post(url: String, headers: Map<String, String>, jsonBody: String): CloudHttpResponse
}

/**
 * Production HTTP transport using standard java.net.HttpURLConnection.
 * Zero external library dependencies, compact APK footprint for Wear OS.
 */
class HttpUrlConnectionTransport(
    private val connectTimeoutMs: Int = 15_000,
    private val readTimeoutMs: Int = 45_000
) : CloudHttpTransport {
    override suspend fun post(
        url: String,
        headers: Map<String, String>,
        jsonBody: String
    ): CloudHttpResponse = withContext(Dispatchers.IO) {
        val urlObj = URL(url)
        val conn = urlObj.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = connectTimeoutMs
            conn.readTimeout = readTimeoutMs
            conn.doOutput = true
            conn.doInput = true
            for ((key, value) in headers) {
                conn.setRequestProperty(key, value)
            }

            val inputBytes = jsonBody.toByteArray(StandardCharsets.UTF_8)
            conn.setFixedLengthStreamingMode(inputBytes.size)
            conn.outputStream.use { os ->
                os.write(inputBytes)
                os.flush()
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) {
                conn.inputStream
            } else {
                conn.errorStream
            }
            val responseBody = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() } ?: ""
            CloudHttpResponse(code, responseBody)
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * ISO 8601 UTC date string conversion codec matching mobile cloudSyncService.ts format.
 */
object CloudIsoDateCodec {
    fun toIsoString(epochMs: Long): String {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(epochMs))
    }

    fun parseIso(isoStr: String?): Long? {
        if (isoStr.isNullOrBlank()) return null
        return try {
            Instant.parse(isoStr).toEpochMilli()
        } catch (e1: Exception) {
            try {
                OffsetDateTime.parse(isoStr).toInstant().toEpochMilli()
            } catch (e2: Exception) {
                try {
                    LocalDateTime.parse(isoStr).toInstant(ZoneOffset.UTC).toEpochMilli()
                } catch (e3: Exception) {
                    null
                }
            }
        }
    }
}

/**
 * Direct Cloud Synchronization Service for Remy Reminders on Wear OS.
 *
 * Implements bidirectional Last-Write-Wins (LWW) synchronization directly against:
 * `POST https://prospective-memory-api.onrender.com/v1/reminders/sync`
 * with header `X-PMEM-TOKEN: d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=`
 *
 * Responsibilities:
 * 1. Pushes local records flagged as PENDING_UPLOAD (including soft-delete tombstones).
 * 2. Pulls remote updates using incremental clientSyncTime cursors.
 * 3. Reconciles incoming batches into Room SQLite (ReminderDao.reconcileIncomingBatch).
 * 4. Prunes confirmed soft-deleted tombstones (ReminderDao.pruneSyncedTombstones).
 * 5. Dispatches push-driven invalidations to watch face complications and ProtoLayout tiles.
 * 6. Gracefully falls back when offline without throwing unhandled exceptions.
 */
class RemyCloudSyncService @VisibleForTesting constructor(
    private val context: Context,
    private val reminderDao: ReminderDao,
    private val httpTransport: CloudHttpTransport,
    private val complicationUpdater: (Context) -> Unit = { RemyComplicationUpdater.requestUpdate(it) },
    private val tileUpdater: (Context) -> Unit = { TileService.getUpdater(it).requestUpdate(RemyTileService::class.java) },
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val apiUrlOverride: String? = null,
    private val tokenOverride: String? = null,
    private val networkChecker: (() -> Boolean)? = null
) {
    companion object {
        private const val TAG = "RemyCloudSyncService"

        const val DEFAULT_API_URL = "https://prospective-memory-api.onrender.com"
        const val DEFAULT_TOKEN = "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4="
        const val SYNC_PATH = "/v1/reminders/sync"

        const val HEADER_CONTENT_TYPE = "Content-Type"
        const val HEADER_PMEM_TOKEN = "X-PMEM-TOKEN"
        const val MIME_JSON = "application/json"

        const val PREFS_NAME = "remy_cloud_sync_prefs"
        const val KEY_LAST_SYNC_TIME = "last_sync_time"
        const val KEY_API_URL = "api_url"
        const val KEY_TOKEN = "token"

        const val POLL_INTERVAL_MS = 30_000L

        @Volatile
        private var instance: RemyCloudSyncService? = null

        @VisibleForTesting
        var testTransportOverride: CloudHttpTransport? = null

        @VisibleForTesting
        var testServiceOverride: RemyCloudSyncService? = null

        @VisibleForTesting
        var syncCompletionListener: ((CloudSyncResult) -> Unit)? = null

        @VisibleForTesting
        var syncTriggerListener: ((Context) -> Unit)? = null

        fun getInstance(context: Context): RemyCloudSyncService {
            return testServiceOverride ?: instance ?: synchronized(this) {
                instance ?: buildDefault(context).also { instance = it }
            }
        }

        private fun buildDefault(context: Context): RemyCloudSyncService {
            val appContext = context.applicationContext ?: context
            val dao = MainActivity.testDaoOverride ?: RemyDatabase.getDatabase(appContext).reminderDao()
            val transport = testTransportOverride ?: HttpUrlConnectionTransport()
            return RemyCloudSyncService(
                context = appContext,
                reminderDao = dao,
                httpTransport = transport
            )
        }

        /**
         * Asynchronously triggers background cloud synchronization.
         */
        fun triggerSync(
            context: Context,
            scope: CoroutineScope = CoroutineScope(Dispatchers.IO),
            forceFull: Boolean = false
        ): Job {
            val appContext = context.applicationContext ?: context
            syncTriggerListener?.invoke(appContext)
            return scope.launch {
                try {
                    // Do not execute live network calls if running under Robolectric unit tests without mock transport
                    if (MainActivity.testDaoOverride != null && testTransportOverride == null && testServiceOverride == null) {
                        return@launch
                    }
                    val service = getInstance(appContext)
                    val result = service.syncNow(forceFull = forceFull)
                    syncCompletionListener?.invoke(result)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Background cloud sync trigger encountered an exception", e)
                    syncCompletionListener?.invoke(CloudSyncResult.Failure(e))
                }
            }
        }

        /**
         * Safely extracts boolean values from JSON supporting boolean, numeric (0/1), and string representations.
         */
        fun optSafeBoolean(json: JSONObject, key: String, default: Boolean): Boolean {
            if (!json.has(key) || json.isNull(key)) return default
            val obj = json.opt(key)
            return when (obj) {
                is Boolean -> obj
                is Number -> obj.toInt() != 0
                is String -> obj.equals("true", ignoreCase = true) || obj == "1"
                else -> default
            }
        }

        @VisibleForTesting
        fun resetTestOverrides() {
            testTransportOverride = null
            testServiceOverride = null
            syncCompletionListener = null
            syncTriggerListener = null
            instance = null
        }
    }

    private val syncMutex = Mutex()
    private var periodicJob: Job? = null

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getApiUrl(): String {
        return (apiUrlOverride ?: prefs.getString(KEY_API_URL, null))?.trim()?.trimEnd('/') ?: DEFAULT_API_URL
    }

    fun getToken(): String {
        return (tokenOverride ?: prefs.getString(KEY_TOKEN, null))?.trim() ?: DEFAULT_TOKEN
    }

    fun getLastSyncTime(): String? {
        return prefs.getString(KEY_LAST_SYNC_TIME, null)
    }

    fun setLastSyncTime(syncTime: String?) {
        prefs.edit().apply {
            if (syncTime.isNullOrBlank()) {
                remove(KEY_LAST_SYNC_TIME)
            } else {
                putString(KEY_LAST_SYNC_TIME, syncTime)
            }
        }.apply()
    }

    fun clearLastSyncTime() {
        setLastSyncTime(null)
    }

    /**
     * Checks if network is reachable before opening HTTP connection.
     */
    fun isNetworkAvailable(): Boolean {
        if (networkChecker != null) {
            return networkChecker.invoke()
        }
        if (httpTransport !is HttpUrlConnectionTransport) {
            return true
        }
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /**
     * Converts a local SQLite ReminderEntity to cloud wire JSON format matching phone cloudSyncService.ts.
     */
    fun entityToWireJson(entity: ReminderEntity): JSONObject {
        return JSONObject().apply {
            put("id", entity.id)
            put("title", entity.title)
            put("notes", entity.notes ?: JSONObject.NULL)
            put("dueDate", CloudIsoDateCodec.toIsoString(entity.dueDate))
            put("status", entity.status)
            put("snoozeCount", entity.snoozeCount)
            put("lastSnoozedAt", entity.lastSnoozedAt?.let { CloudIsoDateCodec.toIsoString(it) } ?: JSONObject.NULL)
            put("createdAt", CloudIsoDateCodec.toIsoString(entity.createdAt))
            put("updatedAt", CloudIsoDateCodec.toIsoString(entity.updatedAt))
            put("completedAt", entity.completedAt?.let { CloudIsoDateCodec.toIsoString(it) } ?: JSONObject.NULL)
            put("isDeleted", entity.isDeleted)
            put("armed", entity.armed)
        }
    }

    /**
     * Converts an incoming cloud wire JSON reminder object to a local ReminderEntity.
     */
    fun wireJsonToEntity(json: JSONObject): ReminderEntity? {
        val id = json.optString("id", "").trim()
        if (id.isEmpty()) return null

        val title = json.optString("title", "Untitled")
        val notes = if (json.isNull("notes")) null else json.optString("notes")
        val dueDateStr = json.optString("dueDate", "")
        val dueDate = CloudIsoDateCodec.parseIso(dueDateStr) ?: return null

        val status = json.optString("status", ReminderEntity.STATUS_PENDING)
        val snoozeCount = json.optInt("snoozeCount", 0)
        val lastSnoozedAt = if (json.isNull("lastSnoozedAt")) null else CloudIsoDateCodec.parseIso(json.optString("lastSnoozedAt"))

        val createdAtStr = json.optString("createdAt", "")
        val createdAt = CloudIsoDateCodec.parseIso(createdAtStr) ?: System.currentTimeMillis()

        val updatedAtStr = json.optString("updatedAt", "")
        val updatedAt = CloudIsoDateCodec.parseIso(updatedAtStr) ?: System.currentTimeMillis()

        val completedAt = if (json.isNull("completedAt")) null else CloudIsoDateCodec.parseIso(json.optString("completedAt"))
        val isDeleted = optSafeBoolean(json, "isDeleted", false)
        val armed = optSafeBoolean(json, "armed", true)

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
            notificationId = null,
            isDeleted = isDeleted,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED,
            armed = armed
        )
    }

    /**
     * Builds the JSON body payload for POST /v1/reminders/sync.
     */
    fun buildSyncPayload(pendingReminders: List<ReminderEntity>, clientSyncTime: String?): String {
        val root = JSONObject()
        val remindersArray = JSONArray()
        for (item in pendingReminders) {
            remindersArray.put(entityToWireJson(item))
        }
        root.put("reminders", remindersArray)
        if (clientSyncTime.isNullOrBlank()) {
            root.put("clientSyncTime", JSONObject.NULL)
        } else {
            root.put("clientSyncTime", clientSyncTime)
        }
        return root.toString()
    }

    /**
     * Resets local incremental sync cursor and forces a full sync.
     */
    suspend fun forceFullSync(): CloudSyncResult {
        clearLastSyncTime()
        return syncNow(forceFull = true)
    }

    /**
     * Executes a bidirectional synchronization cycle against the cloud backend API.
     */
    suspend fun syncNow(forceFull: Boolean = false): CloudSyncResult = withContext(dispatcher) {
        syncMutex.withLock {
            try {
                if (!isNetworkAvailable()) {
                    Log.d(TAG, "syncNow: Network currently unavailable, postponing cloud sync")
                    return@withContext CloudSyncResult.Failure(
                        error = IOException("Network unavailable"),
                        message = "Network unavailable"
                    )
                }

                val apiUrl = getApiUrl()
                val token = getToken()
                if (apiUrl.isBlank() || token.isBlank()) {
                    return@withContext CloudSyncResult.Failure(
                        error = IllegalStateException("API URL or Token is missing"),
                        message = "API URL or Token is missing"
                    )
                }

                // 1. Gather all pending local mutations
                val pending = reminderDao.getPendingUploads()
                Log.d(TAG, "syncNow: Found ${pending.size} pending uploads for cloud sync")

                // 2. Determine sync cursor
                val liveCount = reminderDao.getLiveReminderCount()
                val storedSyncTime = getLastSyncTime()
                val shouldDoFull = forceFull || storedSyncTime == null || liveCount == 0
                val clientSyncTime = if (shouldDoFull) null else storedSyncTime

                // 3. Assemble JSON wire payload
                val payloadString = buildSyncPayload(pending, clientSyncTime)
                val endpoint = "$apiUrl$SYNC_PATH"
                val headers = mapOf(
                    HEADER_CONTENT_TYPE to MIME_JSON,
                    HEADER_PMEM_TOKEN to token
                )

                Log.d(TAG, "syncNow: Dispatching sync request to $endpoint (clientSyncTime=$clientSyncTime)")
                val response = httpTransport.post(endpoint, headers, payloadString)

                if (!response.isSuccessful) {
                    val errorMsg = "HTTP ${response.statusCode}: ${response.body.take(200)}"
                    Log.e(TAG, "syncNow failed: $errorMsg")
                    return@withContext CloudSyncResult.Failure(
                        error = IOException(errorMsg),
                        statusCode = response.statusCode,
                        message = errorMsg
                    )
                }

                // 4. Parse server response
                val responseJson = JSONObject(response.body)
                val serverSyncTime = responseJson.optString("serverSyncTime", "")
                val syncedArray = responseJson.optJSONArray("synced")

                // 5. Mark pending uploaded items as cleanly SYNCED guarded by updatedAt
                var ackCount = 0
                for (item in pending) {
                    val rows = reminderDao.markSynced(item.id, item.updatedAt)
                    ackCount += rows
                }

                // 6. Reconcile incoming records via LWW
                val incomingEntities = ArrayList<ReminderEntity>()
                if (syncedArray != null) {
                    for (i in 0 until syncedArray.length()) {
                        val itemObj = syncedArray.optJSONObject(i) ?: continue
                        val entity = wireJsonToEntity(itemObj)
                        if (entity != null) {
                            incomingEntities.add(entity)
                        }
                    }
                }

                if (incomingEntities.isNotEmpty()) {
                    reminderDao.reconcileIncomingBatch(incomingEntities)
                    Log.d(TAG, "syncNow: Reconciled ${incomingEntities.size} incoming records from cloud")
                }

                // 7. Prune tombstone records that have been acknowledged as SYNCED
                val prunedTombstones = reminderDao.pruneSyncedTombstones()
                if (prunedTombstones > 0) {
                    Log.d(TAG, "syncNow: Pruned $prunedTombstones soft-deleted tombstones")
                }

                // 8. Update incremental sync cursor
                if (serverSyncTime.isNotBlank()) {
                    setLastSyncTime(serverSyncTime)
                }

                // 9. Invalidate glanceable surfaces
                notifySurfaces()

                Log.d(TAG, "syncNow: Success. Uploaded: $ackCount, Merged: ${incomingEntities.size}, Cursor: $serverSyncTime")
                CloudSyncResult.Success(
                    uploadedCount = ackCount,
                    receivedCount = incomingEntities.size,
                    serverSyncTime = serverSyncTime
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "syncNow encountered exception", e)
                CloudSyncResult.Failure(e)
            }
        }
    }

    private fun notifySurfaces() {
        try {
            complicationUpdater(context)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update complications", e)
        }
        try {
            tileUpdater(context)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update tiles", e)
        }
    }

    /**
     * Starts a periodic background polling loop to synchronize changes while app is in foreground/active.
     */
    fun startPeriodicSync(
        scope: CoroutineScope,
        intervalMs: Long = POLL_INTERVAL_MS
    ): Job {
        stopPeriodicSync()
        val job = scope.launch(dispatcher) {
            while (isActive) {
                try {
                    syncNow()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.d(TAG, "Periodic sync iteration error: ${e.message}")
                }
                delay(intervalMs)
            }
        }
        periodicJob = job
        return job
    }

    /**
     * Cancels active periodic polling loop.
     */
    fun stopPeriodicSync() {
        periodicJob?.cancel()
        periodicJob = null
    }
}
