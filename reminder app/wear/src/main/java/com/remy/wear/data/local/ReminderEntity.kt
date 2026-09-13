package com.remy.wear.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Core SQLite entity representing a reminder on Wear OS 5.
 *
 * Designed for sub-millisecond glanceable surface reads and offline-first Bluetooth P2P sync.
 * All timestamps are stored as 64-bit UTC epoch milliseconds.
 */
@Entity(
    tableName = "reminders",
    indices = [
        Index(
            name = "idx_active_reminders",
            value = ["isDeleted", "status", "dueDate"]
        ),
        Index(
            name = "idx_sync_status",
            value = ["syncStatus"]
        ),
        Index(
            name = "idx_updated_at",
            value = ["updatedAt"]
        )
    ]
)
data class ReminderEntity(
    /** Unique RFC 4122 UUID v4 identifier matching the mobile host */
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    /** Reminder title (trimmed, 1..255 characters) */
    @ColumnInfo(name = "title")
    val title: String,

    /** Optional notes or extended context */
    @ColumnInfo(name = "notes")
    val notes: String? = null,

    /** Alert trigger time in 64-bit UTC epoch milliseconds (seconds zeroed to 00) */
    @ColumnInfo(name = "dueDate")
    val dueDate: Long,

    /** Lifecycle status: "pending", "snoozed", or "completed" */
    @ColumnInfo(name = "status", defaultValue = STATUS_PENDING)
    val status: String = STATUS_PENDING,

    /** Snooze iteration counter (>= 0) */
    @ColumnInfo(name = "snoozeCount", defaultValue = "0")
    val snoozeCount: Int = 0,

    /** Timestamp of the most recent snooze event in UTC epoch milliseconds, or null */
    @ColumnInfo(name = "lastSnoozedAt")
    val lastSnoozedAt: Long? = null,

    /** Creation timestamp in UTC epoch milliseconds */
    @ColumnInfo(name = "createdAt")
    val createdAt: Long,

    /** Last update timestamp in UTC epoch milliseconds (used for LWW reconciliation) */
    @ColumnInfo(name = "updatedAt")
    val updatedAt: Long,

    /** Timestamp when reminder was completed in UTC epoch milliseconds, or null */
    @ColumnInfo(name = "completedAt")
    val completedAt: Long? = null,

    /** Optional Android notification ID */
    @ColumnInfo(name = "notificationId")
    val notificationId: String? = null,

    /** Soft-deletion flag: true indicates tombstone pending sync or purge */
    @ColumnInfo(name = "isDeleted", defaultValue = "0")
    val isDeleted: Boolean = false,

    /** Bluetooth P2P replication state: "SYNCED", "PENDING_UPLOAD", or "CONFLICT" */
    @ColumnInfo(name = "syncStatus", defaultValue = SYNC_STATUS_SYNCED)
    val syncStatus: String = SYNC_STATUS_SYNCED,

    /** Whether the reminder has an active alarm armed (false indicates passive/unarmed prospective memory note) */
    @ColumnInfo(name = "armed", defaultValue = "1")
    val armed: Boolean = true
) {
    companion object {
        // Domain status constants matching phone wire types
        const val STATUS_PENDING = "pending"
        const val STATUS_SNOOZED = "snoozed"
        const val STATUS_COMPLETED = "completed"

        // Sync status constants
        const val SYNC_STATUS_SYNCED = "SYNCED"
        const val SYNC_STATUS_PENDING_UPLOAD = "PENDING_UPLOAD"
        const val SYNC_STATUS_CONFLICT = "CONFLICT"
    }

    /** Convenience helper verifying if the reminder is currently active */
    val isActive: Boolean
        get() = !isDeleted && (status == STATUS_PENDING || status == STATUS_SNOOZED)

    /** Convenience helper verifying if the reminder is completed */
    val isCompleted: Boolean
        get() = !isDeleted && status == STATUS_COMPLETED
}
