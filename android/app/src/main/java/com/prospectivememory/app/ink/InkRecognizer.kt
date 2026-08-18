package com.prospectivememory.app.ink

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.recognition.Ink
import com.google.mlkit.vision.digitalink.recognition.RecognitionContext
import com.google.mlkit.vision.digitalink.recognition.WritingArea
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * On-device ML Kit Digital Ink. First launch downloads ~20MB for the language.
 * Latin Hinglish is closer to en-US than Devanagari hi-IN.
 */
class InkRecognizer(languageTag: String = "en-US") {
    private val model: DigitalInkRecognitionModel
    private var client: DigitalInkRecognizer? = null

    init {
        val id = try {
            DigitalInkRecognitionModelIdentifier.fromLanguageTag(languageTag)
        } catch (_: Exception) {
            null
        } ?: error("No ink model for $languageTag")
        model = DigitalInkRecognitionModel.builder(id).build()
    }

    suspend fun ensureReady() {
        val mgr = RemoteModelManager.getInstance()
        val have = mgr.isModelDownloaded(model).await()
        if (!have) {
            mgr.download(model, DownloadConditions.Builder().build()).await()
        }
        if (client == null) {
            client = DigitalInkRecognition.getClient(
                DigitalInkRecognizerOptions.builder(model).build(),
            )
        }
    }

    suspend fun recognize(
        strokes: List<List<InkPt>>,
        width: Float,
        height: Float,
        preContext: String = "",
    ): String {
        val rec = client ?: error("call ensureReady() first")
        if (strokes.isEmpty() || strokes.all { it.size < 2 }) return ""
        val builder = Ink.builder()
        for (stroke in strokes) {
            if (stroke.size < 2) continue
            val sb = Ink.Stroke.builder()
            stroke.forEach { p -> sb.addPoint(Ink.Point.create(p.x, p.y, p.t)) }
            builder.addStroke(sb.build())
        }
        val ctx = RecognitionContext.builder()
            .setPreContext(preContext.takeLast(20))
            .setWritingArea(WritingArea(width.coerceAtLeast(1f), height.coerceAtLeast(1f)))
            .build()
        val result = rec.recognize(builder.build(), ctx).await()
        return result.candidates.firstOrNull()?.text.orEmpty().trim()
    }

    fun close() {
        client?.close()
        client = null
    }

    data class InkPt(val x: Float, val y: Float, val t: Long)
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { value -> if (cont.isActive) cont.resume(value) }
    addOnFailureListener { e -> if (cont.isActive) cont.resumeWithException(e) }
}
