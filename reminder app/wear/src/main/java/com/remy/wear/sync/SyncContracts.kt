package com.remy.wear.sync

import com.remy.wear.data.local.ReminderEntity
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * Protocol contracts and serialization codecs for Bluetooth P2P communication
 * between the Mobile host (React Native / Android) and the Wear OS companion.
 *
 * Utilizes Play Services Wearable DataClient (/remy/reminders) and MessageClient (/remy/action).
 */
object SyncContracts {

    const val PATH_REMINDERS = "/remy/reminders"
    const val PATH_ACTION_SNOOZE = "/remy/action/snooze"
    const val PATH_ACTION_COMPLETE = "/remy/action/complete"
    const val PATH_ACTION_DELETE = "/remy/action/delete"
    const val PATH_PING = "/remy/ping"

    const val KEY_PAYLOAD = "payload"
    const val KEY_TIMESTAMP = "timestamp"

    /**
     * Wire DTO for a single reminder item transferred across Bluetooth.
     */
    data class ReminderSyncDto(
        val id: String,
        val title: String,
        val notes: String? = null,
        val dueDate: Long,
        val status: String = ReminderEntity.STATUS_PENDING,
        val snoozeCount: Int = 0,
        val lastSnoozedAt: Long? = null,
        val createdAt: Long,
        val updatedAt: Long,
        val completedAt: Long? = null,
        val isDeleted: Boolean = false,
        val armed: Boolean = true
    ) {
        fun toEntity(syncStatus: String = ReminderEntity.SYNC_STATUS_SYNCED): ReminderEntity =
            ReminderEntity(
                id = id,
                title = title,
                notes = notes,
                dueDate = dueDate,
                status = status,
                snoozeCount = snoozeCount,
                lastSnoozedAt = lastSnoozedAt,
                createdAt = createdAt,
                updatedAt = updatedAt,
                completedAt = completedAt,
                notificationId = null,
                isDeleted = isDeleted,
                syncStatus = syncStatus,
                armed = armed
            )

        fun toJson(): JSONObject = JSONObject().apply {
            put("id", id)
            put("title", title)
            put("notes", notes ?: JSONObject.NULL)
            put("dueDate", dueDate)
            put("status", status)
            put("snoozeCount", snoozeCount)
            put("lastSnoozedAt", lastSnoozedAt ?: JSONObject.NULL)
            put("createdAt", createdAt)
            put("updatedAt", updatedAt)
            put("completedAt", completedAt ?: JSONObject.NULL)
            put("isDeleted", isDeleted)
            put("armed", armed)
        }

        companion object {
            fun fromEntity(entity: ReminderEntity): ReminderSyncDto =
                ReminderSyncDto(
                    id = entity.id,
                    title = entity.title,
                    notes = entity.notes,
                    dueDate = entity.dueDate,
                    status = entity.status,
                    snoozeCount = entity.snoozeCount,
                    lastSnoozedAt = entity.lastSnoozedAt,
                    createdAt = entity.createdAt,
                    updatedAt = entity.updatedAt,
                    completedAt = entity.completedAt,
                    isDeleted = entity.isDeleted,
                    armed = entity.armed
                )

            fun fromJson(json: JSONObject): ReminderSyncDto =
                ReminderSyncDto(
                    id = json.getString("id"),
                    title = json.getString("title"),
                    notes = if (json.isNull("notes")) null else json.optString("notes"),
                    dueDate = json.getLong("dueDate"),
                    status = json.optString("status", ReminderEntity.STATUS_PENDING),
                    snoozeCount = json.optInt("snoozeCount", 0),
                    lastSnoozedAt = if (json.isNull("lastSnoozedAt")) null else json.optLong("lastSnoozedAt"),
                    createdAt = json.getLong("createdAt"),
                    updatedAt = json.getLong("updatedAt"),
                    completedAt = if (json.isNull("completedAt")) null else json.optLong("completedAt"),
                    isDeleted = json.optBoolean("isDeleted", false),
                    armed = json.optBoolean("armed", true)
                )
        }
    }

    /**
     * Batch payload transferred via DataClient.
     */
    data class ReminderBatchPayload(
        val reminders: List<ReminderSyncDto>,
        val timestampEpochMs: Long = System.currentTimeMillis()
    ) {
        fun toByteArray(): ByteArray {
            val root = JSONObject()
            val array = JSONArray()
            reminders.forEach { array.put(it.toJson()) }
            root.put("reminders", array)
            root.put("timestamp", timestampEpochMs)
            return root.toString().toByteArray(StandardCharsets.UTF_8)
        }

        companion object {
            fun fromByteArray(bytes: ByteArray): ReminderBatchPayload {
                require(bytes.isNotEmpty()) { "Payload bytes cannot be empty" }
                val str = String(bytes, StandardCharsets.UTF_8)
                val root = JSONObject(str)
                val array = root.getJSONArray("reminders")
                val list = ArrayList<ReminderSyncDto>(array.length())
                for (i in 0 until array.length()) {
                    list.add(ReminderSyncDto.fromJson(array.getJSONObject(i)))
                }
                val ts = root.optLong("timestamp", System.currentTimeMillis())
                return ReminderBatchPayload(list, ts)
            }
        }
    }

    /**
     * Action message payload sent via MessageClient (/remy/action/...).
     */
    data class ActionSyncPayload(
        val action: String,
        val reminderId: String,
        val durationMinutes: Long? = null,
        val timestampEpochMs: Long = System.currentTimeMillis()
    ) {
        fun toByteArray(): ByteArray {
            val json = JSONObject().apply {
                put("action", action)
                put("reminderId", reminderId)
                put("durationMinutes", durationMinutes ?: JSONObject.NULL)
                put("timestamp", timestampEpochMs)
            }
            return json.toString().toByteArray(StandardCharsets.UTF_8)
        }

        companion object {
            fun fromByteArray(bytes: ByteArray): ActionSyncPayload {
                require(bytes.isNotEmpty()) { "Payload bytes cannot be empty" }
                val str = String(bytes, StandardCharsets.UTF_8)
                val json = JSONObject(str)
                return ActionSyncPayload(
                    action = json.getString("action"),
                    reminderId = json.getString("reminderId"),
                    durationMinutes = if (json.isNull("durationMinutes")) null else json.optLong("durationMinutes"),
                    timestampEpochMs = json.optLong("timestamp", System.currentTimeMillis())
                )
            }
        }
    }
}
