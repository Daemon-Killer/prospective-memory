package com.remy.wear.domain.model

/**
 * Bluetooth P2P replication state for offline-first synchronization.
 */
enum class SyncStatus(val wireValue: String) {
    SYNCED("SYNCED"),
    PENDING_UPLOAD("PENDING_UPLOAD"),
    CONFLICT("CONFLICT");

    companion object {
        fun fromWireValue(value: String): SyncStatus =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) }
                ?: throw IllegalArgumentException("Unknown sync status wire value: '$value'")

        fun fromWireValueOrDefault(value: String, default: SyncStatus = SYNCED): SyncStatus =
            entries.firstOrNull { it.wireValue.equals(value, ignoreCase = true) } ?: default
    }
}
