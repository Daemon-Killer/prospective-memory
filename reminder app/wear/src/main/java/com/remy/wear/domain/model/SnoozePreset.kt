package com.remy.wear.domain.model

/**
 * Supported snooze intervals matching the phone companion's SnoozePreset union type.
 */
enum class SnoozePreset(val wireValue: String) {
    FIFTEEN_MINUTES("15m"),
    ONE_HOUR("1h"),
    THIS_EVENING("evening"),
    TOMORROW_MORNING("tomorrow_morning"),
    WEEKEND("weekend"),
    CUSTOM("custom");

    companion object {
        fun fromWireValue(value: String): SnoozePreset =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) }
                ?: throw IllegalArgumentException("Unknown snooze preset wire value: '$value'")

        fun fromWireValueOrDefault(value: String, default: SnoozePreset = FIFTEEN_MINUTES): SnoozePreset =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) } ?: default
    }
}
