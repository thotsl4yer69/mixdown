# mixdown

A personal, multimodal, infinite-scroll feed — video, articles, and Reddit
threads in one paged swipe, ranked by a bandit you can steer with real
sliders. Android only, sideloaded APK only (see "Distribution" below).

Build instructions: **[BUILD.md](./BUILD.md)**. This file is a map of the
repo, not a tutorial. Expo reads runtime config from `/home/runner/work/mixdown/mixdown/.env`
through `app.config.js`, and the same variables can be injected from GitHub
Actions secrets for CI builds.

Use Node 20 (`/home/runner/work/mixdown/mixdown/.nvmrc`) for local and CI builds.

## Layout

```
app/                      Expo Router screens
  _layout.tsx              Root: fonts, gesture root, telemetry sync
  index.tsx                 The feed itself
  reader/[id].tsx           Full article/thread reader
  settings/index.tsx        Faders, NSFW toggle, source management

src/
  theme/tokens.ts           Design tokens — the only place colours/type live
  components/               Cards (video/article/social), Fader, badges
  lib/
    supabase.ts              Client singleton
    types.ts                 Shared types mirroring the schema
    queue.ts                 Feed pagination + prefs
    bandit.ts                Thompson sampling over topic buckets
    db.ts                    SQLite write-ahead telemetry buffer + sync

modules/media3-feed/        Custom Expo Module (Kotlin + Media3)
  android/.../PreloadController.kt   Fixed decoder pool + byte-ahead prefetch
  android/.../Media3FeedView.kt      The one persistent SurfaceView
  android/.../MediaCache.kt          Disk cache + decoder-instance probe
  src/index.ts               TS bridge to JS

supabase/
  migrations/                Schema, seed data, RLS — run via `supabase db push`
  functions/ingest/          Edge Function: polls sources, embeds, upserts
    adapters/                One file per source kind (rss/peertube/reddit/youtube)
```

## The two ideas that shape everything else

**One surface, not a pool of surfaces.** In a paged feed exactly one item is
ever visible. So there's exactly one `SurfaceView`, absolutely positioned and
tracked by a Reanimated worklet — never mounted or unmounted during a scroll.
What *is* pooled (3–4 instances) is warm `MediaCodec` decoders, prepared with
no surface attached. Attaching an already-prepared player's surface on settle
is what makes playback feel instant; see `PreloadController.kt`.

**Nothing about your taste lives in code.** Sources, topic buckets and their
weights, the NSFW toggle, ranker drift, prefetch depth — all rows in
Postgres, all editable from Settings. If a change requires editing a `.ts`
file, that's a bug in this build.

## Distribution

NSFW mode is a first-class, isolated feature (see `supabase/migrations/0003_rls.sql`
and Settings → NSFW mode), which puts this app permanently outside Google
Play's content policy. It's built for sideloading — `BUILD.md` never produces
an `.aab`, only `.apk`.

## What's genuinely out of scope

- iOS. The native module is Android-only; `expo-module.config.json` declares
  `"platforms": ["android"]` on purpose.
- Generated Supabase `Database` types. The client casts a couple of joined
  queries at a well-contained boundary instead (see the comment in
  `app/reader/[id].tsx`). Running `supabase gen types typescript` and wiring
  it into `src/lib/supabase.ts` would remove those casts — worth doing if
  the schema starts changing often.
- Any content ingestion path that isn't RSS, PeerTube's REST API, the
  official YouTube Data API, or Reddit's OAuth API. See the note in the
  project's chat history if you're wondering why TikTok/Reels aren't here.
