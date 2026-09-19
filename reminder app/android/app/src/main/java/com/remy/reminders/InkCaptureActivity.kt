package com.remy.reminders

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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
 * High-speed lockscreen visual ink / stylus capture dialog.
 * @deprecated Handwritten ink feature has been retired from primary capture in favor of home/lockscreen widgets.
 */
@Deprecated("Handwritten ink feature has been retired from primary capture in favor of home/lockscreen widgets.")
class InkCaptureActivity : Activity() {

    private var selectedPreset: String = "inbox"
    private lateinit var canvasView: DrawingCanvasView
    private lateinit var titleInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureLockscreenFlags()
        buildSwissInkUi()
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
    }

    private fun buildSwissInkUi() {
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
            setOnClickListener { /* prevent dismiss */ }
        }

        // Header
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 12)
        }
        val headerTitle = TextView(this).apply {
            text = "REMY · INK CAPTURE"
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = android.graphics.Typeface.MONOSPACE
            letterSpacing = 0.15f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val typeInsteadBtn = Button(this).apply {
            text = "TYPE INSTEAD"
            textSize = 9f
            setTextColor(Color.parseColor("#888888"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                startActivity(Intent(this@InkCaptureActivity, QuickCaptureActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                })
                finish()
            }
        }
        headerRow.addView(headerTitle)
        headerRow.addView(typeInsteadBtn)

        // Title Input
        titleInput = EditText(this).apply {
            hint = "NOTE TITLE / DIAGRAM (OPTIONAL)"
            setHintTextColor(Color.parseColor("#555555"))
            setTextColor(Color.WHITE)
            textSize = 12f
            isSingleLine = true
            setPadding(16, 14, 16, 14)
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#0D0D0D"))
                setStroke(1, Color.parseColor("#262626"))
            }
        }

        // Preset Chips
        val chipsScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            setPadding(0, 10, 0, 10)
        }
        val chipsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val presets = listOf(
            "inbox" to "INBOX",
            "15m" to "+15M",
            "1h" to "+1H",
            "evening" to "TONIGHT",
            "tomorrow_morning" to "TOMORROW 9AM"
        )
        val presetButtons = mutableListOf<Button>()
        presets.forEach { (key, label) ->
            val btn = Button(this).apply {
                text = label
                textSize = 9f
                setPadding(16, 6, 16, 6)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { setMargins(0, 0, 8, 0) }

                fun updateStyle() {
                    val isSelected = selectedPreset == key
                    background = GradientDrawable().apply {
                        setColor(if (isSelected) Color.WHITE else Color.parseColor("#0D0D0D"))
                        setStroke(1, if (isSelected) Color.WHITE else Color.parseColor("#333333"))
                    }
                    setTextColor(if (isSelected) Color.BLACK else Color.parseColor("#888888"))
                }
                setOnClickListener {
                    selectedPreset = key
                    presetButtons.forEach { it.invalidate() }
                }
                updateStyle()
            }
            presetButtons.add(btn)
            chipsRow.addView(btn)
        }
        chipsScroll.addView(chipsRow)

        // Canvas View
        canvasView = DrawingCanvasView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                600
            ).apply {
                setMargins(0, 4, 0, 10)
            }
        }

        // Toolbar: Colors, Undo, Clear
        val toolbarRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 4, 0, 12)
        }
        val colors = listOf(
            Color.WHITE to "White",
            Color.parseColor("#80CBC4") to "Cyan",
            Color.parseColor("#F59E0B") to "Amber"
        )
        colors.forEach { (colorVal, _) ->
            val colorBtn = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(48, 48).apply {
                    setMargins(0, 0, 12, 0)
                }
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(colorVal)
                    setStroke(2, Color.parseColor("#333333"))
                }
                setOnClickListener {
                    canvasView.strokeColor = colorVal
                }
            }
            toolbarRow.addView(colorBtn)
        }

        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
        }
        toolbarRow.addView(spacer)

        val undoBtn = Button(this).apply {
            text = "UNDO"
            textSize = 9f
            setTextColor(Color.LTGRAY)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { canvasView.undo() }
        }
        val clearBtn = Button(this).apply {
            text = "CLEAR"
            textSize = 9f
            setTextColor(Color.LTGRAY)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { canvasView.clear() }
        }
        toolbarRow.addView(undoBtn)
        toolbarRow.addView(clearBtn)

        // Bottom Action Footer
        val footerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }
        val dismissBtn = Button(this).apply {
            text = "DISMISS"
            textSize = 10f
            setTextColor(Color.parseColor("#888888"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { finish() }
        }
        val saveBtn = Button(this).apply {
            text = "SAVE INK NOTE"
            textSize = 10f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(Color.BLACK)
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
            }
            setPadding(24, 10, 24, 10)
            setOnClickListener { submitInkCapture() }
        }
        footerRow.addView(dismissBtn)
        footerRow.addView(saveBtn)

        cardLayout.addView(headerRow)
        cardLayout.addView(titleInput)
        cardLayout.addView(chipsScroll)
        cardLayout.addView(canvasView)
        cardLayout.addView(toolbarRow)
        cardLayout.addView(footerRow)

        rootLayout.addView(cardLayout)
        setContentView(rootLayout)
    }

    private fun submitInkCapture() {
        if (!canvasView.hasStrokes()) {
            finish()
            return
        }

        val inkJson = canvasView.getStrokesJson()
        val rawTitle = titleInput.text.toString().trim()
        val computedTitle = if (rawTitle.isNotEmpty()) {
            rawTitle
        } else {
            val timeFmt = SimpleDateFormat("HH:mm", Locale.US).format(Date())
            "Sketch Note · $timeFmt"
        }

        val now = Date()
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val nowIso = isoFormat.format(now)

        val (dueDateIso, isArmed) = calculateDueDate(selectedPreset, now)
        val reminderId = UUID.randomUUID().toString()

        thread {
            queuePendingInkCapture(reminderId, computedTitle, dueDateIso, nowIso, isArmed, inkJson)
            postInkToBackend(reminderId, computedTitle, dueDateIso, nowIso, isArmed, inkJson)
        }

        Toast.makeText(this, "Captured ink note: $computedTitle", Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun calculateDueDate(preset: String, now: Date): Pair<String, Boolean> {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = now }
        var isArmed = true

        when (preset) {
            "15m" -> cal.add(Calendar.MINUTE, 15)
            "1h" -> cal.add(Calendar.HOUR_OF_DAY, 1)
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
            else -> isArmed = false
        }

        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        return isoFormat.format(cal.time) to isArmed
    }

    private fun queuePendingInkCapture(
        id: String,
        title: String,
        dueDateIso: String,
        nowIso: String,
        armed: Boolean,
        inkData: String
    ) {
        try {
            val prefs = getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val existingJson = prefs.getString(QuickCaptureActivity.PREF_PENDING_CAPTURES, "[]") ?: "[]"
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
                put("inkData", inkData)
            }
            array.put(item)
            prefs.edit().putString(QuickCaptureActivity.PREF_PENDING_CAPTURES, array.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun postInkToBackend(
        id: String,
        title: String,
        dueDateIso: String,
        nowIso: String,
        armed: Boolean,
        inkData: String
    ) {
        try {
            val prefs = getSharedPreferences(QuickCaptureActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val baseApiUrl = prefs.getString(QuickCaptureActivity.PREF_API_URL, "https://prospective-memory-api.onrender.com")
                ?.trim()?.removeSuffix("/") ?: "https://prospective-memory-api.onrender.com"
            val token = prefs.getString(QuickCaptureActivity.PREF_TOKEN, "d/RSkr00A0GEg2uO3kOLkho3GQXut5Dc/hSvnwobfk4=")
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
                put("inkData", inkData)
            }

            OutputStreamWriter(conn.outputStream).use { it.write(json.toString()) }
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
