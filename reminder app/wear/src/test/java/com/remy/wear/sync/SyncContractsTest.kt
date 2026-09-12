package com.remy.wear.sync

import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderEntity
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncContractsTest {

    @Test
    fun reminderDtoSerializationRoundtrip() {
        val original = SyncContracts.ReminderSyncDto(
            id = "remy-uuid-101",
            title = "Check blood pressure",
            notes = "Post-lunch measurement",
            dueDate = 1_700_000_900_000L,
            status = ReminderEntity.STATUS_PENDING,
            snoozeCount = 2,
            lastSnoozedAt = 1_700_000_300_000L,
            createdAt = 1_700_000_000_000L,
            updatedAt = 1_700_000_300_000L,
            completedAt = null,
            isDeleted = false
        )

        val json = original.toJson()
        val parsed = SyncContracts.ReminderSyncDto.fromJson(json)

        assertThat(parsed).isEqualTo(original)
    }

    @Test
    fun entityToDtoAndBackPreservesFields() {
        val entity = ReminderEntity(
            id = "remy-uuid-202",
            title = "Pick up prescription",
            notes = null,
            dueDate = 1_700_005_000_000L,
            status = ReminderEntity.STATUS_SNOOZED,
            snoozeCount = 1,
            lastSnoozedAt = 1_700_001_000_000L,
            createdAt = 1_700_000_000_000L,
            updatedAt = 1_700_001_000_000L,
            completedAt = null,
            isDeleted = false,
            syncStatus = ReminderEntity.SYNC_STATUS_PENDING_UPLOAD
        )

        val dto = SyncContracts.ReminderSyncDto.fromEntity(entity)
        val restoredEntity = dto.toEntity(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED)

        assertThat(restoredEntity.id).isEqualTo(entity.id)
        assertThat(restoredEntity.title).isEqualTo(entity.title)
        assertThat(restoredEntity.notes).isNull()
        assertThat(restoredEntity.dueDate).isEqualTo(entity.dueDate)
        assertThat(restoredEntity.status).isEqualTo(entity.status)
        assertThat(restoredEntity.snoozeCount).isEqualTo(entity.snoozeCount)
        assertThat(restoredEntity.lastSnoozedAt).isEqualTo(entity.lastSnoozedAt)
        assertThat(restoredEntity.createdAt).isEqualTo(entity.createdAt)
        assertThat(restoredEntity.updatedAt).isEqualTo(entity.updatedAt)
        assertThat(restoredEntity.isDeleted).isEqualTo(entity.isDeleted)
        assertThat(restoredEntity.syncStatus).isEqualTo(ReminderEntity.SYNC_STATUS_SYNCED)
    }

    @Test
    fun reminderBatchPayloadSerializationRoundtrip() {
        val reminders = listOf(
            SyncContracts.ReminderSyncDto(
                id = "id-1",
                title = "Task 1",
                notes = "Note 1",
                dueDate = 1_700_000_000_000L,
                status = ReminderEntity.STATUS_PENDING,
                snoozeCount = 0,
                lastSnoozedAt = null,
                createdAt = 1_700_000_000_000L,
                updatedAt = 1_700_000_000_000L,
                completedAt = null,
                isDeleted = false
            ),
            SyncContracts.ReminderSyncDto(
                id = "id-2",
                title = "Task 2",
                notes = null,
                dueDate = 1_700_003_600_000L,
                status = ReminderEntity.STATUS_COMPLETED,
                snoozeCount = 3,
                lastSnoozedAt = 1_700_002_000_000L,
                createdAt = 1_700_000_000_000L,
                updatedAt = 1_700_003_000_000L,
                completedAt = 1_700_003_000_000L,
                isDeleted = false
            )
        )

        val batch = SyncContracts.ReminderBatchPayload(
            reminders = reminders,
            timestampEpochMs = 1_700_003_500_000L
        )

        val bytes = batch.toByteArray()
        assertThat(bytes.size).isGreaterThan(0)

        val restoredBatch = SyncContracts.ReminderBatchPayload.fromByteArray(bytes)
        assertThat(restoredBatch.reminders).hasSize(2)
        assertThat(restoredBatch.reminders[0].id).isEqualTo("id-1")
        assertThat(restoredBatch.reminders[1].id).isEqualTo("id-2")
        assertThat(restoredBatch.timestampEpochMs).isEqualTo(1_700_003_500_000L)
    }

    @Test
    fun actionSyncPayloadRoundtrip() {
        val snoozeAction = SyncContracts.ActionSyncPayload(
            action = "snooze",
            reminderId = "task-303",
            durationMinutes = 15L,
            timestampEpochMs = 1_700_000_050_000L
        )

        val bytes = snoozeAction.toByteArray()
        val parsed = SyncContracts.ActionSyncPayload.fromByteArray(bytes)

        assertThat(parsed.action).isEqualTo("snooze")
        assertThat(parsed.reminderId).isEqualTo("task-303")
        assertThat(parsed.durationMinutes).isEqualTo(15L)
        assertThat(parsed.timestampEpochMs).isEqualTo(1_700_000_050_000L)

        val completeAction = SyncContracts.ActionSyncPayload(
            action = "complete",
            reminderId = "task-303",
            durationMinutes = null
        )
        val completeBytes = completeAction.toByteArray()
        val parsedComplete = SyncContracts.ActionSyncPayload.fromByteArray(completeBytes)

        assertThat(parsedComplete.action).isEqualTo("complete")
        assertThat(parsedComplete.reminderId).isEqualTo("task-303")
        assertThat(parsedComplete.durationMinutes).isNull()
    }

    @Test
    fun reminderBatchPayload_emptyBytes_throwsIllegalArgumentException() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            SyncContracts.ReminderBatchPayload.fromByteArray(ByteArray(0))
        }
        assertThat(ex.message).isEqualTo("Payload bytes cannot be empty")
    }

    @Test
    fun actionSyncPayload_emptyBytes_throwsIllegalArgumentException() {
        val ex = assertThrows(IllegalArgumentException::class.java) {
            SyncContracts.ActionSyncPayload.fromByteArray(ByteArray(0))
        }
        assertThat(ex.message).isEqualTo("Payload bytes cannot be empty")
    }
}
