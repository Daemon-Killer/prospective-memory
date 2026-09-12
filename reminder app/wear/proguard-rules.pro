# Room SQLite Persistence Rules
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao interface * { *; }
-dontwarn androidx.room.paging.**

# Play Services Wearable
-keep class com.google.android.gms.wearable.** { *; }

# ProtoLayout & Tiles
-keep class androidx.wear.protolayout.** { *; }
-keep class androidx.wear.tiles.** { *; }
