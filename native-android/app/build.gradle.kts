import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val runtimeConfig = Properties().apply {
    val file = rootProject.file("mixdown.properties")
    check(file.isFile) { "Missing runtime configuration: mixdown.properties" }
    file.inputStream().use { load(it) }
}
val apiUrl = runtimeConfig.getProperty("url", "")
val publishableKey = runtimeConfig.getProperty("publishableKey", "")
check(apiUrl.startsWith("https://") && publishableKey.startsWith("sb_publishable_")) {
    "Invalid Supabase URL or publishable key"
}
fun quoted(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "au.com.mazlabz.mixdown"
    compileSdk = 35
    defaultConfig {
        applicationId = "au.com.mazlabz.mixdown"
        minSdk = 26
        targetSdk = 35
        versionCode = 20000
        versionName = "2.0.0-native"
        buildConfigField("String", "SUPABASE_URL", quoted(apiUrl))
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", quoted(publishableKey))
    }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
}
