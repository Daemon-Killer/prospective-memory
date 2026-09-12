plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun pmemProp(key: String, fallback: String = ""): String {
    val file = rootProject.file("local.properties")
    if (!file.exists()) return fallback
    val prefix = "$key="
    return file.readLines()
        .firstOrNull { it.startsWith(prefix) }
        ?.substringAfter(prefix)
        ?.trim()
        ?: fallback
}

android {
    namespace = "com.prospectivememory.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prospectivememory.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "0.7.0-jarvis"
        val hostedUrl = pmemProp("pmem.url", "https://prospective-memory-production.up.railway.app")
        val hostedToken = pmemProp("pmem.token")
        buildConfigField("String", "PMEM_URL", "\"${hostedUrl.replace("\"", "\\\"")}\"")
        buildConfigField("String", "PMEM_TOKEN", "\"${hostedToken.replace("\"", "\\\"")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Optional handwriting test (delete with app/.../ink/ — see ink/REMOVE.txt)
    implementation("com.google.mlkit:digital-ink-recognition:19.0.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
