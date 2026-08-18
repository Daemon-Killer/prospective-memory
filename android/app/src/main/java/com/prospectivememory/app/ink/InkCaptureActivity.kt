package com.prospectivememory.app.ink

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.prospectivememory.app.Inbox
import com.prospectivememory.app.Lingo
import com.prospectivememory.app.Prefs
import com.prospectivememory.app.QuickCaptureActivity
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Optional test door. Not wired to the bubble or widget. */
class InkCaptureActivity : ComponentActivity() {
    @OptIn(ExperimentalLayoutApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val table = Prefs.lingo(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                val rec = remember { InkRecognizer() }
                val strokes = remember { mutableStateListOf<List<InkRecognizer.InkPt>>() }
                val live = remember { mutableStateListOf<InkRecognizer.InkPt>() }
                var text by remember { mutableStateOf("") }
                var status by remember { mutableStateOf("Loading handwriting model…") }
                var ready by remember { mutableStateOf(false) }
                var canvasW by remember { mutableFloatStateOf(1f) }
                var canvasH by remember { mutableFloatStateOf(1f) }
                val scope = rememberCoroutineScope()
                var debounce by remember { mutableStateOf<Job?>(null) }
                val chips = remember(table) { Lingo.chips(table, Prefs.recentKeys(this), 8) }

                DisposableEffect(Unit) { onDispose { rec.close() } }

                LaunchedEffect(Unit) {
                    try {
                        rec.ensureReady()
                        ready = true
                        status = "Write a word · pause to transcribe"
                    } catch (e: Exception) {
                        status = "Model failed: ${e.message ?: "download"}"
                    }
                }

                fun transcribe() {
                    if (!ready) return
                    val all = strokes.toList()
                    scope.launch {
                        status = "Reading…"
                        try {
                            val hit = rec.recognize(all, canvasW, canvasH, text)
                            if (hit.isNotBlank()) {
                                text = hit
                                status = "Check the line, then Save"
                            } else {
                                status = "No text — write larger or type below"
                            }
                        } catch (e: Exception) {
                            status = e.message ?: "recognize failed"
                        }
                    }
                }

                fun onStrokeEnd() {
                    if (live.size >= 2) strokes.add(live.toList())
                    live.clear()
                    debounce?.cancel()
                    debounce = scope.launch {
                        delay(400)
                        transcribe()
                    }
                }

                fun save() {
                    val raw = text.trim()
                    if (raw.isEmpty()) {
                        finish()
                        return
                    }
                    scope.launch {
                        val r = Inbox.capture(this@InkCaptureActivity, raw)
                        Toast.makeText(this@InkCaptureActivity, r.toast(), Toast.LENGTH_SHORT).show()
                        finish()
                    }
                }

                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(Color(0xF2111111))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("Write or type", color = Color(0xFFB2DFDB), style = MaterialTheme.typography.labelLarge)
                    Text(status, color = Color(0x88FFFFFF), style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        placeholder = { Text("recognized text — edit if wrong") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { save() }),
                    )
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(220.dp)
                            .background(Color(0xFF1A1A1A))
                            .onSizeChanged {
                                canvasW = it.width.toFloat()
                                canvasH = it.height.toFloat()
                            }
                            .pointerInput(ready) {
                                detectDragGestures(
                                    onDragStart = { off ->
                                        live.clear()
                                        live.add(InkRecognizer.InkPt(off.x, off.y, System.currentTimeMillis()))
                                    },
                                    onDrag = { change, _ ->
                                        change.consume()
                                        live.add(
                                            InkRecognizer.InkPt(
                                                change.position.x,
                                                change.position.y,
                                                System.currentTimeMillis(),
                                            ),
                                        )
                                    },
                                    onDragEnd = { onStrokeEnd() },
                                    onDragCancel = { onStrokeEnd() },
                                )
                            },
                    ) {
                        Canvas(Modifier.fillMaxSize()) {
                            fun drawStroke(pts: List<InkRecognizer.InkPt>, color: Color) {
                                if (pts.size < 2) return
                                val path = Path()
                                path.moveTo(pts[0].x, pts[0].y)
                                for (i in 1 until pts.size) path.lineTo(pts[i].x, pts[i].y)
                                drawPath(path, color, style = Stroke(width = 7f, cap = StrokeCap.Round))
                            }
                            strokes.forEach { drawStroke(it, Color(0xFF80CBC4)) }
                            drawStroke(live, Color(0xFFB2DFDB))
                        }
                        if (strokes.isEmpty() && live.isEmpty()) {
                            Text(
                                "write here",
                                color = Color(0x33FFFFFF),
                                modifier = Modifier.align(Alignment.Center),
                                style = MaterialTheme.typography.headlineSmall,
                            )
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        chips.forEach { (key, _) ->
                            AssistChip(
                                onClick = {
                                    text = if (text.isBlank()) key else "$key ${text.trim()}"
                                },
                                label = { Text(key) },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                debounce?.cancel()
                                strokes.clear()
                                live.clear()
                                text = ""
                                status = "Cleared"
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("Clear") }
                        Button(
                            onClick = { save() },
                            modifier = Modifier.weight(1f),
                            enabled = text.isNotBlank(),
                        ) { Text("Save") }
                    }
                    TextButton(
                        onClick = {
                            startActivity(Intent(this@InkCaptureActivity, QuickCaptureActivity::class.java))
                            finish()
                        },
                    ) { Text("Type instead") }
                }
            }
        }
    }
}
