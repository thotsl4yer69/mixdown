# Mixdown Native — daily scrolling Android app

Native Kotlin + Jetpack Compose rewrite. Does not use Expo, React Native, or JavaScript.
Connects to the existing live Supabase project using the publishable client key; no privileged key is embedded.

## Features
- Full-screen vertical swipe feed; native Media3 playback of MP4/HLS with a single shared player.
- Real article/social reading, visible source links, cached feed when offline.
- Video, social and article pools fetched separately so the feed never degenerates to an articles-only wall.
- Client-side seen tracking applied when a page is actually displayed, rather than on backend retrieval.
- Persisted topic weights, auto-muted mode and safe/NSFW pool isolation; source-side NSFW filtering.
- Pull an updated mix with Refresh; prefetch additional items before the end of the queue.
- Visible errors and retry, no fake cards, no runtime credential entry or dummy URLs.

The included publishable Supabase API key is **public client configuration**, never a service-role/secret key. Its privileges are limited by the live database's RLS policies. Production multiuser support requires account-scoped preferences and stronger policies.

## Build
On a JDK 17/Android SDK 35 machine with Gradle 8.10.2:
  gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
APK: app/build/outputs/apk/debug/app-debug.apk

See the **Mixdown Native Android** GitHub Actions workflow for reproducible builds. Build success does not replace physical-device video/audio testing.


## Beta identity and evidence

Current source version: 2.5.0 (20005). Debug builds install as `au.com.mazlabz.mixdown.beta25`, labelled **Mixdown 2.5 Beta**. They are test builds with CI debug signing, not the stable production identity. A new CI key may conflict with an already installed beta; do not delete local saves just to resolve it without choosing to do so.

The native build artifact contains the APK, SHA-256, signer report, package metadata and source SHA. The installed-app smoke artifact contains real discovery/saved-library/Stories screenshots, a short screen recording and a machine-readable evidence manifest. These describe the exact CI run and its live content, not guaranteed content availability later.
