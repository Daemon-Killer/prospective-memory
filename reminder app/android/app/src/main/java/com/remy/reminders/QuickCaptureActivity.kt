package com.remy.reminders

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import kotlin.concurrent.thread

/**
 * High-speed, zero-friction lockscreen thought capture dialog.
 * Opens above keyguard/lockscreen instantly without waiting for JS bundle loading.
 */
class QuickCaptureActivity : Activity() {

    private var selectedPreset: String = "inbox"
    private lateinit var inputField: EditText
    private lateinit var previewText: TextView
    private val chipButtonMap = mutableMapOf<String, Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val presetExtra = intent?.getStringExtra("preset")
        if (!presetExtra.isNullOrEmpty()) {
            selectedPreset = presetExtra
        }

        configureLockscreenFlags()
        buildSwissCaptureUi()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val presetExtra = intent?.getStringExtra("preset")
        if (!presetExtra.isNullOrEmpty()) {
            selectPreset(presetExtra)
        }
    }

    private fun selectPreset(key: String) {
        selectedPreset = key
        chipButtonMap.forEach { (chipKey, btn) ->
            val isSelected = selectedPreset == chipKey
            btn.background = GradientDrawable().apply {
                setColor(if (isSelected) Color.WHITE else Color.parseColor("#1E1E1E"))
                setStroke(2, if (isSelected) Color.WHITE else Color.parseColor("#444444"))
            }
            btn.setTextColor(if (isSelected) Color.BLACK else Color.LTGRAY)
        }
        updatePreview()
    }

    private fun configureLockscreenFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            km?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE or
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        )
    }

    private fun buildSwissCaptureUi() {
        val rootLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#E6000000"))
            setPadding(24, 24, 24, 24)
            setOnClickListener { finish() }
        }

        val cardLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#000000"))
                setStroke(2, Color.parseColor("#262626"))
                cornerRadius = 0f
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener { /* prevent dismissal */ }
        }

        // Header
        val titleView = TextView(this).apply {
            text = "REMY · QUICK CAPTURE"
            setTextColor(Color.WHITE)
            textSize = 14f
            typeface = android.graphics.Typeface.MONOSPACE
            letterSpacing = 0.15f
        }
        val subtitleView = TextView(this).apply {
            text = "Zero-friction prospective memory. Enter to log."
            setTextColor(Color.parseColor("#888888"))
            textSize = 11f
            setPadding(0, 4, 0, 16)
        }

        // Horizontal Chips
        val chipsScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val chipsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 16)
        }

        val chipList = listOf(
            "inbox" to "INBOX",
            "15m" to "+15M",
            "1h" to "+1H",
            "evening" to "TONIGHT",
            "tomorrow_morning" to "TOMORROW 9AM"
        )
        chipButtonMap.clear()
        chipList.forEach { (key, label) ->
            val btn = Button(this).apply {
                text = label
                textSize = 10f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(20, 8, 20, 8)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { setMargins(0, 0, 12, 0) }

                setOnClickListener {
                    selectPreset(key)
                }
            }
            chipButtonMap[key] = btn
            chipsRow.addView(btn)
        }
        selectPreset(selectedPreset)
        chipsScroll.addView(chipsRow)

        // Input Field
        inputField = EditText(this).apply {
            hint = "DAHI LENA  ·  C MOM  ·  BUY MILK"
            setHintTextColor(Color.parseColor("#555555"))
            setTextColor(Color.WHITE)
            textSize = 14f
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_DONE
            setPadding(20, 20, 20, 20)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#1E1E1E"))
                setStroke(2, Color.parseColor("#555555"))
            }
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) {
                    submitCapture()
                    true
                } else false
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    updatePreview()
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }

        // Preview Text
        previewText = TextView(this).apply {
            text = "INBOX — NO ALARM UNTIL YOU ARM IT"
            setTextColor(Color.parseColor("#777777"))
            textSize = 10f
            typeface = android.graphics.Typeface.MONOSPACE
            setPadding(4, 10, 4, 16)
        }

        // Button Row
        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val buttonSpacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        val cancelBtn = Button(this).apply {
            text = "DISMISS"
            textSize = 11f
            setTextColor(Color.parseColor("#888888"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { finish() }
        }
        val captureBtn = Button(this).apply {
            text = "ADD"
            textSize = 11f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.BLACK)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
            }
            setPadding(28, 12, 28, 12)
            setOnClickListener { submitCapture() }
        }
        // Handwritten stylus ink retired from capture UI in favor of widgets
        buttonRow.addView(buttonSpacer)
        buttonRow.addView(cancelBtn)
        buttonRow.addView(captureBtn)

        cardLayout.addView(titleView)
        cardLayout.addView(subtitleView)
        cardLayout.addView(chipsScroll)
        cardLayout.addView(inputField)
        cardLayout.addView(previewText)
        cardLayout.addView(buttonRow)

        rootLayout.addView(cardLayout)
        setContentView(rootLayout)

        // Show keyboard
        inputField.postDelayed({
            inputField.requestFocus()
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showSoftInput(inputField, InputMethodManager.SHOW_IMPLICIT)
        }, 100)
    }

    private fun updatePreview() {
        val raw = inputField.text.toString().trim()
        if (raw.isEmpty()) {
            previewText.text = if (selectedPreset == "inbox") "INBOX — NO ALARM UNTIL YOU ARM IT" else "TIMED: $selectedPreset"
            previewText.setTextColor(Color.parseColor("#777777"))
            return
        }

        val expanded = expandLingoCustom(raw)
        val now = Date()
        val (_, isArmed) = calculateDueDate(selectedPreset, raw, now)
        val statusLabel = if (isArmed) "TIMED" else "INBOX"
        previewText.text = "→ $expanded · $statusLabel"
        previewText.setTextColor(if (isArmed) Color.parseColor("#3B82F6") else Color.parseColor("#80CBC4"))
    }

    private fun calculateDueDate(preset: String, text: String, now: Date): Pair<String, Boolean> {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = now }
        var isArmed = true

        when (preset) {
            "15m" -> {
                cal.add(Calendar.MINUTE, 15)
            }
            "1h" -> {
                cal.add(Calendar.HOUR_OF_DAY, 1)
            }
            "evening" -> {
                val localCal = Calendar.getInstance().apply { time = now }
                if (localCal.get(Calendar.HOUR_OF_DAY) >= 20) {
                    localCal.add(Calendar.HOUR_OF_DAY, 2)
                } else {
                    localCal.set(Calendar.HOUR_OF_DAY, 20)
                    localCal.set(Calendar.MINUTE, 0)
                    localCal.set(Calendar.SECOND, 0)
                    localCal.set(Calendar.MILLISECOND, 0)
                }
                cal.time = localCal.time
            }
            "tomorrow_morning" -> {
                val localCal = Calendar.getInstance().apply { time = now }
                localCal.add(Calendar.DAY_OF_YEAR, 1)
                localCal.set(Calendar.HOUR_OF_DAY, 9)
                localCal.set(Calendar.MINUTE, 0)
                localCal.set(Calendar.SECOND, 0)
                localCal.set(Calendar.MILLISECOND, 0)
                cal.time = localCal.time
            }
            else -> {
                // Check if text has a natural time cue
                val lower = text.lowercase(Locale.ROOT)
                val localCal = Calendar.getInstance().apply { time = now }
                when {
                    lower.contains("tomorrow morning") || lower.contains("kal subah") -> {
                        localCal.add(Calendar.DAY_OF_YEAR, 1)
                        localCal.set(Calendar.HOUR_OF_DAY, 9)
                        localCal.set(Calendar.MINUTE, 0)
                        localCal.set(Calendar.SECOND, 0)
                        localCal.set(Calendar.MILLISECOND, 0)
                        cal.time = localCal.time
                    }
                    lower.contains("tonight") || lower.contains("this evening") || lower.contains("shaam") -> {
                        if (localCal.get(Calendar.HOUR_OF_DAY) >= 20) {
                            localCal.add(Calendar.HOUR_OF_DAY, 2)
                        } else {
                            localCal.set(Calendar.HOUR_OF_DAY, 20)
                            localCal.set(Calendar.MINUTE, 0)
                            localCal.set(Calendar.SECOND, 0)
                            localCal.set(Calendar.MILLISECOND, 0)
                        }
                        cal.time = localCal.time
                    }
                    lower.contains("tomorrow") || lower.contains("kal") -> {
                        localCal.add(Calendar.DAY_OF_YEAR, 1)
                        localCal.set(Calendar.HOUR_OF_DAY, 9)
                        localCal.set(Calendar.MINUTE, 0)
                        localCal.set(Calendar.SECOND, 0)
                        localCal.set(Calendar.MILLISECOND, 0)
                        cal.time = localCal.time
                    }
                    lower.contains("1h") || lower.contains("1 hour") -> {
                        cal.add(Calendar.HOUR_OF_DAY, 1)
                    }
                    lower.contains("15m") || lower.contains("15 min") -> {
                        cal.add(Calendar.MINUTE, 15)
                    }
                    else -> {
                        isArmed = false
                    }
                }
            }
        }

        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        return isoFormat.format(cal.time) to isArmed
    }

    private fun expandLingoCustom(raw: String): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lingoTable = prefs.getString(PREF_LINGO, null) ?: DEFAULT_LINGO_TABLE
        val text = raw.trim()
        val lower = text.lowercase(Locale.ROOT)

        for (line in lingoTable.split("\n")) {
            val t = line.trim()
            if (t.isEmpty() || t.startsWith("#")) continue
            val eq = t.indexOf('=')
            if (eq <= 0) continue
            val lhs = t.substring(0, eq).trim().lowercase(Locale.ROOT)
            val rhs = t.substring(eq + 1).trim()
            for (alias in lhs.split("|")) {
                val key = alias.trim()
                if (key.isEmpty()) continue
                if (rhs.contains("$")) {
                    if (lower == key || lower.startsWith("$key ")) {
                        val rest = if (text.length > key.length) text.substring(key.length).trim() else ""
                        return rhs.replace("$", rest).trim()
                    }
                } else {
                    if (lower == key) {
                        return rhs
                    }
                }
            }
        }
        return text
    }

    private fun queuePendingCapture(id: String, title: String, dueDateIso: String, nowIso: String, armed: Boolean) {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existingJson = prefs.getString(PREF_PENDING_CAPTURES, "[]") ?: "[]"
            val array = try {
                JSONArray(existingJson)
            } catch (_: Exception) {
                JSONArray()
            }
            val item = JSONObject().apply {
                put("id", id)
                put("title", title)
                put("dueDate", dueDateIso)
                put("status", "pending")
                put("snoozeCount", 0)
                put("createdAt", nowIso)
                put("updatedAt", nowIso)
                put("armed", armed)
            }
            array.put(item)
            prefs.edit().putString(PREF_PENDING_CAPTURES, array.toString()).apply()

            // Also immediately sync to AgendaWidget so lockscreen & homescreen agenda widgets display the new item instantly
            val widgetJson = prefs.getString(AgendaWidget.PREF_WIDGET_REMINDERS, "[]") ?: "[]"
            val widgetArray = try {
                JSONArray(widgetJson)
            } catch (_: Exception) {
                JSONArray()
            }
            widgetArray.put(item)
            prefs.edit().putString(AgendaWidget.PREF_WIDGET_REMINDERS, widgetArray.toString()).apply()
            AgendaWidget.updateAll(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun submitCapture() {
        val raw = inputField.text.toString().trim()
        if (raw.isEmpty()) {
            finish()
            return
        }

        // Check if multi-line
        val lines = raw.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
        val titlesToCapture = if (lines.isNotEmpty()) lines else listOf(raw)

        val now = Date()
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val nowIso = isoFormat.format(now)

        thread {
            for (line in titlesToCapture) {
                val title = expandLingoCustom(line)
                val (dueDateIso, isArmed) = calculateDueDate(selectedPreset, line, now)
                val reminderId = UUID.randomUUID().toString()
                queuePendingCapture(reminderId, title, dueDateIso, nowIso, isArmed)
                postToUnifiedBackend(reminderId, title, dueDateIso, nowIso, isArmed)
            }
        }

        val (_, firstArmed) = calculateDueDate(selectedPreset, titlesToCapture.first(), now)
        val msg = if (titlesToCapture.size > 1) {
            "Captured ${titlesToCapture.size} items"
        } else {
            val firstTitle = expandLingoCustom(titlesToCapture.first())
            "Captured: $firstTitle (${if (firstArmed) "Timed" else "Inbox"})"
        }
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun postToUnifiedBackend(id: String, title: String, dueDateIso: String, nowIso: String, armed: Boolean) {
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val baseApiUrl = prefs.getString(PREF_API_URL, "https://prospective-memory-api.onrender.com")
                ?.trim()?.removeSuffix("/") ?: "https://prospective-memory-api.onrender.com"
            val token = prefs.getString(PREF_TOKEN, "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=")
                ?.trim() ?: "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4="

            val url = URL("$baseApiUrl/v1/reminders")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("X-PMEM-TOKEN", token)
            conn.doOutput = true
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            val json = JSONObject().apply {
                put("id", id)
                put("title", title)
                put("dueDate", dueDateIso)
                put("status", "pending")
                put("snoozeCount", 0)
                put("createdAt", nowIso)
                put("updatedAt", nowIso)
                put("armed", armed)
            }

            OutputStreamWriter(conn.outputStream).use { it.write(json.toString()) }
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            // Already safely queued in SharedPreferences; will reconcile on next app foreground
            e.printStackTrace()
        }
    }

    companion object {
        const val PREFS_NAME = "remy_capture_prefs"
        const val PREF_PENDING_CAPTURES = "remy_pending_captures"
        const val PREF_LINGO = "remy_lingo_table"
        const val PREF_API_URL = "remy_cloud_api_url"
        const val PREF_TOKEN = "remy_cloud_token"
        const val DEFAULT_LINGO_TABLE = "d|dahi=dahi lena\nc|call=call $\nbuy=buy $\npay bill=pay electricity bill"
    }
}
