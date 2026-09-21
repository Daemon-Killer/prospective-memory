package com.remy.reminders

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RemyCaptureModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "RemyCaptureModule"

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                promise.resolve(Settings.canDrawOverlays(reactContext))
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERR_OVERLAY_CHECK", e.message)
        }
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(reactContext)) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${reactContext.packageName}")
                    ).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(intent)
                    promise.resolve(false)
                    return
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_OVERLAY_REQ", e.message)
        }
    }

    @ReactMethod
    fun startBubble(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                promise.reject("ERR_PERMISSION_DENIED", "SYSTEM_ALERT_WINDOW permission not granted")
                return
            }
            BubbleService.start(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_START_BUBBLE", e.message)
        }
    }

    @ReactMethod
    fun stopBubble(promise: Promise) {
        try {
            BubbleService.stop(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_BUBBLE", e.message)
        }
    }

    @ReactMethod
    fun isBubbleRunning(promise: Promise) {
        try {
            promise.resolve(BubbleService.isRunning)
        } catch (e: Exception) {
            promise.reject("ERR_CHECK_BUBBLE", e.message)
        }
    }

    @ReactMethod
    fun getSharedText(promise: Promise) {
        try {
            promise.resolve(sharedText)
        } catch (e: Exception) {
            promise.reject("ERR_GET_SHARED", e.message)
        }
    }

    @ReactMethod
    fun clearSharedText(promise: Promise) {
        try {
            sharedText = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_CLEAR_SHARED", e.message)
        }
    }

    @ReactMethod
    fun getPendingCaptures(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString(QuickCaptureActivity.PREF_PENDING_CAPTURES, "[]") ?: "[]"
            promise.resolve(json)
        } catch (e: Exception) {
            promise.reject("ERR_GET_PENDING", e.message)
        }
    }

    @ReactMethod
    fun clearPendingCaptures(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().remove(QuickCaptureActivity.PREF_PENDING_CAPTURES).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_CLEAR_PENDING", e.message)
        }
    }

    @ReactMethod
    fun syncCloudConfig(apiUrl: String, token: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(QuickCaptureActivity.PREF_API_URL, apiUrl)
                .putString(QuickCaptureActivity.PREF_TOKEN, token)
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SYNC_CONFIG", e.message)
        }
    }

    @ReactMethod
    fun setLingoTable(lingo: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(QuickCaptureActivity.PREF_LINGO, lingo).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SET_LINGO", e.message)
        }
    }

    @ReactMethod
    fun getLingoTable(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val lingo = prefs.getString(QuickCaptureActivity.PREF_LINGO, QuickCaptureActivity.DEFAULT_LINGO_TABLE)
            promise.resolve(lingo)
        } catch (e: Exception) {
            promise.reject("ERR_GET_LINGO", e.message)
        }
    }

    @ReactMethod
    fun updateWidgetData(remindersJson: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(AgendaWidget.PREF_WIDGET_REMINDERS, remindersJson).apply()
            AgendaWidget.updateAll(reactContext)
            TimelineWidget.updateAll(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_UPDATE_WIDGET", e.message)
        }
    }

    @ReactMethod
    fun getWidgetData(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val json = prefs.getString(AgendaWidget.PREF_WIDGET_REMINDERS, "[]") ?: "[]"
            promise.resolve(json)
        } catch (e: Exception) {
            promise.reject("ERR_GET_WIDGET_DATA", e.message)
        }
    }

    @ReactMethod
    fun playMusic(query: String, promise: Promise) {
        try {
            RemyAudioService.play(reactContext, query)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_PLAY_MUSIC", e.message)
        }
    }

    @ReactMethod
    fun pauseMusic(promise: Promise) {
        try {
            RemyAudioService.pause(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_PAUSE_MUSIC", e.message)
        }
    }

    @ReactMethod
    fun stopMusic(promise: Promise) {
        try {
            RemyAudioService.stop(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_MUSIC", e.message)
        }
    }

    @ReactMethod
    fun getPlaybackState(promise: Promise) {
        try {
            promise.resolve(RemyAudioService.getStateJson())
        } catch (e: Exception) {
            promise.reject("ERR_GET_PLAYBACK_STATE", e.message)
        }
    }

    companion object {
        @Volatile
        var sharedText: String? = null
    }
}
