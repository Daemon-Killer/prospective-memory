package com.remy.reminders

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

/**
 * Today's glanceable agenda / top prospective memory cards widget with complete & snooze actions.
 * Supports both home screen and lockscreen (keyguard) placement.
 */
class AgendaWidget : AppWidgetProvider() {

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

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_COMPLETE_REMINDER -> {
                val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID)
                if (!reminderId.isNullOrEmpty()) {
                    handleComplete(context, reminderId)
                }
            }
            ACTION_SNOOZE_REMINDER -> {
                val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID)
                if (!reminderId.isNullOrEmpty()) {
                    handleSnooze(context, reminderId)
                }
            }
            ACTION_REFRESH_WIDGET -> {
                updateAll(context)
            }
            else -> super.onReceive(context, intent)
        }
    }

    private fun handleComplete(context: Context, reminderId: String) {
        val prefs = context.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString(PREF_WIDGET_REMINDERS, "[]") ?: "[]"
        try {
            val array = JSONArray(rawJson)
            val nowIso = formatIso(Date())
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                if (obj.optString("id") == reminderId) {
                    obj.put("status", "completed")
                    obj.put("completedAt", nowIso)
                    obj.put("updatedAt", nowIso)
                    break
                }
            }
            prefs.edit().putString(PREF_WIDGET_REMINDERS, array.toString()).apply()
            updateAll(context)

            // Post completion to cloud backend in background thread
            thread {
                postCompleteToBackend(context, reminderId)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun handleSnooze(context: Context, reminderId: String) {
        val prefs = context.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString(PREF_WIDGET_REMINDERS, "[]") ?: "[]"
        try {
            val array = JSONArray(rawJson)
            val now = Date()
            val nowIso = formatIso(now)
            val cal = Calendar.getInstance().apply {
                time = now
                add(Calendar.MINUTE, 15)
            }
            val targetDueDateIso = formatIso(cal.time)

            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                if (obj.optString("id") == reminderId) {
                    obj.put("dueDate", targetDueDateIso)
                    obj.put("status", "snoozed")
                    obj.put("snoozeCount", obj.optInt("snoozeCount", 0) + 1)
                    obj.put("lastSnoozedAt", nowIso)
                    obj.put("updatedAt", nowIso)
                    obj.put("armed", true)
                    break
                }
            }
            prefs.edit().putString(PREF_WIDGET_REMINDERS, array.toString()).apply()
            updateAll(context)

            // Post snooze to cloud backend in background thread
            thread {
                postSnoozeToBackend(context, reminderId, targetDueDateIso)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun bind(context: Context, manager: AppWidgetManager, id: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_agenda)
        val prefs = context.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val rawJson = prefs.getString(PREF_WIDGET_REMINDERS, "[]") ?: "[]"

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
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Add Quick-Add Intent on "+" button
        val addIntent = Intent(context, QuickCaptureActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val addPi = PendingIntent.getActivity(
            context,
            id * 20,
            addIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_agenda_add_btn, addPi)

        // Open MainActivity Intent
        val mainIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val mainPi = PendingIntent.getActivity(
            context,
            id * 20 + 1,
            mainIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        views.setOnClickPendingIntent(R.id.widget_btn_open, mainPi)

        if (activeList.isEmpty()) {
            views.setViewVisibility(R.id.widget_agenda_card_container, View.GONE)
            views.setViewVisibility(R.id.widget_agenda_empty_box, View.VISIBLE)
            views.setTextViewText(R.id.widget_agenda_count, "0 ACTIVE")
            views.setOnClickPendingIntent(R.id.widget_agenda_empty_box, addPi)
        } else {
            views.setViewVisibility(R.id.widget_agenda_card_container, View.VISIBLE)
            views.setViewVisibility(R.id.widget_agenda_empty_box, View.GONE)
            views.setTextViewText(R.id.widget_agenda_count, "${activeList.size} ACTIVE")

            // Sort: Timed/Overdue first, then by date, inbox last
            val now = Date()
            val sorted = activeList.sortedWith(Comparator { a, b ->
                val armedA = a.optBoolean("armed", true)
                val armedB = b.optBoolean("armed", true)
                if (armedA && !armedB) return@Comparator -1
                if (!armedA && armedB) return@Comparator 1
                val dueA = parseIso(a.optString("dueDate", ""))
                val dueB = parseIso(b.optString("dueDate", ""))
                dueA.compareTo(dueB)
            })

            val top = sorted.first()
            val remId = top.optString("id", "")
            val title = top.optString("title", "Untitled")
            val notes = top.optString("notes", "")
            val priority = top.optString("priority", "")
            val armed = top.optBoolean("armed", true)
            val dueDateStr = top.optString("dueDate", "")
            val due = parseIso(dueDateStr)

            views.setTextViewText(R.id.widget_agenda_card_title, title)
            views.setOnClickPendingIntent(R.id.widget_agenda_card_title, mainPi)

            // Notes
            if (notes.isNotEmpty() && notes != "null") {
                views.setTextViewText(R.id.widget_agenda_card_notes, notes)
                views.setViewVisibility(R.id.widget_agenda_card_notes, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.widget_agenda_card_notes, View.GONE)
            }

            // Priority Badge
            if (priority.isNotEmpty() && priority != "null") {
                views.setTextViewText(R.id.widget_agenda_priority, priority.uppercase())
                views.setViewVisibility(R.id.widget_agenda_priority, View.VISIBLE)
                val pColor = when (priority.lowercase()) {
                    "high" -> Color.parseColor("#EF4444")
                    "medium" -> Color.parseColor("#FFB74D")
                    else -> Color.parseColor("#888888")
                }
                views.setTextColor(R.id.widget_agenda_priority, pColor)
            } else {
                views.setViewVisibility(R.id.widget_agenda_priority, View.GONE)
            }

            // Time / Due Format
            if (!armed) {
                views.setTextViewText(R.id.widget_agenda_time, "INBOX THOUGHT")
                views.setTextColor(R.id.widget_agenda_time, Color.parseColor("#888888"))
            } else {
                val isOverdue = due.before(now)
                val timeFmt = SimpleDateFormat("HH:mm", Locale.US).apply {
                    timeZone = TimeZone.getDefault()
                }.format(due)
                val dateFmt = SimpleDateFormat("MMM d", Locale.US).apply {
                    timeZone = TimeZone.getDefault()
                }.format(due)

                if (isOverdue) {
                    views.setTextViewText(R.id.widget_agenda_time, "! OVERDUE · $timeFmt")
                    views.setTextColor(R.id.widget_agenda_time, Color.parseColor("#EF4444"))
                } else {
                    views.setTextViewText(R.id.widget_agenda_time, "DUE $dateFmt AT $timeFmt")
                    views.setTextColor(R.id.widget_agenda_time, Color.parseColor("#80CBC4"))
                }
            }

            // Action: Complete
            val doneIntent = Intent(context, AgendaWidget::class.java).apply {
                action = ACTION_COMPLETE_REMINDER
                putExtra(EXTRA_REMINDER_ID, remId)
            }
            val donePi = PendingIntent.getBroadcast(
                context,
                id * 20 + 2,
                doneIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_btn_done, donePi)

            // Action: Snooze (+15M)
            val snoozeIntent = Intent(context, AgendaWidget::class.java).apply {
                action = ACTION_SNOOZE_REMINDER
                putExtra(EXTRA_REMINDER_ID, remId)
            }
            val snoozePi = PendingIntent.getBroadcast(
                context,
                id * 20 + 3,
                snoozeIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            views.setOnClickPendingIntent(R.id.widget_btn_snooze, snoozePi)
        }

        manager.updateAppWidget(id, views)
    }

    private fun postCompleteToBackend(context: Context, reminderId: String) {
        try {
            val prefs = context.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val baseApiUrl = prefs.getString(QuickCaptureActivity.PREF_API_URL, "https://prospective-memory-api.onrender.com")
                ?.trim()?.removeSuffix("/") ?: "https://prospective-memory-api.onrender.com"
            val token = prefs.getString(QuickCaptureActivity.PREF_TOKEN, "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=")
                ?.trim() ?: "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4="

            val url = URL("$baseApiUrl/v1/reminders/$reminderId/complete")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-PMEM-TOKEN", token)
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun postSnoozeToBackend(context: Context, reminderId: String, targetDateIso: String) {
        try {
            val prefs = context.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val baseApiUrl = prefs.getString(QuickCaptureActivity.PREF_API_URL, "https://prospective-memory-api.onrender.com")
                ?.trim()?.removeSuffix("/") ?: "https://prospective-memory-api.onrender.com"
            val token = prefs.getString(QuickCaptureActivity.PREF_TOKEN, "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=")
                ?.trim() ?: "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4="

            val url = URL("$baseApiUrl/v1/reminders/$reminderId/snooze")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-PMEM-TOKEN", token)
            conn.doOutput = true
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            val json = JSONObject().apply {
                put("dueDate", targetDateIso)
            }
            OutputStreamWriter(conn.outputStream).use { it.write(json.toString()) }
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    companion object {
        const val PREF_WIDGET_REMINDERS = "remy_widget_reminders"
        const val ACTION_COMPLETE_REMINDER = "com.remy.reminders.ACTION_COMPLETE_REMINDER"
        const val ACTION_SNOOZE_REMINDER = "com.remy.reminders.ACTION_SNOOZE_REMINDER"
        const val ACTION_REFRESH_WIDGET = "com.remy.reminders.ACTION_REFRESH_WIDGET"
        const val EXTRA_REMINDER_ID = "extra_reminder_id"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, AgendaWidget::class.java))
            val intent = Intent(context, AgendaWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }

        private fun formatIso(d: Date): String {
            return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(d)
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
}
