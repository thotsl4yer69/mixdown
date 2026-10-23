# Mixdown Native — Release Gate

This checklist applies to the Kotlin/Compose app in `native-android/`. Do not publish or distribute an APK as a finished release until all P0 gates have evidence attached to the release commit.

## P0: content and ingestion
- [ ] Confirm the active scheduler, last successful run and error logs for each ingestion function. Deployed functions alone are not proof of recurring ingestion.
- [ ] Record source health, new rows in 24h/7d, latest ingestion timestamp, and safe playable video/article/social counts.
- [ ] Validate representative source URLs and media URLs; exclude invalid media from autoplay rather than trapping the user in a broken player.
- [ ] Test pagination and refresh when all three pools fail, when only one pool fails, and when the user has already seen most results.
- [ ] Verify source licence, attribution and external-link behaviour.

## P0: native Android
- [ ] Run unit tests, lint, debug build, and an Android emulator installed-app smoke suite against the exact candidate commit.
- [ ] Test cold start 20/20, 30-minute scrolling, player lifecycle, audio focus, background/resume, offline reading, settings persistence and cache eviction.
- [ ] Capture first-frame latency, buffering and memory usage on low/mid-range hardware; investigate regressions.
- [ ] Test empty, loading, permission-denied, stale-feed, offline and rate-limited UI states.
- [ ] Produce a release-signed APK with certificate fingerprint, SHA-256 checksum, version code and provenance manifest. Debug APK is not a final release.

## P0: data security and privacy
- [ ] Audit RLS for public feed, seen history, preferences and telemetry; prevent cross-user reads and writes.
- [ ] Verify no service-role key is present in app or build logs; publishable key only.
- [ ] Document opt-in telemetry, retention, deletion, mature-content isolation and provider content policies.

## P1: product polish
- [ ] Refine native design tokens, swipe transitions, reader typography and accessibility contrast.
- [ ] Add meaningful feed tuning, save/share, source controls, content diversity and immediate repeat suppression.
- [ ] Instrument recommendation quality before monetisation: playable starts, skips, saves, dwell, repeats, crashes and daily retention.

## Release decision
PASS requires recorded evidence for every P0 gate. A passing compile or existing large database does not imply ingestion reliability, playable content or real-device acceptance. Preserve the current working branch until the candidate passes.
