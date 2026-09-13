package com.remy.reminders

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import kotlin.math.abs

/**
 * Floating "+" Thought Capture Bubble overlay service.
 * Always-accessible system overlay allowing rapid capture from any app.
 */
class BubbleService : Service() {
    private var wm: WindowManager? = null
    private var bubble: View? = null
    private var trash: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        startForeground(NOTIF_ID, createNotification())
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        attachTrash()
        attachBubble()
    }

    override fun onDestroy() {
        isRunning = false
        detach(bubble)
        detach(trash)
        bubble = null
        trash = null
        super.onDestroy()
    }

    private fun overlayType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
    }

    private fun attachTrash() {
        val h = (TRASH_DP * resources.displayMetrics.density).toInt()
        val tv = TextView(this).apply {
            text = "✕"
            textSize = 28f
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(TRASH_IDLE)
            setPadding(0, 20, 0, 36)
            visibility = View.GONE
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            h,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.BOTTOM }
        trash = tv
        try {
            wm?.addView(tv, lp)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun attachBubble() {
        val tv = TextView(this).apply {
            text = "+"
            textSize = 26f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF000000.toInt())
            setPadding(32, 18, 32, 18)
            elevation = 12f
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            x = 24
            y = 100
        }
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        tv.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX
                    downY = ev.rawY
                    startX = lp.x
                    startY = lp.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = ev.rawX - downX
                    val dy = ev.rawY - downY
                    if (abs(dx) > 12 || abs(dy) > 12) {
                        dragging = true
                        showTrash(overTrash(ev.rawY))
                    }
                    lp.x = startX - dx.toInt()
                    lp.y = startY + dy.toInt()
                    try {
                        wm?.updateViewLayout(tv, lp)
                    } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    val hide = dragging && overTrash(ev.rawY)
                    hideTrash()
                    when {
                        hide -> {
                            Toast.makeText(
                                this,
                                "Remy Bubble hidden",
                                Toast.LENGTH_SHORT,
                            ).show()
                            stopSelf()
                        }
                        !dragging -> openQuickCapture()
                    }
                    true
                }
                else -> false
            }
        }
        bubble = tv
        try {
            wm?.addView(tv, lp)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun overTrash(rawY: Float): Boolean {
        val zone = TRASH_DP * resources.displayMetrics.density
        return rawY >= resources.displayMetrics.heightPixels - zone
    }

    private fun showTrash(hot: Boolean) {
        trash?.visibility = View.VISIBLE
        trash?.setBackgroundColor(if (hot) TRASH_HOT else TRASH_IDLE)
    }

    private fun hideTrash() {
        trash?.visibility = View.GONE
        trash?.setBackgroundColor(TRASH_IDLE)
    }

    private fun detach(v: View?) {
        if (v == null) return
        try {
            wm?.removeView(v)
        } catch (_: Exception) {}
    }

    private fun openQuickCapture() {
        val intent = Intent(this, QuickCaptureActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(intent)
    }

    private fun createNotification(): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Remy Quick Capture Bubble",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Shows floating capture bubble over other apps"
            }
            nm.createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            this,
            201,
            Intent(this, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Remy Bubble Active")
            .setContentText("Tap + to quickly log a thought · Drag to ✕ to dismiss")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "remy_bubble_channel"
        private const val NOTIF_ID = 2026
        private const val TRASH_DP = 140f
        private const val TRASH_IDLE = 0xCC333333.toInt()
        private const val TRASH_HOT = 0xE6D32F2F.toInt()

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(ctx: Context) {
            val intent = Intent(ctx, BubbleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, BubbleService::class.java))
        }
    }
}
