package com.remy.wear.sync

import android.content.Context
import android.util.Log
import androidx.annotation.VisibleForTesting
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.NodeClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Result of an outbound synchronization cycle.
 */
sealed class SyncResult {
    /** Indicates there were no records in PENDING_UPLOAD state. */
    data object NoPending : SyncResult()

    /** Indicates successful dispatch and atomic transition of [count] records to SYNCED. */
    data class Success(val count: Int) : SyncResult()

    /** Indicates synchronization failure with the causal [error]. Pending items remain intact. */
    data class Failure(val error: Throwable) : SyncResult()
}

/**
 * Node metadata for Bluetooth and cloud connected companions.
 */
data class NodeInfo(
    val id: String,
    val displayName: String = id,
    val isNearby: Boolean = true
)

/**
 * Abstraction for DataClient putDataItem operations to facilitate deterministic testing without hardware.
 */
interface WearableDataSender {
    suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean
}

/**
 * Abstraction for MessageClient sendMessage operations.
 */
interface WearableMessageSender {
    suspend fun sendMessage(nodeId: String, path: String, payloadBytes: ByteArray): Boolean
}

/**
 * Abstraction for NodeClient connectedNodes queries.
 */
interface WearableNodeProvider {
    suspend fun getConnectedNodes(): List<NodeInfo>
}

/**
 * Default production implementation of [WearableDataSender] delegating to Google Play Services Wearable [DataClient].
 */
class PlayServicesDataSender(
    private val dataClient: DataClient
) : WearableDataSender {
    override suspend fun putData(path: String, payloadBytes: ByteArray, timestampEpochMs: Long): Boolean {
        val putDataMapReq = PutDataMapRequest.create(path).apply {
            dataMap.putByteArray(SyncContracts.KEY_PAYLOAD, payloadBytes)
            dataMap.putLong(SyncContracts.KEY_TIMESTAMP, timestampEpochMs)
            setUrgent()
        }
        val putDataReq = putDataMapReq.asPutDataRequest().setUrgent()
        dataClient.putDataItem(putDataReq).await()
        return true
    }
}

/**
 * Default production implementation of [WearableMessageSender] delegating to Google Play Services Wearable [MessageClient].
 */
class PlayServicesMessageSender(
    private val messageClient: MessageClient
) : WearableMessageSender {
    override suspend fun sendMessage(nodeId: String, path: String, payloadBytes: ByteArray): Boolean {
        messageClient.sendMessage(nodeId, path, payloadBytes).await()
        return true
    }
}

/**
 * Default production implementation of [WearableNodeProvider] delegating to Google Play Services Wearable [NodeClient].
 */
class PlayServicesNodeProvider(
    private val nodeClient: NodeClient
) : WearableNodeProvider {
    override suspend fun getConnectedNodes(): List<NodeInfo> {
        val nodes = nodeClient.connectedNodes.await()
        return nodes.map { NodeInfo(it.id, it.displayName, it.isNearby) }
    }
}

/**
 * Outbound synchronization pipeline bridging the local Room SQLite database and Play Services Wearable API:
 * 1. Queries ReminderDao.getPendingUploads() whenever local mutations occur (from Tile, Notification, or MainActivity).
 * 2. Serializes pending records into SyncContracts.ReminderBatchPayload.
 * 3. Broadcasts via DataClient (urgent putDataItem at /remy/reminders) and MessageClient to connected nodes.
 * 4. On successful delivery acknowledgment, atomically marks items SYNCED guarded by updatedAt.
 * 5. Dispatches push-driven invalidations to watch face complications and ProtoLayout tiles.
 */
