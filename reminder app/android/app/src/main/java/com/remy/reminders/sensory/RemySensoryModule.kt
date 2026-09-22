package com.remy.reminders.sensory

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject

/**
 * React Native bridge module exposing permission state, intent launchers,
 * atomic queue draining, and filter configuration.
 */
class RemySensoryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        reactContextRef = reactContext
    }

    override fun getName(): String = "RemySensoryModule"

    @ReactMethod
    fun isPermissionGranted(promise: Promise) {
        try {
            val enabled = isNotificationServiceEnabled(reactContext)
            if (enabled && RemyNotificationListenerService.instance == null) {
                checkAndRebindIfNeeded(reactContext)
            }
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERR_CHECK_PERMISSION", e.message)
        }
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        try {
            val isEnabled = isNotificationServiceEnabled(reactContext)
            if (!isEnabled) {
                var launched = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        val detailIntent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).apply {
                            putExtra(
                                Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                                ComponentName(reactContext, RemyNotificationListenerService::class.java).flattenToString()
                            )
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        if (detailIntent.resolveActivity(reactContext.packageManager) != null) {
                            reactContext.startActivity(detailIntent)
                            launched = true
                        }
                    } catch (e: Exception) {
                        Log.w("RemySensory", "Failed to launch detail settings; falling back", e)
                    }
                }
                if (!launched) {
                    val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(intent)
                }
                promise.resolve(false)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERR_REQUEST_PERMISSION", e.message)
        }
    }

    @ReactMethod
    fun openNotificationListenerSettings(promise: Promise) {
        try {
            var launched = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    val detailIntent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).apply {
                        putExtra(
                            Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                            ComponentName(reactContext, RemyNotificationListenerService::class.java).flattenToString()
                        )
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    if (detailIntent.resolveActivity(reactContext.packageManager) != null) {
                        reactContext.startActivity(detailIntent)
                        launched = true
                    }
                } catch (e: Exception) {
                    Log.w("RemySensory", "Failed to open detail settings; falling back", e)
                }
            }
            if (!launched) {
                val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_OPEN_SETTINGS", e.message)
        }
    }

    @ReactMethod
    fun getPendingNotifications(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val json = prefs.getString(
                RemyNotificationListenerService.PREF_PENDING_NOTIFICATIONS,
                "[]"
            ) ?: "[]"
            promise.resolve(json)
        } catch (e: Exception) {
            promise.reject("ERR_GET_PENDING", e.message)
        }
    }

    @ReactMethod
    fun clearPendingNotifications(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            synchronized(RemyNotificationListenerService.QUEUE_LOCK) {
                prefs.edit()
                    .remove(RemyNotificationListenerService.PREF_PENDING_NOTIFICATIONS)
                    .apply()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_CLEAR_PENDING", e.message)
        }
    }

    /**
     * Atomically reads and purges buffered notifications in a single synchronized transaction.
     */
    @ReactMethod
    fun drainPendingNotifications(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val resultJson: String
            synchronized(RemyNotificationListenerService.QUEUE_LOCK) {
                resultJson = prefs.getString(
                    RemyNotificationListenerService.PREF_PENDING_NOTIFICATIONS,
                    "[]"
                ) ?: "[]"
                prefs.edit()
                    .remove(RemyNotificationListenerService.PREF_PENDING_NOTIFICATIONS)
                    .apply()
            }
            promise.resolve(resultJson)
        } catch (e: Exception) {
            promise.reject("ERR_DRAIN_PENDING", e.message)
        }
    }

    @ReactMethod
    fun getFilterConfig(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val json = prefs.getString(RemyNotificationListenerService.PREF_FILTER_CONFIG, null)
            promise.resolve(json)
        } catch (e: Exception) {
            promise.reject("ERR_GET_FILTER_CONFIG", e.message)
        }
    }

    @ReactMethod
    fun updateFilterConfig(configJson: String, promise: Promise) {
        try {
            // Validate JSON syntax before saving
            val json = JSONObject(configJson)
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val editor = prefs.edit()
                .putString(RemyNotificationListenerService.PREF_FILTER_CONFIG, configJson)
            if (json.has("autoClearPromos")) {
                editor.putBoolean(
                    RemyNotificationListenerService.PREF_AUTO_CLEAR_PROMOS,
                    json.optBoolean("autoClearPromos", true)
                )
            }
            if (json.has("autoSnoozeNoise")) {
                editor.putBoolean(
                    RemyNotificationListenerService.PREF_AUTO_SNOOZE_NOISE,
                    json.optBoolean("autoSnoozeNoise", false)
                )
            }
            if (json.has("autoClearScam")) {
                editor.putBoolean(
                    RemyNotificationListenerService.PREF_AUTO_CLEAR_SCAM,
                    json.optBoolean("autoClearScam", true)
                )
            }
            editor.apply()
            RemyNotificationListenerService.processActiveNotifications()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_UPDATE_FILTER_CONFIG", "Invalid filter JSON: ${e.message}")
        }
    }

    @ReactMethod
    fun getQuarantineStats(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val count = prefs.getInt(RemyNotificationListenerService.PREF_QUARANTINE_COUNT, 0)
            val lastAt = prefs.getLong(RemyNotificationListenerService.PREF_LAST_QUARANTINED_AT, 0L)

            val map = Arguments.createMap().apply {
                putInt("quarantinedCount", count)
                if (lastAt > 0L) {
                    putDouble("lastQuarantinedAt", lastAt.toDouble())
                } else {
                    putNull("lastQuarantinedAt")
                }
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_GET_QUARANTINE_STATS", e.message)
        }
    }

    @ReactMethod
    fun clearQuarantineStats(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putInt(RemyNotificationListenerService.PREF_QUARANTINE_COUNT, 0)
                .remove(RemyNotificationListenerService.PREF_LAST_QUARANTINED_AT)
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_CLEAR_QUARANTINE_STATS", e.message)
        }
    }

    @ReactMethod
    fun simulateNotification(notificationJson: String, promise: Promise) {
        try {
            val json = JSONObject(notificationJson)
            val title = json.optString("title", "")
            val text = json.optString("text", "")

            if (SensorySecurityFilter.isSensitiveAuth(title, text)) {
                val prefs = reactContext.getSharedPreferences(
                    RemyNotificationListenerService.PREFS_NAME,
                    Context.MODE_PRIVATE
                )
                val current = prefs.getInt(RemyNotificationListenerService.PREF_QUARANTINE_COUNT, 0)
                prefs.edit()
                    .putInt(RemyNotificationListenerService.PREF_QUARANTINE_COUNT, current + 1)
                    .putLong(RemyNotificationListenerService.PREF_LAST_QUARANTINED_AT, System.currentTimeMillis())
                    .apply()

                val res = Arguments.createMap().apply {
                    putString("status", "quarantined")
                    putString("reason", "Sensitive credential / OTP pattern detected")
                }
                promise.resolve(res)
                return
            }

            emitNotification(json)
            val res = Arguments.createMap().apply {
                putString("status", "emitted")
            }
            promise.resolve(res)
        } catch (e: Exception) {
            promise.reject("ERR_SIMULATE_NOTIFICATION", e.message)
        }
    }

    @ReactMethod
    fun dismissNotification(key: String?, promise: Promise) {
        try {
            if (key.isNullOrBlank()) {
                promise.resolve(false)
                return
            }
            val success = RemyNotificationListenerService.dismissNotification(key)
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("ERR_DISMISS_NOTIFICATION", e.message)
        }
    }

    @ReactMethod
    fun snoozeNotification(key: String?, durationMs: Double, promise: Promise) {
        try {
            if (key.isNullOrBlank()) {
                promise.resolve(false)
                return
            }
            val success = RemyNotificationListenerService.snoozeNotification(key, durationMs.toLong())
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("ERR_SNOOZE_NOTIFICATION", e.message)
        }
    }

    @ReactMethod
    fun dismissAllNotifications(promise: Promise) {
        try {
            val success = RemyNotificationListenerService.dismissAllNotifications()
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("ERR_DISMISS_ALL_NOTIFICATIONS", e.message)
        }
    }

    @ReactMethod
    fun getActiveNotificationKeys(promise: Promise) {
        try {
            val keys = RemyNotificationListenerService.getActiveNotificationKeys()
            val array = Arguments.createArray()
            keys.forEach { array.pushString(it) }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("ERR_GET_ACTIVE_NOTIFICATIONS", e.message)
        }
    }

    @ReactMethod
    fun markAsRead(key: String?, promise: Promise) {
        try {
            if (key.isNullOrBlank()) {
                promise.resolve(false)
                return
            }
            val success = RemyNotificationListenerService.markNotificationAsRead(key)
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("ERR_MARK_AS_READ", e.message)
        }
    }

    @ReactMethod
    fun processActiveNotifications(promise: Promise) {
        try {
            if (isNotificationServiceEnabled(reactContext) && RemyNotificationListenerService.instance == null) {
                checkAndRebindIfNeeded(reactContext)
            }
            RemyNotificationListenerService.processActiveNotifications()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_PROCESS_ACTIVE", e.message)
        }
    }

    @ReactMethod
    fun setAutoClearPromos(enabled: Boolean, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(RemyNotificationListenerService.PREF_AUTO_CLEAR_PROMOS, enabled)
                .apply()
            if (enabled) {
                RemyNotificationListenerService.processActiveNotifications()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SET_AUTO_CLEAR_PROMOS", e.message)
        }
    }

    @ReactMethod
    fun getAutoClearPromos(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val enabled = prefs.getBoolean(RemyNotificationListenerService.PREF_AUTO_CLEAR_PROMOS, true)
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERR_GET_AUTO_CLEAR_PROMOS", e.message)
        }
    }

    @ReactMethod
    fun setAutoSnoozeNoise(enabled: Boolean, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(RemyNotificationListenerService.PREF_AUTO_SNOOZE_NOISE, enabled)
                .apply()
            if (enabled) {
                RemyNotificationListenerService.processActiveNotifications()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SET_AUTO_SNOOZE_NOISE", e.message)
        }
    }

    @ReactMethod
    fun getAutoSnoozeNoise(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val enabled = prefs.getBoolean(RemyNotificationListenerService.PREF_AUTO_SNOOZE_NOISE, false)
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERR_GET_AUTO_SNOOZE_NOISE", e.message)
        }
    }

    @ReactMethod
    fun setAutoClearScam(enabled: Boolean, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(RemyNotificationListenerService.PREF_AUTO_CLEAR_SCAM, enabled)
                .apply()
            if (enabled) {
                RemyNotificationListenerService.processActiveNotifications()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SET_AUTO_CLEAR_SCAM", e.message)
        }
    }

    @ReactMethod
    fun getAutoClearScam(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val enabled = prefs.getBoolean(RemyNotificationListenerService.PREF_AUTO_CLEAR_SCAM, true)
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERR_GET_AUTO_CLEAR_SCAM", e.message)
        }
    }

    // Required by React Native NativeEventEmitter
    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount++
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount = (listenerCount - count).coerceAtLeast(0)
    }

    companion object {
        private const val EVENT_NAME = "onNotificationCaptured"

        @Volatile
        var reactContextRef: ReactApplicationContext? = null

        @Volatile
        var listenerCount: Int = 0

        fun emitNotification(item: JSONObject) {
            val context = reactContextRef ?: return
            if (!context.hasActiveReactInstance()) {
                return
            }

            try {
                val map = convertJsonToMap(item)
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(EVENT_NAME, map)
            } catch (e: Exception) {
                Log.e("RemySensory", "Failed to emit notification event to JavaScript", e)
            }
        }

        private fun convertJsonToMap(json: JSONObject): WritableMap {
            val map = Arguments.createMap()
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                when (val value = json.get(key)) {
                    is String -> map.putString(key, value)
                    is Int -> map.putInt(key, value)
                    is Long -> map.putDouble(key, value.toDouble())
                    is Double -> map.putDouble(key, value)
                    is Boolean -> map.putBoolean(key, value)
                    JSONObject.NULL -> map.putNull(key)
                    else -> map.putString(key, value.toString())
                }
            }
            return map
        }

        fun isNotificationServiceEnabled(context: Context): Boolean {
            val pkgName = context.packageName
            val flat = try {
                Settings.Secure.getString(
                    context.contentResolver,
                    "enabled_notification_listeners"
                )
            } catch (e: Exception) {
                null
            } ?: return false

            val names = flat.split(":")
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && cn.packageName == pkgName) {
                    return true
                }
            }
            return false
        }

        fun checkAndRebindIfNeeded(context: Context) {
            if (isNotificationServiceEnabled(context) && RemyNotificationListenerService.instance == null) {
                try {
                    val cn = ComponentName(context, RemyNotificationListenerService::class.java)
                    val pm = context.packageManager
                    pm.setComponentEnabledSetting(
                        cn,
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP
                    )
                    pm.setComponentEnabledSetting(
                        cn,
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP
                    )
                    Log.i("RemySensory", "Toggled NotificationListenerService component state to force rebind.")
                } catch (e: Exception) {
                    Log.w("RemySensory", "Failed to force rebind NotificationListenerService", e)
                }
            }
        }
    }
}
