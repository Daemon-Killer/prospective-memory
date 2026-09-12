package com.remy.wear.surfaces.tile

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ResourceBuilders.Resources
import androidx.wear.tiles.RequestBuilders.ResourcesRequest
import androidx.wear.tiles.RequestBuilders.TileRequest
import androidx.wear.tiles.TileBuilders.Tile
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import com.remy.wear.data.local.RemyDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Wear OS TileService for Remy Reminders.
 *
 * Provides a 1-swipe interactive glance at active prospective memory cues with inline
 * snooze (+15m, +1h) and complete buttons using ProtoLayout 1.2 ActionBuilders.LoadAction.
 */
class RemyTileService : TileService() {

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)

    private val database by lazy { RemyDatabase.getDatabase(applicationContext) }
    private val reminderDao by lazy { database.reminderDao() }
    private val actionHandler by lazy { TileActionHandler(this, reminderDao, serviceScope) }

    companion object {
        const val RESOURCES_VERSION = "1"
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    override fun onTileResourcesRequest(
        requestParams: ResourcesRequest
    ): ListenableFuture<Resources> = CallbackToFutureAdapter.getFuture { completer ->
        completer.set(
            Resources.Builder()
                .setVersion(RESOURCES_VERSION)
                .build()
        )
        "RemyTileService#onTileResourcesRequest"
    }

    override fun onTileRequest(
        requestParams: TileRequest
    ): ListenableFuture<Tile> = CallbackToFutureAdapter.getFuture { completer ->
        serviceScope.launch {
            try {
                // 1. Process inline interactive click if present
                val lastClickId = requestParams.currentState?.lastClickableId
                if (!lastClickId.isNullOrEmpty()) {
                    actionHandler.executeAction(lastClickId)
                }

                // 2. Fetch fresh active reminders snapshot
                val activeReminders = reminderDao.getActiveReminders()

                // 3. Render layout with device parameters
                val tile = TileLayoutBuilder.renderTile(
                    context = this@RemyTileService,
                    reminders = activeReminders,
                    deviceParams = requestParams.deviceConfiguration
                )

                completer.set(tile)
            } catch (e: Throwable) {
                try {
                    val fallbackTile = TileLayoutBuilder.renderTile(
                        context = this@RemyTileService,
                        reminders = emptyList(),
                        deviceParams = requestParams.deviceConfiguration
                    )
                    completer.set(fallbackTile)
                } catch (fallbackError: Throwable) {
                    completer.setException(e)
                }
            }
        }
        "RemyTileService#onTileRequest"
    }
}
