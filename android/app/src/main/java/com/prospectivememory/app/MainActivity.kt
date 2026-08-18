package com.prospectivememory.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.lifecycleScope
import com.prospectivememory.app.ink.InkEntry
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val notifPerm = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* bubble still works if denied; FGS may be quieter */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        maybeHandleShare(intent)
        pinDynamicShortcut()
        lifecycleScope.launch { Inbox.flush(this@MainActivity) }

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(Modifier.fillMaxSize()) {
                    var url by remember { mutableStateOf(Prefs.url(this)) }
                    var token by remember { mutableStateOf(Prefs.token(this)) }
                    var lingo by remember { mutableStateOf(Prefs.lingo(this)) }

                    Column(
                        Modifier
                            .verticalScroll(rememberScrollState())
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("Fast capture setup", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            if (Prefs.hosted()) {
                                "Inbox is already wired to the hosted server. Daily use is the floating +, widget, or Capture shortcut — not this screen."
                            } else {
                                "Daily use is the floating +, home widget, or the “Capture” shortcut — not this screen."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Button(
                            onClick = { startActivity(Intent(this@MainActivity, QuickCaptureActivity::class.java)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Type a thought") }
                        Button(
                            onClick = { enableBubble() },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Enable floating + tile") }
                        OutlinedButton(
                            onClick = { BubbleService.stop(this@MainActivity) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Stop floating tile") }
                        Text(
                            "Drag the + onto the ✕ at the bottom to hide the bubble. Turn it back on with Enable anytime.\n\n" +
                                "Home screen: long-press empty space → Widgets → Capture. Stretch it wide for a type-here bar.\n" +
                                "Or long-press the app icon → Capture.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedButton(
                            onClick = { InkEntry.open(this@MainActivity) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Write (handwriting test)") }
                        OutlinedButton(
                            onClick = { startActivity(Intent(this@MainActivity, GlyphCaptureActivity::class.java)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Glyph capture (optional)") }
                        OutlinedButton(
                            onClick = { startActivity(Intent(this@MainActivity, GlyphOnboardActivity::class.java)) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Retrain glyphs") }
                        OutlinedTextField(
                            value = url,
                            onValueChange = { url = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Server URL (optional — hosted is baked in)") },
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = token,
                            onValueChange = { token = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Token (optional — baked if empty)") },
                            singleLine = true,
                        )
                        Text(
                            "Lingo: one per line.  d=dahi lena   c|call=call \$   pay bill=pay electricity bill",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedTextField(
                            value = lingo,
                            onValueChange = { lingo = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Lingo") },
                            minLines = 8,
                        )
                        Button(
                            onClick = {
                                Prefs.save(this@MainActivity, url, token, lingo)
                                Toast.makeText(this@MainActivity, "Saved settings", Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Save settings") }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        maybeHandleShare(intent)
    }

    private fun maybeHandleShare(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val shared = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
            startActivity(
                Intent(this, QuickCaptureActivity::class.java).putExtra(Intent.EXTRA_TEXT, shared),
            )
        }
    }

    private fun enableBubble() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                ),
            )
            Toast.makeText(this, "Allow overlay, then tap Enable again", Toast.LENGTH_LONG).show()
            return
        }
        BubbleService.start(this)
        Toast.makeText(this, "Floating + is on — tap to log, drag to ✕ to hide", Toast.LENGTH_SHORT).show()
    }

    private fun pinDynamicShortcut() {
        val intent = Intent(this, QuickCaptureActivity::class.java).apply {
            action = Intent.ACTION_VIEW
        }
        val shortcut = ShortcutInfoCompat.Builder(this, "quick_capture")
            .setShortLabel("Capture")
            .setLongLabel("Log a thought")
            .setIcon(IconCompat.createWithResource(this, R.drawable.ic_launcher))
            .setIntent(intent)
            .build()
        ShortcutManagerCompat.pushDynamicShortcut(this, shortcut)
    }
}
