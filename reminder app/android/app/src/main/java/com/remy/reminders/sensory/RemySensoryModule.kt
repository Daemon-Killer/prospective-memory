package com.remy.reminders.sensory

import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
                val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(false)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERR_REQUEST_PERMISSION", e.message)
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
            JSONObject(configJson)
            val prefs = reactContext.getSharedPreferences(
                RemyNotificationListenerService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putString(RemyNotificationListenerService.PREF_FILTER_CONFIG, configJson)
                .apply()
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
            val flat = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false

            val names = flat.split(":")
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && cn.packageName == pkgName) {
                    return true
                }
            }
            return false
        }
    }
}
