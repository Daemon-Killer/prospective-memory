package com.remy.wear.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for local reminder storage and glanceable Wear OS surfaces.
 */
@Dao
interface ReminderDao {

    // =========================================================================
    // Glanceable Surface Queries (Reactive Kotlin Flow)
    // =========================================================================

    /**
     * Emits the complete list of active reminders (pending or snoozed), ordered chronologically.
     * Consumed by Wear OS ProtoLayout 1.2 Swipe Tiles and in-app task cards.
     */
    @Query("""
        SELECT * FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') 
        ORDER BY dueDate ASC
    """)
    fun observeActiveReminders(): Flow<List<ReminderEntity>>

    /**
     * Emits the single nearest upcoming or overdue reminder.
     * Consumed by Watch Face Format Complications (SHORT_TEXT and RANGED_VALUE).
     * Only armed reminders are eligible for active countdown complications.
     */
    @Query("""
        SELECT * FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') AND armed = 1
        ORDER BY dueDate ASC 
        LIMIT 1
    """)
    fun observeNearestActiveReminder(): Flow<ReminderEntity?>

    /**
     * Emits a specific reminder reactively by ID.
     */
    @Query("SELECT * FROM reminders WHERE id = :id LIMIT 1")
    fun observeReminderById(id: String): Flow<ReminderEntity?>

    /**
     * Emits the total count of reminders currently overdue relative to currentTimeMillis.
     * Passive unarmed prospective memory notes are excluded to prevent false alarms.
     */
    @Query("""
        SELECT COUNT(*) FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') AND armed = 1 AND dueDate <= :currentTimeMillis
    """)
    fun observeOverdueCount(currentTimeMillis: Long): Flow<Int>

    // =========================================================================
    // One-Shot Snapshots
    // =========================================================================

    /**
     * One-shot snapshot of active reminders for synchronous Tile rendering.
     */
    @Query("""
        SELECT * FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') 
        ORDER BY dueDate ASC
    """)
    suspend fun getActiveReminders(): List<ReminderEntity>

    /**
     * One-shot query for the single nearest active reminder.
     * Only armed reminders are eligible for active countdown complications.
     */
    @Query("""
        SELECT * FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') AND armed = 1
        ORDER BY dueDate ASC 
        LIMIT 1
    """)
    suspend fun getNearestActiveReminder(): ReminderEntity?

    /**
     * One-shot fetch for a reminder by ID.
     */
    @Query("SELECT * FROM reminders WHERE id = :id LIMIT 1")
    suspend fun getReminderById(id: String): ReminderEntity?

    /**
     * One-shot count of overdue reminders.
     * Passive unarmed prospective memory notes are excluded.
     */
    @Query("""
        SELECT COUNT(*) FROM reminders 
        WHERE isDeleted = 0 AND status IN ('pending', 'snoozed') AND armed = 1 AND dueDate <= :currentTimeMillis
    """)
    suspend fun getOverdueCount(currentTimeMillis: Long): Int

    // =========================================================================
    // Watch User Action Mutations (Atomic SQLite UPDATEs)
    // =========================================================================

    /**
     * Snoozes a reminder to a new target due date.
     * Increments snoozeCount, records lastSnoozedAt and updatedAt, sets status to 'snoozed',
     * and flags syncStatus as 'PENDING_UPLOAD'.
     *
     * @return Number of rows updated (1 if found, 0 if not found)
     */
    @Query("""
        UPDATE reminders 
        SET dueDate = :newDueDateMillis,
            snoozeCount = snoozeCount + 1,
            lastSnoozedAt = :nowMillis,
            status = 'snoozed',
            syncStatus = 'PENDING_UPLOAD',
            updatedAt = :nowMillis 
        WHERE id = :id
    """)
    suspend fun snoozeReminder(id: String, newDueDateMillis: Long, nowMillis: Long): Int

    /**
     * Marks a reminder as completed.
     * Sets status to 'completed', records completedAt and updatedAt,
     * and flags syncStatus as 'PENDING_UPLOAD'.
     *
     * @return Number of rows updated (1 if found, 0 if not found)
     */
    @Query("""
        UPDATE reminders 
        SET status = 'completed',
            completedAt = :nowMillis,
            syncStatus = 'PENDING_UPLOAD',
            updatedAt = :nowMillis 
        WHERE id = :id
    """)
    suspend fun completeReminder(id: String, nowMillis: Long): Int

    /**
     * Soft-deletes a reminder (tombstone).
     * Sets isDeleted = 1, records updatedAt, and flags syncStatus as 'PENDING_UPLOAD'.
     *
     * @return Number of rows updated (1 if found, 0 if not found)
     */
    @Query("""
        UPDATE reminders 
        SET isDeleted = 1,
            syncStatus = 'PENDING_UPLOAD',
            updatedAt = :nowMillis 
        WHERE id = :id
    """)
    suspend fun markDeleted(id: String, nowMillis: Long): Int

    // =========================================================================
    // Sync Management & LWW Conflict Resolution
    // =========================================================================

    /**
     * Retrieves all mutated records awaiting synchronization with the phone.
     */
    @Query("SELECT * FROM reminders WHERE syncStatus = 'PENDING_UPLOAD'")
    suspend fun getPendingUploads(): List<ReminderEntity>

    /**
     * Marks a reminder as cleanly synced if its local updatedAt matches the acknowledged timestamp.
     * Guarding with updatedAt ensures that rapid subsequent local edits are not falsely marked as synced.
     */
    @Query("UPDATE reminders SET syncStatus = 'SYNCED' WHERE id = :id AND updatedAt = :updatedAt")
    suspend fun markSynced(id: String, updatedAt: Long): Int

    /**
     * Insert or update a single reminder record.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(reminder: ReminderEntity)

    /**
     * Insert or update a collection of reminders in batch.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(reminders: List<ReminderEntity>)

    /**
     * Last-Write-Wins (LWW) Batch Ingestion from Mobile Host.
     * Reconciles incoming reminders against local records atomically.
     */
    @Transaction
    suspend fun reconcileIncomingBatch(incoming: List<ReminderEntity>) {
        for (item in incoming) {
            val local = getReminderById(item.id)
            if (local == null) {
                // New record from phone: insert cleanly as SYNCED
                upsert(item.copy(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
            } else {
                if (local.syncStatus == ReminderEntity.SYNC_STATUS_PENDING_UPLOAD) {
                    // Local record has uncommitted offline mutations
                    if (item.updatedAt > local.updatedAt) {
                        // Phone has strictly newer update: overwrite local
                        upsert(item.copy(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
                    } else if (item.updatedAt == local.updatedAt) {
                        // Tie-breaker: completed status takes precedence
                        if (item.status == ReminderEntity.STATUS_COMPLETED) {
                            upsert(item.copy(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
                        }
                    }
                    // If local is newer (local.updatedAt > item.updatedAt): retain local mutation
                } else {
                    // Local record was cleanly SYNCED: accept phone update if newer or equal
                    if (item.updatedAt >= local.updatedAt) {
                        upsert(item.copy(syncStatus = ReminderEntity.SYNC_STATUS_SYNCED))
                    }
                }
            }
        }
    }

    /**
     * Purges tombstone records older than cutoffMillis to reclaim disk space.
     *
     * @return Number of permanently deleted rows
     */
    @Query("DELETE FROM reminders WHERE isDeleted = 1 AND updatedAt < :cutoffMillis")
    suspend fun purgeOldTombstones(cutoffMillis: Long): Int

    /**
     * Clears all reminders from the database (for testing and reset).
     */
    @Query("DELETE FROM reminders")
    suspend fun clearAll()
}
