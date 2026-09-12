package com.remy.wear.sync

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.domain.SnoozeEngine
import com.remy.wear.surfaces.complication.RemyComplicationUpdater
import com.remy.wear.surfaces.tile.RemyTileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Background listener service for Bluetooth P2P communication between phone host and watch.
 *
 * Ingests incoming reminder batches via DataClient and actions via MessageClient,
 * reconciling them directly into local Room storage and notifying Complications & Tiles.
 */
class RemyWearableListenerService : WearableListenerService() {

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)

    private val database by lazy { RemyDatabase.getDatabase(applicationContext) }
    private val reminderDao by lazy { database.reminderDao() }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        serviceScope.launch {
            try {
                for (event in dataEvents) {
                    if (event.type == DataEvent.TYPE_CHANGED) {
                        val item = event.dataItem
                        if (item.uri.path == SyncContracts.PATH_REMINDERS) {
                            val payloadBytes = try {
                                DataMapItem.fromDataItem(item).dataMap.getByteArray(SyncContracts.KEY_PAYLOAD)
                            } catch (e: Exception) {
                                item.data
                            } ?: item.data

                            if (payloadBytes != null && payloadBytes.isNotEmpty()) {
                                val payload = SyncContracts.ReminderBatchPayload.fromByteArray(payloadBytes)
                                val entities = payload.reminders.map { it.toEntity() }
                                reminderDao.reconcileIncomingBatch(entities)
                                notifySystemSurfaces()
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                // Keep service alive on deserialization error
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        serviceScope.launch {
            try {
                val nowMillis = System.currentTimeMillis()
                when (messageEvent.path) {
                    SyncContracts.PATH_ACTION_SNOOZE -> {
                        val payload = SyncContracts.ActionSyncPayload.fromByteArray(messageEvent.data)
                        val reminder = reminderDao.getReminderById(payload.reminderId)
                        if (reminder != null) {
                            val duration = payload.durationMinutes ?: 15L
                            val targetDue = SnoozeEngine.calculateCustomMinutes(duration, nowMillis, reminder.dueDate)
                            reminderDao.snoozeReminder(reminder.id, targetDue, nowMillis)
                            notifySystemSurfaces()
                        }
                    }
                    SyncContracts.PATH_ACTION_COMPLETE -> {
                        val payload = SyncContracts.ActionSyncPayload.fromByteArray(messageEvent.data)
                        reminderDao.completeReminder(payload.reminderId, nowMillis)
                        notifySystemSurfaces()
                    }
                    SyncContracts.PATH_ACTION_DELETE -> {
                        val payload = SyncContracts.ActionSyncPayload.fromByteArray(messageEvent.data)
                        reminderDao.markDeleted(payload.reminderId, nowMillis)
                        notifySystemSurfaces()
                    }
                    SyncContracts.PATH_PING -> {
                        // Ping received - connection confirmed
                    }
                }
            } catch (e: Exception) {
                // Keep service alive on message handling error
            }
        }
    }

    private fun notifySystemSurfaces() {
        try {
            RemyComplicationUpdater.requestUpdate(this)
            TileService.getUpdater(this).requestUpdate(RemyTileService::class.java)
        } catch (e: Exception) {
            // Tolerate headless test environment
        }
    }
}