class RemySyncManager @VisibleForTesting constructor(
    private val context: Context,
    private val reminderDao: ReminderDao,
    private val dataSender: WearableDataSender,
    private val messageSender: WearableMessageSender,
    private val nodeProvider: WearableNodeProvider,
    private val complicationUpdater: (Context) -> Unit = { RemyComplicationUpdater.requestUpdate(it) },
    private val tileUpdater: (Context) -> Unit = { TileService.getUpdater(it).requestUpdate(RemyTileService::class.java) },
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val requireConnectedNodes: Boolean = true
) {

    /**
     * Primary production constructor delegating to Google Play Services Wearable API clients.
     * Conforms to the SCOPE.md interface contract.
     */
    constructor(
        context: Context,
        reminderDao: ReminderDao = MainActivity.testDaoOverride ?: RemyDatabase.getDatabase(context).reminderDao(),
        dataClient: DataClient = Wearable.getDataClient(context),
        messageClient: MessageClient = Wearable.getMessageClient(context),
        nodeClient: NodeClient = Wearable.getNodeClient(context),
        dispatcher: CoroutineDispatcher = Dispatchers.IO
    ) : this(
        context = context,
        reminderDao = reminderDao,
        dataSender = PlayServicesDataSender(dataClient),
        messageSender = PlayServicesMessageSender(messageClient),
        nodeProvider = PlayServicesNodeProvider(nodeClient),
        complicationUpdater = { RemyComplicationUpdater.requestUpdate(it) },
        tileUpdater = { TileService.getUpdater(it).requestUpdate(RemyTileService::class.java) },
        dispatcher = dispatcher,
        requireConnectedNodes = true
    )

    /**
     * Executes an outbound synchronization cycle:
     * - Extracts all records currently in PENDING_UPLOAD state.
     * - Serializes into wire batch payload.
     * - Transmits across DataClient and MessageClient channels.
     * - Transitions delivered records to SYNCED guarded by updatedAt.
     * - Notifies complications and tiles upon completion.
     */
    suspend fun syncPending(): SyncResult = withContext(dispatcher) {
        try {
            val pending = reminderDao.getPendingUploads()
            if (pending.isEmpty()) {
                Log.d(TAG, "syncPending: No pending uploads found")
                return@withContext SyncResult.NoPending
            }

            Log.d(TAG, "syncPending: Found ${pending.size} pending items to sync")

            val dtos = pending.map { SyncContracts.ReminderSyncDto.fromEntity(it) }
            val nowMs = System.currentTimeMillis()
            val payload = SyncContracts.ReminderBatchPayload(
                reminders = dtos,
                timestampEpochMs = nowMs
            )
            val payloadBytes = payload.toByteArray()

            // 1. Broadcast via DataClient (urgent putDataItem)
            dataSender.putData(SyncContracts.PATH_REMINDERS, payloadBytes, payload.timestampEpochMs)

            // 2. Query connected nodes and broadcast via MessageClient
            val connectedNodes = nodeProvider.getConnectedNodes()
            if (requireConnectedNodes && connectedNodes.isEmpty()) {
                throw IOException("No connected nodes available for sync delivery")
            }

            for (node in connectedNodes) {
                messageSender.sendMessage(node.id, SyncContracts.PATH_REMINDERS, payloadBytes)
            }

            // 3. Atomically transition records to SYNCED guarded by updatedAt
            var syncedCount = 0
            for (item in pending) {
                val updatedRows = reminderDao.markSynced(item.id, item.updatedAt)
                syncedCount += updatedRows
            }

            Log.d(TAG, "syncPending: Successfully marked $syncedCount / ${pending.size} items as SYNCED")

            // 4. Invalidate system surfaces upon sync completion
            notifySurfaces()

            SyncResult.Success(syncedCount)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "syncPending failed", e)
            SyncResult.Failure(e)
        }
    }

    private fun notifySurfaces() {
        try {
            complicationUpdater(context)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to request complication update", e)
        }
        try {
            tileUpdater(context)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to request tile update", e)
        }
    }

    companion object {
        private const val TAG = "RemySyncManager"

        /**
         * Test provider override for custom sync manager injection in integration tests.
         */
        @VisibleForTesting
        var syncManagerProvider: ((Context) -> RemySyncManager)? = null

        /**
         * Global callback invoked when sync finishes (used in tests to await background trigger).
         */
        @VisibleForTesting
        var syncCompletionListener: ((SyncResult) -> Unit)? = null

        /**
         * Notification listener when triggerSync is called.
         */
        @VisibleForTesting
        var syncTriggerListener: ((Context) -> Unit)? = null

        fun create(context: Context): RemySyncManager {
            return syncManagerProvider?.invoke(context) ?: RemySyncManager(context)
        }

        /**
         * Static helper so callers can easily trigger background dispatch.
         */
        fun triggerSync(
            context: Context,
            scope: CoroutineScope = CoroutineScope(Dispatchers.IO)
        ): Job {
            val appContext = context.applicationContext ?: context
            syncTriggerListener?.invoke(appContext)
            return scope.launch {
                try {
                    val manager = create(appContext)
                    val result = manager.syncPending()
                    syncCompletionListener?.invoke(result)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Background sync trigger encountered an unhandled exception", e)
                }
            }
        }

        @VisibleForTesting
        fun resetTestOverrides() {
            syncManagerProvider = null
            syncCompletionListener = null
            syncTriggerListener = null
        }
    }
}
