package com.remy.wear.surfaces.complication

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.RemyDatabase

/**
 * Native Wear OS 5 Complication Data Source Service.
 * Serves dynamic countdowns (SHORT_TEXT) and elapsed progress gauges (RANGED_VALUE) to watch faces.
 */
class RemyComplicationService : SuspendingComplicationDataSourceService() {

    internal var testDao: ReminderDao? = null

    private val reminderDao: ReminderDao by lazy {
        testDao ?: RemyDatabase.getDatabase(applicationContext).reminderDao()
    }

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val nearestReminder = reminderDao.getNearestActiveReminder()
        val nowMillis = System.currentTimeMillis()
        val tapAction = createTapAction(this)

        return when (request.complicationType) {
            ComplicationType.SHORT_TEXT -> {
                RemyComplicationFactory.buildShortTextComplication(
                    reminder = nearestReminder,
                    nowMillis = nowMillis,
                    tapAction = tapAction
                )
            }
            ComplicationType.RANGED_VALUE -> {
                RemyComplicationFactory.buildRangedValueComplication(
                    reminder = nearestReminder,
                    nowMillis = nowMillis,
                    tapAction = tapAction
                )
            }
            else -> null
        }
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData? {
        val tapAction = createTapAction(this)
        return RemyComplicationFactory.buildPreviewData(type, tapAction)
    }

    companion object {
        const val TAP_ACTION_REQUEST_CODE = 2001

        /**
         * Defensive PendingIntent creation: launches the app's entry activity.
         */
        fun createTapAction(context: Context): PendingIntent? {
            val launchIntent = context.packageManager?.getLaunchIntentForPackage(context.packageName)
                ?: Intent().apply {
                    setClassName(context.packageName, "com.remy.wear.MainActivity")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }

            return PendingIntent.getActivity(
                context,
                TAP_ACTION_REQUEST_CODE,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
