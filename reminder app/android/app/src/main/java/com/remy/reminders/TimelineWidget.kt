package com.remy.reminders

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray

class TimelineWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { id -> bind(context, manager, id) }
    }

    private fun bind(context: Context, manager: AppWidgetManager, id: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_timeline)

        // Set up the intent that starts the TimelineWidgetService, which will
        // provide the views for this collection.
        val intent = Intent(context, TimelineWidgetService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        
        views.setRemoteAdapter(R.id.widget_timeline_list, intent)

        // Add Quick-Add Intent on "+" button
        val addIntent = Intent(context, QuickCaptureActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val addPi = PendingIntent.getActivity(
            context,
            id * 30,
            addIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_timeline_add_btn, addPi)

        // Set up the PendingIntentTemplate for items in the list to send broadcasts back to this widget provider
        val clickIntent = Intent(context, TimelineWidget::class.java).apply {
            action = ACTION_ITEM_CLICK
        }
        val pendingIntentTemplate = PendingIntent.getBroadcast(
            context, 
            id * 30 + 1, 
            clickIntent, 
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        views.setPendingIntentTemplate(R.id.widget_timeline_list, pendingIntentTemplate)
        
        // Empty view configuration
        views.setEmptyView(R.id.widget_timeline_list, R.id.widget_timeline_empty_text)

        manager.updateAppWidget(id, views)
        manager.notifyAppWidgetViewDataChanged(id, R.id.widget_timeline_list)
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_ITEM_CLICK -> {
                val actionType = intent.getStringExtra(EXTRA_ACTION_TYPE)
                val remId = intent.getStringExtra(EXTRA_REMINDER_ID)
                when (actionType) {
                    ACTION_TYPE_OPEN -> {
                        val mainIntent = Intent(context, MainActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        }
                        context.startActivity(mainIntent)
                    }
                    ACTION_TYPE_COMPLETE -> {
                        val doneIntent = Intent(context, AgendaWidget::class.java).apply {
                            action = AgendaWidget.ACTION_COMPLETE_REMINDER
                            putExtra(AgendaWidget.EXTRA_REMINDER_ID, remId)
                        }
                        context.sendBroadcast(doneIntent)
                    }
                    ACTION_TYPE_SNOOZE -> {
                        val snoozeIntent = Intent(context, AgendaWidget::class.java).apply {
                            action = AgendaWidget.ACTION_SNOOZE_REMINDER
                            putExtra(AgendaWidget.EXTRA_REMINDER_ID, remId)
                        }
                        context.sendBroadcast(snoozeIntent)
                    }
                }
            }
            ACTION_REFRESH_WIDGET -> {
                updateAll(context)
            }
            AppWidgetManager.ACTION_APPWIDGET_UPDATE -> {
                super.onReceive(context, intent)
                val manager = AppWidgetManager.getInstance(context)
                val ids = intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS)
                if (ids != null) {
                    manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_timeline_list)
                }
            }
            else -> super.onReceive(context, intent)
        }
    }

    companion object {
        const val PREF_WIDGET_REMINDERS = "remy_widget_reminders"
        const val ACTION_REFRESH_WIDGET = "com.remy.reminders.ACTION_REFRESH_TIMELINE_WIDGET"
        const val ACTION_ITEM_CLICK = "com.remy.reminders.ACTION_TIMELINE_ITEM_CLICK"
        const val EXTRA_REMINDER_ID = "extra_reminder_id"
        const val EXTRA_ACTION_TYPE = "extra_action_type"
        const val ACTION_TYPE_OPEN = "open"
        const val ACTION_TYPE_COMPLETE = "complete"
        const val ACTION_TYPE_SNOOZE = "snooze"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TimelineWidget::class.java))
            manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_timeline_list)
            val intent = Intent(context, TimelineWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }
}
