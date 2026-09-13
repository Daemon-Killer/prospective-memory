package com.remy.wear

import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.speech.RecognizerIntent
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.annotation.VisibleForTesting
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.tiles.TileService
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.domain.SnoozeEngine
import com.remy.wear.surfaces.complication.RemyComplicationUpdater
import com.remy.wear.surfaces.tile.RemyTileService
import com.remy.wear.surfaces.tile.TileLayoutBuilder
import com.remy.wear.sync.RemySyncManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.UUID

/**
 * Swiss Void Wear OS Launcher Activity.
 *
 * Serves as the standalone entry point for the Remy Reminders companion app:
 * 1. Pure #000000 AMOLED canvas with sub-1% ambient power consumption.
 * 2. High-contrast Swiss editorial typography with #FF4500 International Orange urgency cues.
 * 3. Reactive lifecycle-aware observation of Room ReminderDao.observeActiveReminders().
 * 4. 1-tap quick triage actions: Snooze (+15m via SnoozeEngine) and Complete.
 * 5. Push-driven surface invalidation: RemyComplicationUpdater and RemyTileService.
 * 6. Target for Complication and ProtoLayout tile launch actions.
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MainActivity"
        const val EXTRA_START_VOICE_CAPTURE = "extra_start_voice_capture"
        const val ACTION_VOICE_CAPTURE = "com.remy.wear.ACTION_VOICE_CAPTURE"
        const val REQUEST_CODE_SPEECH = 1001

        /**
         * Global test DAO override used by Robolectric and unit tests.
         */
        @VisibleForTesting
        var testDaoOverride: ReminderDao? = null

        /**
         * Clock provider for deterministic temporal testing.
         */
        @VisibleForTesting
        var clockOverride: (() -> Long)? = null

        /**
         * Surface notification listener for verification in tests.
         */
        @VisibleForTesting
        var surfaceNotificationListener: (() -> Unit)? = null
    }

    @VisibleForTesting
    var testDao: ReminderDao? = null

    internal val reminderDao: ReminderDao
        get() = testDao ?: testDaoOverride ?: RemyDatabase.getDatabase(applicationContext).reminderDao()

    internal val nowMillis: Long
        get() = clockOverride?.invoke() ?: System.currentTimeMillis()

    private lateinit var rootLayout: View
    private lateinit var emptyStateView: View
    private lateinit var emptyIcon: TextView
    private lateinit var emptyText: TextView
    private lateinit var remindersScrollView: ScrollView
    private lateinit var remindersContainer: LinearLayout
    private lateinit var headerTitle: TextView
    private var btnHeaderVoice: Button? = null
    private var btnEmptyVoice: Button? = null

    fun startVoiceCapture() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_capture_prompt))
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQUEST_CODE_SPEECH)
        } catch (e: Exception) {
            Log.e(TAG, "Speech recognition unavailable", e)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_SPEECH && resultCode == RESULT_OK) {
            val spokenText = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
            if (!spokenText.isNullOrBlank()) {
                handleVoiceCapture(spokenText)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Ensure true AMOLED #000000 window background
        window.decorView.setBackgroundColor(ContextCompat.getColor(this, R.color.black))

        bindViews()
        observeReminders()

        if (intent?.getBooleanExtra(EXTRA_START_VOICE_CAPTURE, false) == true ||
            intent?.action == ACTION_VOICE_CAPTURE) {
            startVoiceCapture()
        }
    }

    private fun bindViews() {
        rootLayout = findViewById(R.id.root_layout)
        emptyStateView = findViewById(R.id.empty_state_view)
        emptyIcon = findViewById(R.id.empty_icon)
        emptyText = findViewById(R.id.empty_text)
        remindersScrollView = findViewById(R.id.reminders_scroll_view)
        remindersContainer = findViewById(R.id.reminders_container)
        headerTitle = findViewById(R.id.header_title)
        btnHeaderVoice = findViewById(R.id.btn_header_voice)
        btnEmptyVoice = findViewById(R.id.btn_empty_voice)

        val density = resources.displayMetrics.density
        val chipDrawable = GradientDrawable().apply {
            setColor(ContextCompat.getColor(this@MainActivity, R.color.surface_chip))
            cornerRadius = 17f * density
        }

        btnHeaderVoice?.let { btn ->
            val circleDrawable = GradientDrawable().apply {
                setColor(ContextCompat.getColor(this@MainActivity, R.color.surface_chip))
                shape = GradientDrawable.OVAL
            }
            btn.background = circleDrawable
            btn.setOnClickListener { startVoiceCapture() }
        }

        btnEmptyVoice?.let { btn ->
            btn.background = chipDrawable
            btn.setOnClickListener { startVoiceCapture() }
        }
    }

    private fun observeReminders() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                reminderDao.observeActiveReminders().collect { reminders ->
                    renderReminders(reminders)
                }
            }
        }
    }

    @VisibleForTesting
    fun renderReminders(reminders: List<ReminderEntity>) {
        if (reminders.isEmpty()) {
            emptyStateView.visibility = View.VISIBLE
            remindersScrollView.visibility = View.GONE
            remindersContainer.removeAllViews()
            return
        }

        emptyStateView.visibility = View.GONE
        remindersScrollView.visibility = View.VISIBLE
        remindersContainer.removeAllViews()

        val inflater = LayoutInflater.from(this)
        val now = nowMillis

        for (reminder in reminders) {
            val cardView = inflater.inflate(R.layout.item_reminder, remindersContainer, false)
            bindReminderItem(cardView, reminder, now)
            remindersContainer.addView(cardView)
        }
    }

    private fun bindReminderItem(cardView: View, reminder: ReminderEntity, now: Long) {
        val density = resources.displayMetrics.density

        // Apply Swiss Void rounded card styling
        val cardDrawable = GradientDrawable().apply {
            setColor(ContextCompat.getColor(this@MainActivity, R.color.surface_card))
            cornerRadius = 14f * density
            setStroke((1f * density).toInt(), ContextCompat.getColor(this@MainActivity, R.color.ambient_stroke))
        }
        cardView.background = cardDrawable

        val titleView: TextView = cardView.findViewById(R.id.reminder_title)
        val dueView: TextView = cardView.findViewById(R.id.reminder_due)
        val snoozeCountView: TextView = cardView.findViewById(R.id.reminder_snooze_count)
        val btnSnooze: Button = cardView.findViewById(R.id.btn_snooze)
        val btnComplete: Button = cardView.findViewById(R.id.btn_complete)

        // Bind title
        titleView.text = reminder.title

        // Formatted countdown / overdue styling
        val isOverdue = now >= reminder.dueDate
        val dueText = TileLayoutBuilder.formatDueCountdown(reminder.dueDate, now)
        dueView.text = dueText

        if (isOverdue) {
            dueView.setTextColor(ContextCompat.getColor(this, R.color.international_orange))
        } else {
            dueView.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
        }

        // Snooze count indicator
        if (reminder.snoozeCount > 0) {
            snoozeCountView.visibility = View.VISIBLE
            snoozeCountView.text = "Snoozed ${reminder.snoozeCount}x"
        } else {
            snoozeCountView.visibility = View.GONE
        }

        // Action chip styling
        val chipDrawableSnooze = GradientDrawable().apply {
            setColor(ContextCompat.getColor(this@MainActivity, R.color.surface_chip))
            cornerRadius = 18f * density
        }
        btnSnooze.background = chipDrawableSnooze

        val chipDrawableComplete = GradientDrawable().apply {
            setColor(ContextCompat.getColor(this@MainActivity, R.color.surface_chip))
            cornerRadius = 18f * density
            setStroke((1f * density).toInt(), ContextCompat.getColor(this@MainActivity, R.color.ambient_stroke))
        }
        btnComplete.background = chipDrawableComplete

        // 1-Tap Quick Actions
        btnSnooze.setOnClickListener {
            snoozeReminder(reminder)
        }

        btnComplete.setOnClickListener {
            completeReminder(reminder)
        }
    }

    /**
     * Snoozes a reminder by +15 minutes using strict SnoozeEngine calculation.
     */
    fun snoozeReminder(reminder: ReminderEntity): Job {
        val now = nowMillis
        val newDueDate = SnoozeEngine.calculate15Minutes(now, reminder.dueDate)
        return lifecycleScope.launch(Dispatchers.IO) {
            try {
                reminderDao.snoozeReminder(reminder.id, newDueDate, now)
                notifySurfaces()
                RemySyncManager.triggerSync(this@MainActivity)
            } catch (e: Exception) {
                Log.e(TAG, "Error snoozing reminder: ${reminder.id}", e)
            }
        }
    }

    /**
     * Marks a reminder as complete.
     */
    fun completeReminder(reminder: ReminderEntity): Job {
        val now = nowMillis
        return lifecycleScope.launch(Dispatchers.IO) {
            try {
                reminderDao.completeReminder(reminder.id, now)
                notifySurfaces()
                RemySyncManager.triggerSync(this@MainActivity)
            } catch (e: Exception) {
                Log.e(TAG, "Error completing reminder: ${reminder.id}", e)
            }
        }
    }

    /**
     * Dispatches push-driven invalidations to watch face complications and ProtoLayout tiles.
     */
    fun notifySurfaces() {
        try {
            RemyComplicationUpdater.requestUpdate(this)
        } catch (e: Exception) {
            Log.w(TAG, "Unable to request complication update", e)
        }
        try {
            TileService.getUpdater(this).requestUpdate(RemyTileService::class.java)
        } catch (e: Exception) {
            Log.w(TAG, "Unable to request tile update", e)
        }
        try {
            surfaceNotificationListener?.invoke()
        } catch (e: Exception) {
            // Ignore in tests
        }
    }

    /**
     * Ingests voice dictation into local prospective memory ledger and triggers background sync.
     */
    fun handleVoiceCapture(rawText: String): ReminderEntity {
        val now = nowMillis
        val parsed = parseVoiceText(rawText, now)
        val reminder = ReminderEntity(
            id = UUID.randomUUID().toString(),
            title = parsed.title,
            dueDate = parsed.dueDate,
            armed = parsed.armed,
            status = ReminderEntity.STATUS_PENDING,
            createdAt = now,
            updatedAt = now,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                reminderDao.upsert(reminder)
                notifySurfaces()
                RemySyncManager.triggerSync(this@MainActivity)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to persist voice capture", e)
            }
        }
        return reminder
    }

    data class ParsedVoiceInput(val title: String, val dueDate: Long, val armed: Boolean)

    /**
     * Parses natural language speech input for temporal cues matching Capture philosophy.
     * Raw thoughts without time cues default to armed=false (zero false alarms).
     */
    fun parseVoiceText(rawText: String, now: Long): ParsedVoiceInput {
        val trimmed = rawText.trim()
        val lower = trimmed.lowercase()

        // 1. Relative cues: +15m, 15m, 15 min, +1h, 1h, 1 hour (including "in 15m", "in 1 hour")
        val min15Regex = Regex("""(?:\bin\s+)?(?:\+?15\s*(?:m|min|mins|minutes?))\b""", RegexOption.IGNORE_CASE)
        val hour1Regex = Regex("""(?:\bin\s+)?(?:\+?1\s*(?:h|hr|hrs|hours?)|an hour)\b""", RegexOption.IGNORE_CASE)

        if (min15Regex.containsMatchIn(lower)) {
            val cleanTitle = lower.replace(min15Regex, "").trim()
            val finalTitle = if (cleanTitle.isNotEmpty()) cleanTitle.replaceFirstChar { it.uppercase() } else trimmed
            return ParsedVoiceInput(finalTitle, now + 15 * 60_000L, armed = true)
        }

        if (hour1Regex.containsMatchIn(lower)) {
            val cleanTitle = lower.replace(hour1Regex, "").trim()
            val finalTitle = if (cleanTitle.isNotEmpty()) cleanTitle.replaceFirstChar { it.uppercase() } else trimmed
            return ParsedVoiceInput(finalTitle, now + 60 * 60_000L, armed = true)
        }

        // 2. Tonight / this evening (20:00)
        if (lower.contains("tonight") || lower.contains("this evening")) {
            val cleanTitle = lower.replace("tonight", "").replace("this evening", "").trim()
            val finalTitle = if (cleanTitle.isNotEmpty()) cleanTitle.replaceFirstChar { it.uppercase() } else trimmed
            val cal = Calendar.getInstance().apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, 20)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (timeInMillis <= now) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }
            return ParsedVoiceInput(finalTitle, cal.timeInMillis, armed = true)
        }

        // 3. Tomorrow morning / kal subah (09:00)
        if (lower.contains("tomorrow morning") || lower.contains("kal subah")) {
            val cleanTitle = lower.replace("tomorrow morning", "").replace("kal subah", "").trim()
            val finalTitle = if (cleanTitle.isNotEmpty()) cleanTitle.replaceFirstChar { it.uppercase() } else trimmed
            val cal = Calendar.getInstance().apply {
                timeInMillis = now
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 9)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            return ParsedVoiceInput(finalTitle, cal.timeInMillis, armed = true)
        }

        // 4. Tomorrow / kal (09:00)
        if (lower.contains("tomorrow") || lower.contains("kal")) {
            val cleanTitle = lower.replace("tomorrow", "").replace("kal", "").trim()
            val finalTitle = if (cleanTitle.isNotEmpty()) cleanTitle.replaceFirstChar { it.uppercase() } else trimmed
            val cal = Calendar.getInstance().apply {
                timeInMillis = now
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 9)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            return ParsedVoiceInput(finalTitle, cal.timeInMillis, armed = true)
        }

        // 5. Default unarmed thought capture!
        // Unarmed thoughts never trigger false alarms, stored passively for prospective memory review.
        return ParsedVoiceInput(trimmed, now + 86_400_000L, armed = false)
    }
}
