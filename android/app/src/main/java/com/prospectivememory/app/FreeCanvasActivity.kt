package com.prospectivememory.app

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Tier 2 — no recognition. Sketch + optional title. */
class FreeCanvasActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                val stroke = remember { mutableStateListOf<Unistroke.Pt>() }
                var title by remember { mutableStateOf("") }
                val scope = rememberCoroutineScope()
                Column(
                    Modifier
                        .fillMaxSize()
                        .background(Color(0xFF101010))
                        .padding(12.dp),
                ) {
                    Text("Expand later — sketch freely", color = Color(0xFFB2DFDB))
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("optional title") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { }),
                    )
                    Canvas(
                        Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(vertical = 8.dp)
                            .background(Color(0xFF1A1A1A))
                            .pointerInput(Unit) {
                                detectDragGestures(
                                    onDragStart = { stroke.add(Unistroke.Pt(it.x, it.y)) },
                                    onDrag = { change, _ ->
                                        change.consume()
                                        stroke.add(Unistroke.Pt(change.position.x, change.position.y))
                                    },
                                    onDragEnd = { stroke.add(Unistroke.Pt(Float.NaN, Float.NaN)) },
                                )
                            },
                    ) {
                        var path = Path()
                        var started = false
                        for (p in stroke) {
                            if (p.x.isNaN()) {
                                started = false
                                continue
                            }
                            if (!started) {
                                path.moveTo(p.x, p.y)
                                started = true
                            } else {
                                path.lineTo(p.x, p.y)
                            }
                        }
                        drawPath(path, Color(0xFFFFF59D), style = Stroke(6f, cap = StrokeCap.Round))
                    }
                    Button(
                        onClick = {
                            val label = title.ifBlank { "sketch" }
                            scope.launch {
                                Inbox.capture(this@FreeCanvasActivity, "[expand] $label")
                                Toast.makeText(this@FreeCanvasActivity, "Saved expand-later", Toast.LENGTH_SHORT).show()
                                finish()
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Save sketch note") }
                }
            }
        }
    }
}
