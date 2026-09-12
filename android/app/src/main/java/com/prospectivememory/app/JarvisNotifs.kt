package com.prospectivememory.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object JarvisNotifs {
    private const val CH = "pmem_otp"
    private const val ID = 71

    fun showOtp(ctx: Context, e: JarvisEvent) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CH, "JARVIS OTP", NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val code = e.otp
        val line = if (code.isNullOrBlank()) {
            "${e.title}: Android hid the digits"
        } else {
            "${e.otp} · ${e.title}"
        }
        val copy = if (!code.isNullOrBlank()) {
            val i = Intent(ctx, CopyOtpReceiver::class.java).apply {
                action = CopyOtpReceiver.ACTION
                putExtra(CopyOtpReceiver.EXTRA_OTP, code)
            }
            PendingIntent.getBroadcast(
                ctx,
                8,
                i,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        } else {
            null
        }
        val b = NotificationCompat.Builder(ctx, CH)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("OTP")
            .setContentText(line)
            .setStyle(NotificationCompat.BigTextStyle().bigText(line))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
        if (copy != null) {
            b.addAction(0, "Copy", copy)
        }
        runCatching { NotificationManagerCompat.from(ctx).notify(ID, b.build()) }
    }
}
