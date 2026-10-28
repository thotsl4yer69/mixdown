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
        versionCode = 20005
        versionName = "2.5.0"
        buildConfigField("String", "SUPABASE_URL", quoted(apiUrl))
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", quoted(publishableKey))
    }
    // Signing material is provided only by the private release workflow.
    // Debug CI builds never require a signing secret.
    val releaseStore = System.getenv("MIXDOWN_RELEASE_KEYSTORE")
    val releaseStorePassword = System.getenv("MIXDOWN_RELEASE_KEYSTORE_PASSWORD")
    val releaseKeyAlias = System.getenv("MIXDOWN_RELEASE_KEY_ALIAS")
    val releaseKeyPassword = System.getenv("MIXDOWN_RELEASE_KEY_PASSWORD")
    val privateSigningConfigured = listOf(
        releaseStore, releaseStorePassword, releaseKeyAlias, releaseKeyPassword
    ).all { !it.isNullOrBlank() }
    if (privateSigningConfigured) {
        signingConfigs {
            create("privateRelease") {
                storeFile = file(checkNotNull(releaseStore))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    buildTypes {
        debug {
            // CI debug keystores are ephemeral; install the new user-test build
            // beside earlier installations rather than forcing an uninstall and losing local saves.
            applicationIdSuffix = ".beta25"
            versionNameSuffix = "-beta"
            resValue("string", "mixdown_app_name", "Mixdown 2.5 Beta")
        }
        release {
            isMinifyEnabled = false
            resValue("string", "mixdown_app_name", "Mixdown")
            if (privateSigningConfigured) signingConfig = signingConfigs.getByName("privateRelease")
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
