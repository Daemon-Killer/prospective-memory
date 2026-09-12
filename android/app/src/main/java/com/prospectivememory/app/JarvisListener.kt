package com.prospectivememory.app

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class JarvisListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val seen = LinkedHashMap<String, Long>(64, 0.75f, true)

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        val active = runCatching { activeNotifications }.getOrNull() ?: return
        for (sbn in active) handle(sbn, fromTray = true)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn != null) handle(sbn, fromTray = false)
    }

    private fun handle(sbn: StatusBarNotification, fromTray: Boolean) {
        val label = runCatching {
            val ai = packageManager.getApplicationInfo(sbn.packageName, 0)
            packageManager.getApplicationLabel(ai).toString()
        }.getOrDefault(sbn.packageName)
        val event = Jarvis.parse(sbn, label, packageName) ?: return
        val now = System.currentTimeMillis()
        synchronized(seen) {
            pruneLocked(now)
            val prev = seen[event.id]
            if (prev != null && now - prev < 2_000) return
            seen[event.id] = now
        }
        JarvisStore.remember(this, event)
        if (event.kind == "otp" && !fromTray) {
            JarvisNotifs.showOtp(this, event)
        }
        scope.launch { JarvisInbox.ingest(this@JarvisListener, listOf(event)) }
    }

    private fun pruneLocked(now: Long) {
        if (seen.size < 80) return
        val it = seen.entries.iterator()
        while (it.hasNext() && seen.size > 40) {
            val e = it.next()
            if (now - e.value > 60_000) it.remove() else break
        }
    }

    companion object {
        fun enabled(ctx: Context): Boolean {
            val cn = ComponentName(ctx, JarvisListener::class.java)
            val flat = cn.flattenToString()
            val short = cn.flattenToShortString()
            val raw = Settings.Secure.getString(
                ctx.contentResolver,
                "enabled_notification_listeners",
            ) ?: return false
            return raw.split(':').any { it.equals(flat, true) || it.equals(short, true) }
        }
    }
}
