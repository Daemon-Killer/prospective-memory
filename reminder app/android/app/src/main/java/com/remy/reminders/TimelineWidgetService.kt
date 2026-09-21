package com.remy.reminders

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class TimelineWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return TimelineRemoteViewsFactory(this.applicationContext, intent)
    }
}

class TimelineRemoteViewsFactory(
    private val context: Context,
    private val intent: Intent
) : RemoteViewsService.RemoteViewsFactory {

    private val items = mutableListOf<JSONObject>()

    override fun onCreate() {
        loadData()
    }

    override fun onDataSetChanged() {
        loadData()
    }

    override fun onDestroy() {
        items.clear()
    }

    override fun getCount(): Int = items.size

    override fun getViewAt(position: Int): RemoteViews {
        if (position >= items.size) return RemoteViews(context.packageName, R.layout.widget_timeline_item)
        val obj = items[position]
        
        val views = RemoteViews(context.packageName, R.layout.widget_timeline_item)
        
        val title = obj.optString("title", "Untitled")
        val notes = obj.optString("notes", "")
        val priority = obj.optString("priority", "")
        val armed = obj.optBoolean("armed", true)
        val dueDateStr = obj.optString("dueDate", "")
        val due = parseIso(dueDateStr)
        val now = Date()

        views.setTextViewText(R.id.widget_timeline_item_title, title)

        if (notes.isNotEmpty() && notes != "null") {
            views.setTextViewText(R.id.widget_timeline_item_notes, notes)
            views.setViewVisibility(R.id.widget_timeline_item_notes, android.view.View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.widget_timeline_item_notes, android.view.View.GONE)
        }

        if (priority.isNotEmpty() && priority != "null") {
            views.setTextViewText(R.id.widget_timeline_item_priority, priority.uppercase())
            views.setViewVisibility(R.id.widget_timeline_item_priority, android.view.View.VISIBLE)
            val pColor = when (priority.lowercase()) {
                "high" -> Color.parseColor("#EF4444")
                "medium" -> Color.parseColor("#FFB74D")
                else -> Color.parseColor("#888888")
            }
            views.setTextColor(R.id.widget_timeline_item_priority, pColor)
        } else {
            views.setViewVisibility(R.id.widget_timeline_item_priority, android.view.View.GONE)
        }

        if (!armed) {
            views.setTextViewText(R.id.widget_timeline_item_time, "INBOX")
            views.setTextColor(R.id.widget_timeline_item_time, Color.parseColor("#888888"))
        } else {
            val diffMs = due.time - now.time
            val diffMins = diffMs / 60000
            
            val timeFmt = SimpleDateFormat("HH:mm", Locale.US).apply {
                timeZone = TimeZone.getDefault()
            }.format(due)
            
            val dateFmt = SimpleDateFormat("MMM d", Locale.US).apply {
                timeZone = TimeZone.getDefault()
            }.format(due)

            if (diffMs <= 0) {
                views.setTextViewText(R.id.widget_timeline_item_time, "OVERDUE · $timeFmt")
                views.setTextColor(R.id.widget_timeline_item_time, Color.parseColor("#EF4444")) // Red
            } else if (diffMins <= 60) {
                views.setTextViewText(R.id.widget_timeline_item_time, "IN $diffMins MIN · $timeFmt")
                views.setTextColor(R.id.widget_timeline_item_time, Color.parseColor("#FFB74D")) // Yellow/Orange
            } else {
                views.setTextViewText(R.id.widget_timeline_item_time, "$dateFmt $timeFmt")
                views.setTextColor(R.id.widget_timeline_item_time, Color.parseColor("#80CBC4")) // Normal system color
            }
        }

        // Action intent for clicking the title to open
        val openIntent = Intent().apply {
            putExtra(TimelineWidget.EXTRA_ACTION_TYPE, TimelineWidget.ACTION_TYPE_OPEN)
            putExtra(TimelineWidget.EXTRA_REMINDER_ID, obj.optString("id", ""))
        }
        views.setOnClickFillInIntent(R.id.widget_timeline_item_title, openIntent)
        
        // Action intent for completing
        val completeIntent = Intent().apply {
            putExtra(TimelineWidget.EXTRA_ACTION_TYPE, TimelineWidget.ACTION_TYPE_COMPLETE)
            putExtra(TimelineWidget.EXTRA_REMINDER_ID, obj.optString("id", ""))
        }
        views.setOnClickFillInIntent(R.id.widget_timeline_item_btn_complete, completeIntent)

        // Action intent for snoozing
        val snoozeIntent = Intent().apply {
            putExtra(TimelineWidget.EXTRA_ACTION_TYPE, TimelineWidget.ACTION_TYPE_SNOOZE)
            putExtra(TimelineWidget.EXTRA_REMINDER_ID, obj.optString("id", ""))
        }
        views.setOnClickFillInIntent(R.id.widget_timeline_item_btn_snooze, snoozeIntent)
        
        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true

    private fun loadData() {
        items.clear()
        val prefs = context.getSharedPreferences("remy_capture_prefs", Context.MODE_PRIVATE)
        val rawJson = prefs.getString("remy_widget_reminders", "[]") ?: "[]"
        
        val activeList = mutableListOf<JSONObject>()
        try {
            val array = JSONArray(rawJson)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val status = obj.optString("status", "pending")
                val isDeleted = obj.optBoolean("isDeleted", false)
                if (status != "completed" && !isDeleted) {
                    activeList.add(obj)
                }
            }
            
            // Sort: Timed/Overdue first, then by date, inbox last
            val sorted = activeList.sortedWith(Comparator { a, b ->
                val armedA = a.optBoolean("armed", true)
                val armedB = b.optBoolean("armed", true)
                if (armedA && !armedB) return@Comparator -1
                if (!armedA && armedB) return@Comparator 1
                val dueA = parseIso(a.optString("dueDate", ""))
                val dueB = parseIso(b.optString("dueDate", ""))
                dueA.compareTo(dueB)
            })
            
            items.addAll(sorted)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun parseIso(iso: String): Date {
        return try {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.parse(iso.take(19)) ?: Date()
        } catch (e: Exception) {
            Date()
        }
    }
}
