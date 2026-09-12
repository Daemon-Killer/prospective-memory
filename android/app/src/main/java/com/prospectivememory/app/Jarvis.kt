package com.prospectivememory.app

import android.app.Notification
import android.service.notification.StatusBarNotification
import java.security.MessageDigest
import java.time.Instant

data class JarvisEvent(
    val id: String,
    val kind: String,
    val packageName: String,
    val app: String,
    val title: String,
    val text: String,
    val otp: String?,
    val postedAt: String,
)

object Jarvis {
    private val whatsapp = setOf("com.whatsapp", "com.whatsapp.w4b")
    private val mail = setOf(
        "com.google.android.gm",
        "com.google.android.gm.lite",
        "com.microsoft.office.outlook",
        "com.yahoo.mobile.client.android.mail",
        "com.samsung.android.email.provider",
    )
    private val sms = setOf(
        "com.google.android.apps.messaging",
        "com.android.mms",
        "com.android.messaging",
        "com.samsung.android.messaging",
        "com.motorola.messaging",
        "com.oneplus.mms",
        "com.xiaomi.mms",
    )
    private val skipPkg = setOf(
        "android",
        "com.android.systemui",
        "com.android.vending",
        "com.android.settings",
    )
    private val skipTitle = setOf(
        "checking for new messages",
        "whatsapp web is open",
        "backup in progress",
    )

    fun parse(sbn: StatusBarNotification, appLabel: String, selfPkg: String): JarvisEvent? {
        if (sbn.packageName == selfPkg || sbn.packageName in skipPkg) return null
        val n = sbn.notification ?: return null
        if (n.flags and Notification.FLAG_ONGOING_EVENT != 0 &&
            n.category == Notification.CATEGORY_SERVICE
        ) {
            return null
        }
        val title = extra(n, Notification.EXTRA_TITLE)
        val text = body(n)
        if (title.isBlank() && text.isBlank()) return null
        if (title.lowercase() in skipTitle || text.lowercase() in skipTitle) return null

        val blob = "$title\n$text"
        val code = Otp.extract(blob)
        val kind = when {
            code != null -> "otp"
            Otp.looksLike(blob) -> "otp"
            sbn.packageName in whatsapp -> "whatsapp"
            sbn.packageName in mail -> "mail"
            sbn.packageName in sms -> "sms"
            else -> return null
        }
        val postedMs = if (sbn.postTime > 0) sbn.postTime else System.currentTimeMillis()
        val safeTitle = Otp.redact(title, code).ifBlank { appLabel }
        val safeText = Otp.redact(text, code)
        val id = sha24("${sbn.packageName}|${sbn.key}|$safeTitle|$safeText|$postedMs")
        return JarvisEvent(
            id = id,
            kind = kind,
            packageName = sbn.packageName,
            app = appLabel.ifBlank { sbn.packageName },
            title = safeTitle.take(200),
            text = safeText.take(500),
            otp = code,
            postedAt = Instant.ofEpochMilli(postedMs).toString(),
        )
    }

    private fun extra(n: Notification, key: String): String =
        n.extras.getCharSequence(key)?.toString()?.trim().orEmpty()

    private fun body(n: Notification): String {
        val parts = mutableListOf<String>()
        extra(n, Notification.EXTRA_TEXT).takeIf { it.isNotBlank() }?.let { parts.add(it) }
        extra(n, Notification.EXTRA_BIG_TEXT).takeIf { it.isNotBlank() && it !in parts }?.let { parts.add(it) }
        extra(n, Notification.EXTRA_SUB_TEXT).takeIf { it.isNotBlank() }?.let { parts.add(it) }
        n.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.map { it.toString().trim() }
            ?.filter { it.isNotEmpty() && it !in parts }
            ?.let { parts.addAll(it) }
        return parts.joinToString("\n")
    }

    private fun sha24(s: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
        return d.joinToString("") { "%02x".format(it) }.take(24)
    }
}
