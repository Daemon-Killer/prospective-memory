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

object Inbox {
    private val http = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .writeTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    private const val QUEUE = "queue"

    data class Result(
        val ok: Boolean,
        val message: String,
        val category: String? = null,
        val queued: Boolean = false,
    ) {
        fun toast(): String {
            val cat = category?.takeIf { it.isNotBlank() }
            return when {
                queued && cat != null -> "Queued · $cat · $message"
                queued -> "Queued · $message"
                ok && cat != null -> "$cat · $message"
                else -> message
            }
        }
    }

    suspend fun capture(ctx: Context, raw: String): Result {
        val resolved = Lingo.resolve(raw, Prefs.lingo(ctx))
        Prefs.touchKey(ctx, resolved.key)
        val expanded = resolved.output
        val posted = post(ctx, expanded)
        if (posted.ok) {
            flush(ctx)
            return posted.copy(message = posted.message.ifBlank { expanded })
        }
        enqueue(ctx, expanded)
        return Result(false, expanded, queued = true)
    }

    suspend fun flush(ctx: Context) {
        val items = queue(ctx)
        if (items.isEmpty()) return
        val remain = ArrayList<String>()
        for (item in items) {
            val r = post(ctx, item)
            if (!r.ok) remain.add(item)
        }
        saveQueue(ctx, remain)
    }

    private suspend fun post(ctx: Context, text: String): Result {
        val root = Prefs.url(ctx).trim().trimEnd('/')
        val token = Prefs.token(ctx)
        if (root.isEmpty() || token.isEmpty()) {
            return Result(false, "Set URL + token in settings")
        }
        val body = JSONObject().put("text", text).put("source", "android").toString()
        val req = Request.Builder()
            .url("$root/v1/capture")
            .addHeader("Content-Type", "application/json")
            .addHeader("X-PMEM-TOKEN", token)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        return withContext(Dispatchers.IO) {
            try {
                http.newCall(req).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful) return@use Result(false, "HTTP ${resp.code}")
                    val task = runCatching { JSONObject(body).optJSONObject("task") }.getOrNull()
                    val cat = task?.optString("category").orEmpty().ifBlank { null }
                    val txt = task?.optString("text").orEmpty().ifBlank { text }
                    Result(true, txt, category = cat)
                }
            } catch (e: Exception) {
                Result(false, e.message ?: "network")
            }
        }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pmem", Context.MODE_PRIVATE)

    private fun queue(ctx: Context): MutableList<String> {
        val raw = prefs(ctx).getString(QUEUE, "[]") ?: "[]"
        val arr = JSONArray(raw)
        return MutableList(arr.length()) { arr.getString(it) }
    }

    private fun enqueue(ctx: Context, text: String) {
        val q = queue(ctx)
        q.add(text)
        saveQueue(ctx, q)
    }

    private fun saveQueue(ctx: Context, items: List<String>) {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        prefs(ctx).edit().putString(QUEUE, arr.toString()).apply()
    }
}
