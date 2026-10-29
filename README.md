# Mixdown

Mixdown 2.5 is an Android feed prototype for browsing videos and stories, saving reading and adjusting the mix to your interests.

## Current app

The maintained app is **native Kotlin / Jetpack Compose** in [`native-android/`](native-android/). It uses Media3 playback and the live Supabase feed. The Expo application and `modules/media3-feed/` are earlier experiments retained for reference; they are not the current 2.5 beta build path.

Start with [native build instructions](native-android/README.md) and the [release gate](native-android/RELEASE_GATE.md). The Mixdown Native Android workflow builds the current beta, runs unit tests and lint, and exports its digest, package metadata, signing certificate and exact source commit. The emulator workflow tests live discovery, bookmark persistence and Stories and records actual screenshots/video.

## What the beta does

- Browse a general feed, Watch and Stories.
- Save items to a local library and retain saved reading after restart.
- Adjust topic preferences and request more or less similar content.
- Open original sources, with full publication dates shown on cards.
- Keep adult content in a separate opt-in pool; cold launch opens the general feed.

## Download and release status

Development APKs are GitHub Actions artifacts, not a paid public release. The debug beta uses package `au.com.mazlabz.mixdown.beta25` and version `2.5.0-beta`. It can coexist with the regular app, but repeated CI builds may use different debug certificates. A signature-conflict install is not an upgrade: uninstalling a prior beta deletes its local data.

There is no verified public Mixdown checkout/download journey linked from this repository. Do not promise immediate paid delivery or a production release until stable signing, delivery and the release gates have been demonstrated.

## Evidence limits

Automated builds and emulator checks do not establish sustained phone performance, audio quality, external provider reliability, content licensing or production multiuser isolation. See the release checklist for the outstanding acceptance work. Ranking behaviour is an experiment, not a measured claim of superior recommendations.

MAZLABZ product development uses AI coding assistance. Product decisions, integration and final acceptance remain the owner's responsibility.
