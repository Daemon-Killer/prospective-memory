package com.prospectivememory.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import com.prospectivememory.app.ink.InkEntry
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Keyboard + lingo chips. Enter saves. Tap a chip to fire that shortcut.
 */
class QuickCaptureActivity : ComponentActivity() {
    @OptIn(ExperimentalLayoutApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        val table = Prefs.lingo(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var text by remember {
                    mutableStateOf(intent?.getStringExtra(Intent.EXTRA_TEXT).orEmpty())
                }
                val focus = remember { FocusRequester() }
                val scope = rememberCoroutineScope()
                val preview = remember(text, table) { Lingo.resolve(text, table) }
                val chips = remember(table) { Lingo.chips(table, Prefs.recentKeys(this), 10) }
                val prefix = text.trim().split(Regex("\\s+")).firstOrNull().orEmpty()
                val hints = remember(prefix, table) { Lingo.suggestions(prefix, table, 5) }

                fun save(raw: String) {
                    val t = raw.trim()
                    if (t.isEmpty()) {
                        val last = Prefs.recentKeys(this@QuickCaptureActivity).firstOrNull()
                        val template = last?.let { Lingo.parse(table)[it] }
                        when {
                            last == null -> finish()
                            template != null && template.contains('$') -> text = "$last "
                            else -> save(last)
                        }
                        return
                    }
                    scope.launch {
                        val r = Inbox.capture(this@QuickCaptureActivity, t)
                        Toast.makeText(
                            this@QuickCaptureActivity,
                            r.toast(),
                            Toast.LENGTH_SHORT,
                        ).show()
                        finish()
                    }
                }

                LaunchedEffect(Unit) { focus.requestFocus() }

                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(Color(0xE61B1B1B))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "Thought → Enter   ·   empty Enter = last chip",
                        color = Color(0xFFB2DFDB),
                        style = MaterialTheme.typography.labelLarge,
                    )
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focus),
                        singleLine = true,
                        placeholder = { Text("d  ·  c mom  ·  buy milk") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { save(text) }),
                    )
                    if (preview.changed) {
                        Text("→ ${preview.output}", color = Color(0xFF80CBC4), style = MaterialTheme.typography.bodyMedium)
                    }
                    if (text.isNotBlank() && hints.isNotEmpty() && hints.none { it.first == preview.key }) {
                        Text(
                            hints.joinToString("  ") { "${it.first}→${it.second.take(24)}" },
                            color = Color(0x88FFFFFF),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        chips.forEach { (key, value) ->
                            AssistChip(
                                onClick = {
                                    if (text.isBlank() || text.trim() == key) {
                                        save(key)
                                    } else {
                                        text = "$key ${text.trim()}".trim()
                                    }
                                },
                                label = { Text(key) },
                            )
                        }
                    }
                    Text(
                        "Tap chip = send. $ in lingo = rest of line (c mom → call mom).",
                        color = Color(0x66FFFFFF),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    TextButton(onClick = { InkEntry.open(this@QuickCaptureActivity) }) {
                        Text("Write instead")
                    }
                }
            }
        }
    }
}
