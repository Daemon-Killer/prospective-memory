package com.prospectivememory.app

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

class GlyphCaptureActivity : ComponentActivity() {
    @OptIn(ExperimentalLayoutApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!GlyphStore.onboarded(this)) {
            startActivity(Intent(this, GlyphOnboardActivity::class.java))
            finish()
            return
        }

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                val stroke = remember { mutableStateListOf<Unistroke.Pt>() }
                var phase by remember { mutableStateOf("draw") } // draw | pick | text
                var picked by remember { mutableStateOf<GlyphDef?>(null) }
                var candidates by remember { mutableStateOf<List<GlyphDef>>(emptyList()) }
                var note by remember { mutableStateOf("") }
                val defs = remember { GlyphStore.load(this) }
                val tpls = remember { GlyphStore.templatesMap(this) }
                val focus = remember { FocusRequester() }
                val scope = rememberCoroutineScope()

                fun submit(content: String) {
                    val g = picked ?: return
                    val body = when {
                        content.isBlank() && g.id == "urgent" -> "urgent (flag)"
                        content.isBlank() -> g.label
                        else -> "[${g.label}] ${Lingo.expand(content, Prefs.lingo(this))}"
                    }
                    scope.launch {
                        val r = Inbox.capture(this@GlyphCaptureActivity, body)
                        Toast.makeText(
                            this@GlyphCaptureActivity,
                            if (r.ok) "Saved: ${r.message}" else r.message,
                            Toast.LENGTH_SHORT,
                        ).show()
                        finish()
                    }
                }

                fun onStrokeDone() {
                    if (stroke.size < 2) return
                    val len = Unistroke.pathLength(stroke)
                    val turns = directionChanges(stroke)
                    if (turns >= 10) {
                        stroke.clear()
                        Toast.makeText(this, "Cancelled", Toast.LENGTH_SHORT).show()
                        finish()
                        return
                    }
                    val match = if (len < 28f) {
                        Unistroke.Match("task", 0.95f, emptyList())
                    } else {
                        Unistroke.recognize(stroke.toList(), tpls)
                    }
                    val byId = defs.associateBy { it.id }
                    if (match == null) {
                        phase = "pick"
                        candidates = defs
                        return
                    }
                    if (match.score >= GlyphStore.HIGH) {
                        val g = byId[match.id]
                        if (g?.id == "expand") {
                            startActivity(Intent(this, FreeCanvasActivity::class.java))
                            finish()
                            return
                        }
                        picked = g
                        phase = "text"
                    } else if (match.score >= GlyphStore.LOW) {
                        val ids = listOf(match.id) + match.runnersUp.map { it.first }
                        candidates = ids.mapNotNull { byId[it] }.distinctBy { it.id }.take(3)
                        phase = "pick"
                    } else {
                        candidates = defs
                        phase = "pick"
                    }
                }

                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(Color(0xF2111111))
                        .padding(12.dp),
                ) {
                    when (phase) {
                        "draw" -> {
                            Text("One stroke", color = Color(0xFFB2DFDB), style = MaterialTheme.typography.labelLarge)
                            Text("• tap  ○ circle  — dash  ↗ expand  S money  | urgent   (scribble = cancel)", color = Color(0x88FFFFFF), style = MaterialTheme.typography.bodySmall)
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(280.dp)
                                    .background(Color(0xFF1A1A1A))
                                    .pointerInput(Unit) {
                                        detectDragGestures(
                                            onDragStart = { off ->
                                                stroke.clear()
                                                stroke.add(Unistroke.Pt(off.x, off.y))
                                            },
                                            onDrag = { change, _ ->
                                                change.consume()
                                                stroke.add(Unistroke.Pt(change.position.x, change.position.y))
                                            },
                                            onDragEnd = { onStrokeDone() },
                                        )
                                    },
                            ) {
                                Canvas(Modifier.fillMaxSize()) {
                                    if (stroke.size < 2) return@Canvas
                                    val path = Path()
                                    path.moveTo(stroke[0].x, stroke[0].y)
                                    for (i in 1 until stroke.size) path.lineTo(stroke[i].x, stroke[i].y)
                                    drawPath(path, Color(0xFF80CBC4), style = Stroke(width = 8f, cap = StrokeCap.Round))
                                }
                                if (stroke.isEmpty()) {
                                    Text(
                                        "draw",
                                        color = Color(0x33FFFFFF),
                                        modifier = Modifier.align(Alignment.Center),
                                        style = MaterialTheme.typography.headlineMedium,
                                    )
                                }
                            }
                            TextButton(onClick = {
                                startActivity(Intent(this@GlyphCaptureActivity, QuickCaptureActivity::class.java))
                                finish()
                            }) { Text("Type instead") }
                        }
                        "pick" -> {
                            Text("Which glyph?", color = Color(0xFFB2DFDB))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                candidates.forEach { g ->
                                    AssistChip(
                                        onClick = {
                                            if (g.id == "expand") {
                                                startActivity(Intent(this@GlyphCaptureActivity, FreeCanvasActivity::class.java))
                                                finish()
                                            } else {
                                                picked = g
                                                phase = "text"
                                            }
                                        },
                                        label = { Text("${g.label}  ${g.hint.take(12)}") },
                                    )
                                }
                            }
                            TextButton(onClick = {
                                startActivity(Intent(this@GlyphCaptureActivity, QuickCaptureActivity::class.java))
                                finish()
                            }) { Text("Type instead") }
                        }
                        "text" -> {
                            val g = picked
                            Text(g?.label ?: "", color = Color(0xFFB2DFDB), style = MaterialTheme.typography.titleMedium)
                            OutlinedTextField(
                                value = note,
                                onValueChange = { note = it },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .focusRequester(focus),
                                singleLine = true,
                                placeholder = { Text("buy dahi  ·  or Enter to save category only") },
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { submit(note) }),
                            )
                            LaunchedEffect(Unit) { focus.requestFocus() }
                            TextButton(onClick = { submit("") }) { Text("Save category only") }
                        }
                    }
                }
            }
        }
    }

    private fun directionChanges(pts: List<Unistroke.Pt>): Int {
        if (pts.size < 4) return 0
        var last = 0
        var changes = 0
        for (i in 1 until pts.size) {
            val dx = pts[i].x - pts[i - 1].x
            val dy = pts[i].y - pts[i - 1].y
            val dir = when {
                kotlin.math.abs(dx) > kotlin.math.abs(dy) && dx >= 0 -> 1
                kotlin.math.abs(dx) > kotlin.math.abs(dy) -> 2
                dy >= 0 -> 3
                else -> 4
            }
            if (last != 0 && dir != last) changes++
            last = dir
        }
        return changes
    }
}
