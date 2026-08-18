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
import android.widget.Toast
import androidx.core.app.NotificationCompat
import kotlin.math.abs

class BubbleService : Service() {
    private var wm: WindowManager? = null
    private var bubble: View? = null
    private var trash: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, notification())
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        attachTrash()
        attachBubble()
    }

    override fun onDestroy() {
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
        wm?.addView(tv, lp)
    }

    private fun attachBubble() {
        val tv = TextView(this).apply {
            text = "+"
            textSize = 28f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xE61B4D3E.toInt())
            setPadding(36, 20, 36, 20)
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
            x = 16
            y = 80
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
                    wm?.updateViewLayout(tv, lp)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    val hide = dragging && overTrash(ev.rawY)
                    hideTrash()
                    when {
                        hide -> {
                            Toast.makeText(
                                this,
                                "Bubble hidden — enable it again in Capture",
                                Toast.LENGTH_SHORT,
                            ).show()
                            stopSelf()
                        }
                        !dragging -> openCapture()
                    }
                    true
                }
                else -> false
            }
        }
        bubble = tv
        wm?.addView(tv, lp)
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
        } catch (_: Exception) {
        }
    }

    private fun openCapture() {
        startActivity(
            Intent(this, QuickCaptureActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            },
        )
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
            Intent(this, QuickCaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Capture bubble on")
            .setContentText("Tap + to log · drag to ✕ to hide")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CH = "pmem_bubble"
        private const val NOTIF_ID = 42
        private const val TRASH_DP = 140f
        private const val TRASH_IDLE = 0xCC5D4037.toInt()
        private const val TRASH_HOT = 0xE6C62828.toInt()

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
