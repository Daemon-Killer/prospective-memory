package com.prospectivememory.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object JarvisStore {
    private const val NAME = "pmem"
    private const val EVENTS = "jarvis_events"
    private const val OTP_CODE = "jarvis_otp_code"
    private const val OTP_FROM = "jarvis_otp_from"
    private const val OTP_AT = "jarvis_otp_at"
    private const val MAX = 40
    private const val OTP_TTL_MS = 180_000L

    private fun p(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun remember(ctx: Context, e: JarvisEvent) {
        val arr = eventsJson(ctx)
        val obj = JSONObject()
            .put("id", e.id)
            .put("kind", e.kind)
            .put("title", e.title)
            .put("text", e.text)
            .put("app", e.app)
            .put("posted_at", e.postedAt)
        val next = JSONArray()
        next.put(obj)
        for (i in 0 until arr.length()) {
            val prev = arr.getJSONObject(i)
            if (prev.optString("id") == e.id) continue
            if (next.length() >= MAX) break
            next.put(prev)
        }
        val ed = p(ctx).edit().putString(EVENTS, next.toString())
        if (e.kind == "otp") {
            ed.putString(OTP_CODE, e.otp.orEmpty())
                .putString(OTP_FROM, e.title)
                .putLong(OTP_AT, System.currentTimeMillis())
        }
        ed.apply()
    }

    fun otpLine(ctx: Context): String {
        val at = p(ctx).getLong(OTP_AT, 0L)
        if (at == 0L || System.currentTimeMillis() - at > OTP_TTL_MS) return ""
        val from = p(ctx).getString(OTP_FROM, "") ?: ""
        val code = p(ctx).getString(OTP_CODE, "") ?: ""
        return if (code.isBlank()) {
            "OTP from $from (Android hid the digits)"
        } else {
            "$code · $from"
        }
    }

    fun liveOtp(ctx: Context): String? {
        val at = p(ctx).getLong(OTP_AT, 0L)
        if (at == 0L || System.currentTimeMillis() - at > OTP_TTL_MS) return null
        return p(ctx).getString(OTP_CODE, "")?.takeIf { it.isNotBlank() }
    }

    private fun eventsJson(ctx: Context): JSONArray {
        val raw = p(ctx).getString(EVENTS, "[]") ?: "[]"
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }
}
