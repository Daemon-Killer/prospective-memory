package com.remy.wear.surfaces.complication

import android.content.ComponentName
import android.content.Context
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester

/**
 * Utility for triggering push-driven updates to all active complication slots.
 * Invoked immediately upon local Room updates, Tile snoozes, or Bluetooth sync ingestion.
 */
object RemyComplicationUpdater {

    fun requestUpdate(context: Context) {
        try {
            val component = ComponentName(context, RemyComplicationService::class.java)
            val requester = ComplicationDataSourceUpdateRequester.create(context, component)
            requester.requestUpdateAll()
        } catch (e: Exception) {
            // Gracefully handle unattached complication requests in test/headless environments
        }
    }
}
