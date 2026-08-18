package com.prospectivememory.app

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
import androidx.core.app.NotificationCompat
import kotlin.math.abs

class BubbleService : Service() {
    private var wm: WindowManager? = null
    private var bubble: View? = null
    private var params: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, notification())
        attachBubble()
    }

    override fun onDestroy() {
        bubble?.let { wm?.removeView(it) }
        bubble = null
        super.onDestroy()
    }

    private fun attachBubble() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val tv = TextView(this).apply {
            text = "+"
            textSize = 28f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xE61B4D3E.toInt())
            setPadding(36, 20, 36, 20)
            elevation = 12f
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            x = 16
            y = 80
        }
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        tv.setOnTouchListener { _, ev ->
            when (ev.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = ev.rawX
                    downY = ev.rawY
                    startX = lp.x
                    startY = lp.y
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    lp.x = startX - (ev.rawX - downX).toInt()
                    lp.y = startY + (ev.rawY - downY).toInt()
                    wm?.updateViewLayout(tv, lp)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (abs(ev.rawX - downX) < 12 && abs(ev.rawY - downY) < 12) {
                        openCapture()
                    }
                    true
                }
                else -> false
            }
        }
        bubble = tv
        params = lp
        wm?.addView(tv, lp)
    }

    private fun openCapture() {
        val i = Intent(this, GlyphCaptureActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(i)
    }

    private fun notification(): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CH, "Capture bubble", NotificationManager.IMPORTANCE_MIN),
            )
        }
        val open = PendingIntent.getActivity(
            this,
            1,
            Intent(this, GlyphCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Capture bubble on")
            .setContentText("Tap the + tile to log a thought")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CH = "pmem_bubble"
        private const val NOTIF_ID = 42

        fun start(ctx: Context) {
            val i = Intent(ctx, BubbleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, BubbleService::class.java))
        }
    }
}
