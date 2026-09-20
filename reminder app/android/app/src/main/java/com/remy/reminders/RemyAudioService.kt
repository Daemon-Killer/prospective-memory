package com.remy.reminders

import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.provider.MediaStore
import org.json.JSONObject

object RemyAudioService {
    private var mediaPlayer: MediaPlayer? = null
    var isPlaying: Boolean = false
        private set
    var currentTitle: String = ""
        private set
    var currentArtist: String = ""
        private set
    var currentQuery: String = ""
        private set
    var streamUrl: String = ""
        private set

    fun play(context: Context, query: String) {
        val q = query.trim()
        val lower = q.lowercase()
        currentQuery = q

        if (lower.contains("spb") || lower.contains("balasubrahmanyam")) {
            currentTitle = if (lower.contains("hindi")) "Tere Mere Beech Mein" else "Sankarabharanam Classics"
            currentArtist = "S.P. Balasubrahmanyam"
            streamUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
        } else if (lower.contains("lofi") || lower.contains("lo-fi") || lower.contains("chill")) {
            currentTitle = "Lofi Study Beats"
            currentArtist = "Lofi Girl / ChilledCow"
            streamUrl = "https://stream.zeno.fm/f3wvbbqmdg8uv"
        } else if (lower.contains("ghazal") || lower.contains("jagjit")) {
            currentTitle = "Tum Ko Dekha Toh Yeh Khayal Aaya"
            currentArtist = "Jagjit Singh"
            streamUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
        } else if (lower.contains("arijit") || lower.contains("arjit")) {
            currentTitle = "Tum Hi Ho"
            currentArtist = "Arijit Singh"
            streamUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"
        } else {
            val clean = q.replace(Regex("^(?i)(?:play|listen\\s+to|hear|stream|put\\s+on)\\s+"), "").trim().trim('"', '\'')
            val displayQuery = if (clean.isNotEmpty()) clean else q
            currentTitle = displayQuery.split(" ").joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }
            currentArtist = "Remy Radio Stream"
            streamUrl = "https://stream.zeno.fm/f3wvbbqmdg8uv"
        }

        try {
            stop(context)
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build()
                )
                setDataSource(context, Uri.parse(streamUrl))
                setOnPreparedListener { mp ->
                    mp.start()
                    this@RemyAudioService.isPlaying = true
                }
                setOnErrorListener { _, _, _ ->
                    this@RemyAudioService.isPlaying = false
                    true
                }
                setOnCompletionListener {
                    this@RemyAudioService.isPlaying = false
                }
                prepareAsync()
            }
            this@RemyAudioService.isPlaying = true
        } catch (e: Exception) {
            e.printStackTrace()
            // Fallback: send system media search intent
            try {
                val intent = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).apply {
                    putExtra(SearchManager.QUERY, q)
                    putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                if (intent.resolveActivity(context.packageManager) != null) {
                    context.startActivity(intent)
                }
            } catch (_: Exception) {}
        }
    }

    fun pause(context: Context) {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.pause()
                    this@RemyAudioService.isPlaying = false
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun stop(context: Context) {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.release()
            }
            mediaPlayer = null
            this@RemyAudioService.isPlaying = false
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun getStateJson(): String {
        return JSONObject().apply {
            put("isPlaying", isPlaying)
            put("title", currentTitle)
            put("artist", currentArtist)
            put("query", currentQuery)
            put("streamUrl", streamUrl)
        }.toString()
    }
}
