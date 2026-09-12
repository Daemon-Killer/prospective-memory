package com.prospectivememory.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object JarvisInbox {
    private val http = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    private const val QUEUE = "jarvis_queue"

    suspend fun ingest(ctx: Context, events: List<JarvisEvent>) {
        if (events.isEmpty()) return
        val posted = post(ctx, events)
        if (posted) {
            flush(ctx)
            return
        }
        events.forEach { enqueue(ctx, it) }
    }

    suspend fun flush(ctx: Context) {
        val items = queue(ctx)
        if (items.isEmpty()) return
        var i = 0
        while (i < items.size) {
            val end = minOf(i + 20, items.size)
            val batch = items.subList(i, end)
            if (!postJson(ctx, batch)) {
                saveQueue(ctx, items.subList(i, items.size).toList())
                return
            }
            i = end
        }
        saveQueue(ctx, emptyList())
    }

    private suspend fun post(ctx: Context, events: List<JarvisEvent>): Boolean {
        val arr = events.map { toJson(it) }
        return postJson(ctx, arr)
    }

    private suspend fun postJson(ctx: Context, events: List<JSONObject>): Boolean {
        val root = Prefs.url(ctx).trim().trimEnd('/')
        val token = Prefs.token(ctx)
        if (root.isEmpty() || token.isEmpty()) return false
        val body = JSONObject().put("events", JSONArray().also { a -> events.forEach { a.put(it) } })
        val req = Request.Builder()
            .url("$root/v1/jarvis/events")
            .addHeader("Content-Type", "application/json")
            .addHeader("X-PMEM-TOKEN", token)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return withContext(Dispatchers.IO) {
            try {
                http.newCall(req).execute().use { it.isSuccessful }
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun toJson(e: JarvisEvent): JSONObject =
        JSONObject()
            .put("id", e.id)
            .put("kind", e.kind)
            .put("package", e.packageName)
            .put("app", e.app)
            .put("title", e.title)
            .put("text", e.text)
            .put("posted_at", e.postedAt)
            .apply { if (e.otp != null) put("otp", e.otp) }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pmem", Context.MODE_PRIVATE)

    private fun queue(ctx: Context): MutableList<JSONObject> {
        val raw = prefs(ctx).getString(QUEUE, "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        return MutableList(arr.length()) { arr.getJSONObject(it) }
    }

    private fun enqueue(ctx: Context, e: JarvisEvent) {
        val q = queue(ctx)
        q.add(toJson(e))
        while (q.size > 80) q.removeAt(0)
        saveQueue(ctx, q)
    }

    private fun saveQueue(ctx: Context, items: List<JSONObject>) {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        prefs(ctx).edit().putString(QUEUE, arr.toString()).apply()
    }
}
