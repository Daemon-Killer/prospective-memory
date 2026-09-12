package com.remy.wear.domain.model

/**
 * Reminder lifecycle status matching the mobile application's wire format.
 */
enum class ReminderStatus(val wireValue: String) {
    PENDING("pending"),
    SNOOZED("snoozed"),
    COMPLETED("completed");

    companion object {
        fun fromWireValue(value: String): ReminderStatus =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) }
                ?: throw IllegalArgumentException("Unknown reminder status wire value: '$value'")

        fun fromWireValueOrDefault(value: String, default: ReminderStatus = PENDING): ReminderStatus =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) } ?: default
    }
}
