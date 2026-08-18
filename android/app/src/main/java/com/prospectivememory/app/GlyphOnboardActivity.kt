package com.prospectivememory.app

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp

class GlyphOnboardActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val defs = GlyphStore.load(this).toMutableList()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var gi by remember { mutableIntStateOf(0) }
                var si by remember { mutableIntStateOf(0) }
                val stroke = remember { mutableStateListOf<Unistroke.Pt>() }
                var ready by remember { mutableStateOf(false) }
                val g = defs.getOrNull(gi)

                Column(
                    Modifier
                        .fillMaxSize()
                        .background(Color(0xFF111111))
                        .padding(16.dp),
                ) {
                    Text("Train your glyphs", style = MaterialTheme.typography.headlineSmall, color = Color.White)
                    if (g == null) {
                        Text("Done.", color = Color.White)
                        return@Column
                    }
                    Text("${g.label}  (${g.hint})", color = Color(0xFF80CBC4), style = MaterialTheme.typography.titleMedium)
                    Text("Sample ${si + 1} / 3 — draw the same mark each time", color = Color(0x88FFFFFF))
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(320.dp)
                            .padding(top = 12.dp)
                            .background(Color(0xFF1C1C1C))
                            .pointerInput(gi, si) {
                                detectDragGestures(
                                    onDragStart = {
                                        stroke.clear()
                                        ready = false
                                        stroke.add(Unistroke.Pt(it.x, it.y))
                                    },
                                    onDrag = { change, _ ->
                                        change.consume()
                                        stroke.add(Unistroke.Pt(change.position.x, change.position.y))
                                    },
                                    onDragEnd = { ready = stroke.size >= 2 },
                                )
                            },
                    ) {
                        Canvas(Modifier.fillMaxSize()) {
                            if (stroke.size < 2) return@Canvas
                            val path = Path()
                            path.moveTo(stroke[0].x, stroke[0].y)
                            for (i in 1 until stroke.size) path.lineTo(stroke[i].x, stroke[i].y)
                            drawPath(path, Color(0xFFFFCC80), style = Stroke(8f, cap = StrokeCap.Round))
                        }
                    }
                    Button(
                        onClick = {
                            val pts = stroke.toList()
                            if (pts.size < 2) return@Button
                            val others = GlyphStore.templatesMap(this@GlyphOnboardActivity)
                            val clash = GlyphStore.conflictScore(pts, others, g.id)
                            if (clash != null && clash.second >= 0.88f) {
                                Toast.makeText(
                                    this@GlyphOnboardActivity,
                                    "Too similar to ${clash.first} (${(clash.second * 100).toInt()}%). Draw a more distinct mark.",
                                    Toast.LENGTH_LONG,
                                ).show()
                                return@Button
                            }
                            GlyphStore.addSample(this@GlyphOnboardActivity, g.id, pts)
                            stroke.clear()
                            ready = false
                            if (si < 2) {
                                si += 1
                            } else {
                                si = 0
                                if (gi < defs.lastIndex) {
                                    gi += 1
                                } else {
                                    GlyphStore.setOnboarded(this@GlyphOnboardActivity, true)
                                    Toast.makeText(this@GlyphOnboardActivity, "Glyphs ready", Toast.LENGTH_SHORT).show()
                                    finish()
                                }
                            }
                        },
                        enabled = ready,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp),
                    ) { Text("Keep this sample") }
                }
            }
        }
    }
}
