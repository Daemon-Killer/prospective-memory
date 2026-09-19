package com.remy.reminders.sensory

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Android background service that intercepts system notifications, applies
 * package filtering, enforces native OTP quarantine, writes vetted alerts to
 * an atomic SharedPreferences buffer, and emits realtime bridge events.
 */
class RemyNotificationListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        instance = this
        Log.d(TAG, "RemyNotificationListenerService connected to Android Notification System.")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        if (instance == this) {
            instance = null
        }
        Log.d(TAG, "RemyNotificationListenerService disconnected from Android Notification System.")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                requestRebind(ComponentName(this, RemyNotificationListenerService::class.java))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request rebind for NotificationListenerService", e)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isConnected = false
        if (instance == this) {
            instance = null
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)

        if (sbn == null) return
        val notification = sbn.notification ?: return
        val packageName = sbn.packageName ?: return

        // 1. Never monitor Remy's own notifications
        if (packageName == applicationContext.packageName) {
            return
        }

        // 2. Filter ongoing / persistent / foreground service alerts (media controls, calls, progress)
        val flags = notification.flags
        val isOngoing = (flags and Notification.FLAG_ONGOING_EVENT) != 0
        val isForeground = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            (flags and Notification.FLAG_FOREGROUND_SERVICE) != 0
        } else {
            false
        }
        if (isOngoing || isForeground) {
            return
        }

        // 3. Package Whitelist / Blacklist Filter
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!isPackagePermitted(packageName, prefs)) {
            return
        }

        // 4. Extract text content
        val extras = notification.extras
        val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        var text = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        if (text.isNullOrEmpty()) {
            text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        }
        val subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim()

        if (title.isEmpty() && text.isEmpty()) {
            return
        }

        // 5. Strict Native Security & OTP Quarantine Gate
        if (SensorySecurityFilter.isSensitiveAuth(title, text)) {
            recordQuarantine(prefs)
            Log.i(TAG, "Quarantined sensitive authentication notification from package: $packageName")
            return
        }

        // 6. Assemble Ingress Payload Envelope
        val id = UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()
        val postTime = sbn.postTime

        val payload = JSONObject().apply {
            put("id", id)
            put("key", sbn.key ?: "")
            put("packageName", packageName)
            put("title", title)
            put("text", text)
            put("subText", subText ?: JSONObject.NULL)
            put("timestamp", timestamp)
            put("postTime", postTime)
        }

        // 7. Enqueue into persistent SharedPreferences queue (FIFO cap = 100)
        enqueuePendingNotification(prefs, payload)

        // 8. Emit live event to React Native runtime if active
        RemySensoryModule.emitNotification(payload)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        // Passive ingress; dismissals in shade do not affect sensory suggestion review queue
    }

    private fun isPackagePermitted(pkg: String, prefs: SharedPreferences): Boolean {
        val configJson = prefs.getString(PREF_FILTER_CONFIG, null)
        if (configJson == null) {
            // Default Blacklist Mode: Block known system noise
            return !DEFAULT_SYSTEM_BLACKLIST.contains(pkg)
        }

        return try {
            val json = JSONObject(configJson)
            val mode = json.optString("mode", "blacklist")
            val packagesArray = json.optJSONArray("packages")
                ?: json.optJSONArray(if (mode.equals("whitelist", ignoreCase = true)) "whitelistedPackages" else "blacklistedPackages")
                ?: JSONArray()
            val packageSet = mutableSetOf<String>()
            for (i in 0 until packagesArray.length()) {
                packageSet.add(packagesArray.getString(i).trim().lowercase())
            }
            val normalizedPkg = pkg.trim().lowercase()

            if (mode.equals("whitelist", ignoreCase = true)) {
                packageSet.contains(normalizedPkg)
            } else {
                !packageSet.contains(normalizedPkg) && !DEFAULT_SYSTEM_BLACKLIST.contains(normalizedPkg)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error evaluating package filter config; falling back to blacklist", e)
            !DEFAULT_SYSTEM_BLACKLIST.contains(pkg)
        }
    }

    private fun recordQuarantine(prefs: SharedPreferences) {
        synchronized(QUEUE_LOCK) {
            val current = prefs.getInt(PREF_QUARANTINE_COUNT, 0)
            prefs.edit()
                .putInt(PREF_QUARANTINE_COUNT, current + 1)
                .putLong(PREF_LAST_QUARANTINED_AT, System.currentTimeMillis())
                .apply()
        }
    }

    private fun enqueuePendingNotification(prefs: SharedPreferences, item: JSONObject) {
        synchronized(QUEUE_LOCK) {
            try {
                val existing = prefs.getString(PREF_PENDING_NOTIFICATIONS, "[]") ?: "[]"
                val array = try {
                    JSONArray(existing)
                } catch (_: Exception) {
                    JSONArray()
                }

                // Append new notification
                array.put(item)

                // FIFO Eviction if over MAX_QUEUE_SIZE
                val trimmedArray = if (array.length() > MAX_QUEUE_SIZE) {
                    val newArr = JSONArray()
                    val startIndex = array.length() - MAX_QUEUE_SIZE
                    for (i in startIndex until array.length()) {
                        newArr.put(array.getJSONObject(i))
                    }
                    newArr
                } else {
                    array
                }

                prefs.edit().putString(PREF_PENDING_NOTIFICATIONS, trimmedArray.toString()).apply()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to enqueue pending notification to SharedPreferences", e)
            }
        }
    }

    companion object {
        const val TAG = "RemySensory"
        const val PREFS_NAME = "remy_sensory_prefs"
        const val PREF_PENDING_NOTIFICATIONS = "remy_pending_notifications"
        const val PREF_FILTER_CONFIG = "remy_filter_config"
        const val PREF_QUARANTINE_COUNT = "remy_quarantine_count"
        const val PREF_LAST_QUARANTINED_AT = "remy_last_quarantined_at"
        const val PREF_AUTO_CLEAR_PROMOS = "remy_auto_clear_promos"
        const val PREF_AUTO_SNOOZE_NOISE = "remy_auto_snooze_noise"
        const val MAX_QUEUE_SIZE = 100

        @Volatile
        var isConnected: Boolean = false

        @Volatile
        var instance: RemyNotificationListenerService? = null

        val QUEUE_LOCK = Any()

        val DEFAULT_SYSTEM_BLACKLIST = setOf(
            "android",
            "com.android.systemui",
            "com.google.android.gms",
            "com.android.vending",
            "com.android.providers.downloads",
            "com.google.android.inputmethod.latin",
            "com.samsung.android.honeyboard",
            "com.sec.android.app.launcher",
            "com.google.android.apps.nexuslauncher",
            "com.android.settings",
            "com.google.android.deskclock",
            "com.sec.android.app.clockpackage"
        )

        /**
         * Dismisses a specific status bar notification by its key.
         */
        fun dismissNotification(key: String): Boolean {
            if (key.isBlank()) return false
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot dismiss notification ($key): listener service is not connected")
                return false
            }
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    service.cancelNotification(key)
                }
                Log.i(TAG, "Dismissed notification from status bar: $key")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dismiss notification ($key)", e)
                false
            }
        }

        /**
         * Snoozes a specific status bar notification by its key for the given duration in ms.
         * Falls back to cancellation on API < 26.
         */
        fun snoozeNotification(key: String, durationMs: Long): Boolean {
            if (key.isBlank()) return false
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot snooze notification ($key): listener service is not connected")
                return false
            }
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    service.snoozeNotification(key, durationMs)
                    Log.i(TAG, "Snoozed notification $key for ${durationMs}ms")
                    true
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        service.cancelNotification(key)
                    }
                    Log.i(TAG, "Snooze fallback (cancel) for notification: $key")
                    true
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to snooze notification ($key)", e)
                false
            }
        }

        /**
         * Clears all dismissible notifications from the status bar tray.
         */
        fun dismissAllNotifications(): Boolean {
            val service = instance
            if (service == null) {
                Log.w(TAG, "Cannot dismiss all notifications: listener service is not connected")
                return false
            }
            return try {
                service.cancelAllNotifications()
                Log.i(TAG, "Dismissed all notifications from status bar")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to dismiss all notifications", e)
                false
            }
        }

        /**
         * Returns active status bar notification keys.
         */
        fun getActiveNotificationKeys(): List<String> {
            val service = instance ?: return emptyList()
            return try {
                service.activeNotifications?.mapNotNull { it.key } ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
