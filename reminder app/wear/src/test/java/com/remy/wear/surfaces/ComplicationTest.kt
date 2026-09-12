package com.remy.wear.surfaces

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.complication.RemyComplicationFactory
import com.remy.wear.surfaces.complication.RemyComplicationService
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class ComplicationTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun createTestReminder(
        id: String = "test-1",
        title: String = "Medication",
        createdAt: Long = 1_000_000L,
        dueDate: Long = 2_000_000L,
        status: String = ReminderEntity.STATUS_PENDING
    ): ReminderEntity {
        return ReminderEntity(
            id = id,
            title = title,
            dueDate = dueDate,
            status = status,
            createdAt = createdAt,
            updatedAt = createdAt,
            syncStatus = ReminderEntity.SYNC_STATUS_SYNCED
        )
    }

    // =========================================================================
    // SHORT_TEXT Test Cases
    // =========================================================================

    @Test
    fun buildShortText_activeCountdown_createsCountDownTimeDifference() {
        val createdAt = 1_000_000L
        val dueDate = 2_000_000L
        val nowMillis = 1_500_000L // 500s remaining

        val reminder = createTestReminder(createdAt = createdAt, dueDate = dueDate)
        val data = RemyComplicationFactory.buildShortTextComplication(reminder, nowMillis)

        assertEquals(ComplicationType.SHORT_TEXT, data.type)
        assertTrue(data.text is TimeDifferenceComplicationText)
        val timeDiff = data.text as TimeDifferenceComplicationText
        assertEquals(TimeUnit.MINUTES, timeDiff.getMinimumTimeUnit())

        val title = (data.title as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("REMY", title)

        val desc = (data.contentDescription as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertTrue(desc.contains("Medication"))
    }

    @Test
    fun buildShortText_overdue_createsCountUpTimeDifferenceWithAlertTitle() {
        val createdAt = 1_000_000L
        val dueDate = 2_000_000L
        val nowMillis = 2_500_000L // 500s overdue

        val reminder = createTestReminder(createdAt = createdAt, dueDate = dueDate)
        val data = RemyComplicationFactory.buildShortTextComplication(reminder, nowMillis)

        assertEquals(ComplicationType.SHORT_TEXT, data.type)
        assertTrue(data.text is TimeDifferenceComplicationText)
        val timeDiff = data.text as TimeDifferenceComplicationText
        assertEquals(TimeUnit.MINUTES, timeDiff.getMinimumTimeUnit())

        val title = (data.title as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("OVERDUE", title)

        val desc = (data.contentDescription as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertTrue(desc.contains("Overdue reminder: Medication"))
    }

    @Test
    fun buildShortText_emptyDatabase_createsAllClearText() {
        val data = RemyComplicationFactory.buildShortTextComplication(null, 1_000_000L)

        assertEquals(ComplicationType.SHORT_TEXT, data.type)
        assertTrue(data.text is PlainComplicationText)
        val text = (data.text as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("✓", text)

        val title = (data.title as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("CLEAR", title)
    }

    // =========================================================================
    // RANGED_VALUE Test Cases
    // =========================================================================

    @Test
    fun buildRangedValue_activeProgress_calculatesCorrectPercentage() {
        val createdAt = 1_000_000L
        val dueDate = 2_000_000L // 1,000s duration
        val nowMillis = 1_500_000L // 500s elapsed -> 50%

        val reminder = createTestReminder(createdAt = createdAt, dueDate = dueDate)
        val data = RemyComplicationFactory.buildRangedValueComplication(reminder, nowMillis)

        assertEquals(ComplicationType.RANGED_VALUE, data.type)
        assertEquals(0f, data.min, 0.001f)
        assertEquals(100f, data.max, 0.001f)
        assertEquals(50f, data.value, 0.001f)
        assertEquals(RangedValueComplicationData.TYPE_PERCENTAGE, data.valueType)

        assertNotNull(data.colorRamp)
        assertTrue(data.colorRamp?.interpolated == true)
        val colors = data.colorRamp?.colors ?: intArrayOf()
        assertEquals(2, colors.size)
        assertEquals(RemyComplicationFactory.COLOR_SLATE_MUTED, colors[0])
        assertEquals(RemyComplicationFactory.COLOR_SWISS_WHITE, colors[1])
    }

    @Test
    fun buildRangedValue_overdue_clampsToMaxAndAppliesOrangeColorRamp() {
        val createdAt = 1_000_000L
        val dueDate = 2_000_000L
        val nowMillis = 3_000_000L // 200% elapsed (overdue)

        val reminder = createTestReminder(createdAt = createdAt, dueDate = dueDate)
        val data = RemyComplicationFactory.buildRangedValueComplication(reminder, nowMillis)

        assertEquals(ComplicationType.RANGED_VALUE, data.type)
        assertEquals(0f, data.min, 0.001f)
        assertEquals(100f, data.max, 0.001f)
        // Strict platform constraint: value must never exceed max
        assertEquals(100f, data.value, 0.001f)

        assertNotNull(data.colorRamp)
        val colors = data.colorRamp?.colors ?: intArrayOf()
        assertEquals(2, colors.size)
        assertEquals(RemyComplicationFactory.COLOR_INTERNATIONAL_ORANGE, colors[0])
        assertEquals(RemyComplicationFactory.COLOR_INTERNATIONAL_ORANGE, colors[1])

        val title = (data.title as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("OVERDUE", title)
    }

    @Test
    fun buildRangedValue_emptyDatabase_returnsZeroProgress() {
        val data = RemyComplicationFactory.buildRangedValueComplication(null, 1_000_000L)

        assertEquals(ComplicationType.RANGED_VALUE, data.type)
        assertEquals(0f, data.min, 0.001f)
        assertEquals(100f, data.max, 0.001f)
        assertEquals(0f, data.value, 0.001f)

        val text = (data.text as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("0", text)
        val title = (data.title as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("CLEAR", title)
    }

    @Test
    fun buildRangedValue_zeroDuration_handlesGracefullyWithoutDivisionByZero() {
        val instant = 1_000_000L
        // Corrupted or simultaneous timestamps: createdAt == dueDate
        val reminder = createTestReminder(createdAt = instant, dueDate = instant)
        val data = RemyComplicationFactory.buildRangedValueComplication(reminder, instant)

        assertEquals(0f, data.min, 0.001f)
        assertEquals(100f, data.max, 0.001f)
        assertEquals(0f, data.value, 0.001f)
    }

    // =========================================================================
    // Preview Data Tests
    // =========================================================================

    @Test
    fun buildPreviewData_shortText_returnsPreviewPayload() {
        val data = RemyComplicationFactory.buildPreviewData(ComplicationType.SHORT_TEXT)
        assertNotNull(data)
        assertEquals(ComplicationType.SHORT_TEXT, data?.type)
        val text = ((data as ShortTextComplicationData).text as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("15m", text)
    }

    @Test
    fun buildPreviewData_rangedValue_returnsPreviewPayload() {
        val data = RemyComplicationFactory.buildPreviewData(ComplicationType.RANGED_VALUE)
        assertNotNull(data)
        assertEquals(ComplicationType.RANGED_VALUE, data?.type)
        val ranged = data as RangedValueComplicationData
        assertEquals(75f, ranged.value, 0.001f)
        assertEquals(0f, ranged.min, 0.001f)
        assertEquals(100f, ranged.max, 0.001f)
    }

    @Test
    fun buildPreviewData_unsupportedType_returnsNull() {
        val data = RemyComplicationFactory.buildPreviewData(ComplicationType.LONG_TEXT)
        assertNull(data)
    }

    // =========================================================================
    // Service Integration Tests
    // =========================================================================

    @Test
    fun service_onComplicationRequest_delegatesToDaoAndBuildsPayload() = runTest {
        val service = Robolectric.buildService(RemyComplicationService::class.java).create().get().apply {
            testDao = dao
        }

        // 1. Initial request with empty DB -> returns CLEAR state
        val requestShort = ComplicationRequest(1, ComplicationType.SHORT_TEXT, false)
        val emptyData = service.onComplicationRequest(requestShort)
        assertNotNull(emptyData)
        assertTrue(emptyData is ShortTextComplicationData)
        val emptyText = ((emptyData as ShortTextComplicationData).text as PlainComplicationText).getTextAt(context.resources, Instant.now()).toString()
        assertEquals("✓", emptyText)

        // 2. Insert active reminder -> returns dynamic countdown
        val reminder = createTestReminder(
            id = "rem-10",
            title = "Doctor Appointment",
            createdAt = System.currentTimeMillis(),
            dueDate = System.currentTimeMillis() + 1_800_000L // 30m future
        )
        dao.upsert(reminder)

        val populatedData = service.onComplicationRequest(requestShort)
        assertNotNull(populatedData)
        assertTrue(populatedData is ShortTextComplicationData)
        assertTrue((populatedData as ShortTextComplicationData).text is TimeDifferenceComplicationText)

        // 3. Request RANGED_VALUE
        val requestRanged = ComplicationRequest(2, ComplicationType.RANGED_VALUE, false)
        val rangedData = service.onComplicationRequest(requestRanged)
        assertNotNull(rangedData)
        assertTrue(rangedData is RangedValueComplicationData)
        val ranged = rangedData as RangedValueComplicationData
        assertEquals(0f, ranged.min, 0.001f)
        assertEquals(100f, ranged.max, 0.001f)
        assertTrue(ranged.value in 0f..100f)
    }

    @Test
    fun service_getPreviewData_returnsValidComplicationData() {
        val service = Robolectric.buildService(RemyComplicationService::class.java).create().get()
        val preview = service.getPreviewData(ComplicationType.SHORT_TEXT)
        assertNotNull(preview)
        assertEquals(ComplicationType.SHORT_TEXT, preview?.type)
    }
}
