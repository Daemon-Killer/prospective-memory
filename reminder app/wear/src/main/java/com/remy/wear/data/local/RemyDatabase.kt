package com.remy.wear.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Local SQLite database for Remy Reminders on Wear OS 5.
 *
 * Provides standalone data storage for offline reminder management,
 * glanceable surface queries, and Bluetooth synchronization.
 */
@Database(
    entities = [ReminderEntity::class],
    version = 2,
    exportSchema = false
)
abstract class RemyDatabase : RoomDatabase() {

    abstract fun reminderDao(): ReminderDao

    companion object {
        private const val DATABASE_NAME = "remy_reminders.db"

        @Volatile
        private var INSTANCE: RemyDatabase? = null

        fun getDatabase(context: Context): RemyDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    RemyDatabase::class.java,
                    DATABASE_NAME
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }

        /**
         * Factory method for building an in-memory database for unit testing.
         */
        fun buildInMemory(context: Context): RemyDatabase {
            return Room.inMemoryDatabaseBuilder(
                context.applicationContext,
                RemyDatabase::class.java
            )
                .allowMainThreadQueries()
                .build()
        }
    }
}
