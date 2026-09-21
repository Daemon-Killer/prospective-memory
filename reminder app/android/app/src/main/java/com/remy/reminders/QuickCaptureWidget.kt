package com.remy.reminders

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews

/**
 * AppWidget for instantaneous thought capture directly from home screen or lockscreen.
 * Supports direct 1-tap input into the app with preselected preset chips.
 */
class QuickCaptureWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { id -> bind(context, manager, id) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: Bundle,
    ) {
        bind(context, manager, id)
    }

    private fun bind(context: Context, manager: AppWidgetManager, id: Int) {
        val minW = manager.getAppWidgetOptions(id)
            .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val layout = if (minW == 0 || minW >= 140) R.layout.widget_bar else R.layout.widget_capture
        val views = RemoteViews(context.packageName, layout)

        // Default open action
        val defaultIntent = Intent(context, QuickCaptureActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val defaultPi = PendingIntent.getActivity(
            context,
            id * 10,
            defaultIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_root, defaultPi)

        if (layout == R.layout.widget_bar) {
            views.setOnClickPendingIntent(R.id.widget_input_bar, defaultPi)
            views.setOnClickPendingIntent(R.id.widget_enter_btn, defaultPi)

            // Preset "+15M" chip
            val intent15m = Intent(context, QuickCaptureActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("preset", "15m")
            }
            val pi15m = PendingIntent.getActivity(
                context,
                id * 10 + 1,
                intent15m,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_chip_15m, pi15m)

            // Preset "+1H" chip
            val intent1h = Intent(context, QuickCaptureActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("preset", "1h")
            }
            val pi1h = PendingIntent.getActivity(
                context,
                id * 10 + 2,
                intent1h,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_chip_1h, pi1h)

            // Preset "evening" chip
            val intentEvening = Intent(context, QuickCaptureActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("preset", "evening")
            }
            val piEvening = PendingIntent.getActivity(
                context,
                id * 10 + 3,
                intentEvening,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_chip_evening, piEvening)
        }

        manager.updateAppWidget(id, views)
    }
}
