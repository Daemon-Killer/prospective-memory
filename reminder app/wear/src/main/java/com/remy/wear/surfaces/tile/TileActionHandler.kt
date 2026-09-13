package com.remy.wear.surfaces.tile

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.domain.SnoozeEngine
import com.remy.wear.surfaces.complication.RemyComplicationUpdater
import com.remy.wear.sync.RemySyncManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Protocol contracts for ProtoLayout 1.2 interactive tile action identifiers.
 */
object TileActionContracts {
    const val ACTION_PREFIX_SNOOZE_15M = "action_snooze_15m"
    const val ACTION_PREFIX_SNOOZE_1H = "action_snooze_1h"
    const val ACTION_PREFIX_COMPLETE = "action_complete"
    const val ACTION_PREFIX_OPEN_APP = "action_open_app"
    const val ACTION_PREFIX_VOICE_CAPTURE = "action_voice_capture"

    const val DELIMITER = ":"

    fun buildActionId(prefix: String, reminderId: String): String =
        "$prefix$DELIMITER$reminderId"

    fun parseActionId(clickableId: String?): ParsedAction? {
        if (clickableId.isNullOrBlank()) return null
        val parts = clickableId.split(DELIMITER, limit = 2)
        val prefix = parts[0]
        val reminderId = if (parts.size > 1) parts[1] else null
        return ParsedAction(prefix, reminderId)
    }

    data class ParsedAction(
        val prefix: String,
        val reminderId: String?
    )
}

/**
 * Handles background clicks triggered from the ProtoLayout Tile.
 *
 * Executes atomic Room SQLite updates, applies strict SnoozeEngine math, triggers tactile
 * haptics, and dispatches surface update requests.
 */
class TileActionHandler(
    private val reminderDao: ReminderDao,
    private val context: Context? = null,
    private val backgroundScope: CoroutineScope? = null
) {
    companion object {
        private const val TAG = "TileActionHandler"

        private val KNOWN_ACTION_PREFIXES = setOf(
            TileActionContracts.ACTION_PREFIX_SNOOZE_15M,
            TileActionContracts.ACTION_PREFIX_SNOOZE_1H,
            TileActionContracts.ACTION_PREFIX_COMPLETE,
            TileLayoutBuilder.ID_ACTION_SNOOZE_15M,
            TileLayoutBuilder.ID_ACTION_SNOOZE_1H,
            TileLayoutBuilder.ID_ACTION_COMPLETE
        )
    }

    // Secondary constructor accepting (context, reminderDao, backgroundScope)
    constructor(
        context: Context,
        reminderDao: ReminderDao,
        backgroundScope: CoroutineScope
    ) : this(reminderDao, context, backgroundScope)

    // Secondary constructor accepting only (reminderDao)
    constructor(reminderDao: ReminderDao) : this(reminderDao, null, null)

    sealed class ActionResult {
        data class SnoozeSuccess(val id: String, val newDueDate: Long) : ActionResult()
        data class CompleteSuccess(val id: String) : ActionResult()
        data object SkippedInactiveOrNotFound : ActionResult()
        data object IgnoredNoAction : ActionResult()
        data class Failure(val error: Throwable) : ActionResult()
    }

    /**
     * Executes the requested action parsed from [clickableId] and returns rich [ActionResult].
     */
    suspend fun executeAction(
        clickableId: String?,
        nowMillis: Long = System.currentTimeMillis()
    ): ActionResult {
        if (clickableId.isNullOrBlank()) return ActionResult.IgnoredNoAction

        val parsed = TileActionContracts.parseActionId(clickableId)
            ?: return ActionResult.IgnoredNoAction

        if (parsed.prefix !in KNOWN_ACTION_PREFIXES) {
            Log.d(TAG, "Unrecognized action prefix: ${parsed.prefix}")
            return ActionResult.IgnoredNoAction
        }

        return try {
            val target = if (!parsed.reminderId.isNullOrBlank()) {
                reminderDao.getReminderById(parsed.reminderId) ?: reminderDao.getNearestActiveReminder()
            } else {
                reminderDao.getNearestActiveReminder()
            }

            if (target == null || !target.isActive) {
                Log.w(TAG, "Target reminder is missing or inactive: ${parsed.reminderId}")
                return ActionResult.SkippedInactiveOrNotFound
            }

            when (parsed.prefix) {
                TileActionContracts.ACTION_PREFIX_SNOOZE_15M, TileLayoutBuilder.ID_ACTION_SNOOZE_15M -> {
                    val newDueDate = SnoozeEngine.calculate15Minutes(nowMillis, target.dueDate)
                    val rows = reminderDao.snoozeReminder(target.id, newDueDate, nowMillis)
                    if (rows > 0) {
                        playClickHaptic()
                        dispatchSurfaceUpdates()
                        triggerOutboundSync()
                        ActionResult.SnoozeSuccess(target.id, newDueDate)
                    } else {
                        ActionResult.SkippedInactiveOrNotFound
                    }
                }
                TileActionContracts.ACTION_PREFIX_SNOOZE_1H, TileLayoutBuilder.ID_ACTION_SNOOZE_1H -> {
                    val newDueDate = SnoozeEngine.calculate1Hour(nowMillis, target.dueDate)
                    val rows = reminderDao.snoozeReminder(target.id, newDueDate, nowMillis)
                    if (rows > 0) {
                        playClickHaptic()
                        dispatchSurfaceUpdates()
                        triggerOutboundSync()
                        ActionResult.SnoozeSuccess(target.id, newDueDate)
                    } else {
                        ActionResult.SkippedInactiveOrNotFound
                    }
                }
                TileActionContracts.ACTION_PREFIX_COMPLETE, TileLayoutBuilder.ID_ACTION_COMPLETE -> {
                    val rows = reminderDao.completeReminder(target.id, nowMillis)
                    if (rows > 0) {
                        playCompleteHaptic()
                        dispatchSurfaceUpdates()
                        triggerOutboundSync()
                        ActionResult.CompleteSuccess(target.id)
                    } else {
                        ActionResult.SkippedInactiveOrNotFound
                    }
                }
                else -> {
                    ActionResult.IgnoredNoAction
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Error executing tile action for: $clickableId", e)
            ActionResult.Failure(e)
        }
    }

    /**
     * Simplified boolean execution method for backward-compatibility with TileRenderTest.
     */
    suspend fun handleAction(
        clickableId: String?,
        nowMillis: Long = System.currentTimeMillis()
    ): Boolean {
        val result = executeAction(clickableId, nowMillis)
        return result is ActionResult.SnoozeSuccess || result is ActionResult.CompleteSuccess
    }

    private fun triggerOutboundSync() {
        val ctx = context ?: return
        try {
            val scope = backgroundScope ?: CoroutineScope(Dispatchers.IO)
            RemySyncManager.triggerSync(ctx, scope)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to trigger outbound sync", e)
        }
    }

    private fun dispatchSurfaceUpdates() {
        val ctx = context ?: return
        val scope = backgroundScope ?: CoroutineScope(Dispatchers.IO)
        scope.launch(Dispatchers.IO) {
            try {
                RemyComplicationUpdater.requestUpdate(ctx)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request complication update", e)
            }
        }
    }

    private fun playClickHaptic() {
        try {
            val ctx = context ?: return
            val vibrator = getVibrator(ctx) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(15L)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Unable to emit click haptic", e)
        }
    }

    private fun playCompleteHaptic() {
        try {
            val ctx = context ?: return
            val vibrator = getVibrator(ctx) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(30L)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Unable to emit complete haptic", e)
        }
    }

    private fun getVibrator(ctx: Context): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            manager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}
