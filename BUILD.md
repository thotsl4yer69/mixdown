# Building mixdown

Distribution note up front: this app supports an NSFW mode, which puts it
permanently outside Google Play's content policy. Every path below produces
a sideloadable APK, never a Play submission.

## Fast path

Steps 1–3 below (Supabase project, credentials, ingestion deploy + cron) are
almost entirely mechanical once you have the account values. `setup.sh`
does all of it in one run:

```bash
cp .env.example .env    # fill in every value — see the file for where each comes from
./setup.sh
```

What it can't do: create the Supabase project, the Reddit OAuth app, or the
Google Cloud API key — each of those needs an authenticated browser session
on that site. You still do that part once, by hand. Everything after — link,
push migrations, set secrets, deploy, schedule cron, trigger a first poll —
is what the script replaces.

The step-by-step version below is what `setup.sh` runs, spelled out — read
it if the script fails partway and you need to resume manually, or if you
want to understand what each piece is actually doing before running it.

---

## 0. Prerequisites

- Node.js 20+, and a package manager (`npm` is assumed below)
- A Supabase account (free tier)
- JDK 17 and the Android SDK (only needed for **local** builds — skip if
  you're using EAS Build, which builds in the cloud)
- `npm install -g eas-cli` if using EAS

```bash
cd mixdown
npm install
```

---

## 1. Supabase project

1. Create a project at supabase.com — note the **Project URL** and either the
   **anon public key** or newer **publishable key** (Project Settings → API).
2. Install the Supabase CLI and link it:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

3. Run the migrations (schema, seed data, RLS):

```bash
supabase db push
```

This creates every table, the `get_feed` / `absorb_taste` / `due_sources`
functions, and seeds the default topic buckets and source list from
`supabase/migrations/0002_seed.sql`. Nothing here is your final config — it's
the starting point you'll edit from the app's Settings screen.

4. Confirm `pgvector` is enabled (the migration does this, but double-check
   under Database → Extensions if `db push` reports an error — some Supabase
   plans require enabling extensions from the dashboard first).

---

## 2. Ingestion credentials

### Reddit (OAuth app, required)

1. Go to https://www.reddit.com/prefs/apps → **create another app**.
2. Type: **script**. Redirect URI: `https://localhost` (unused, but required
   by the form).
3. Note the client ID (under the app name) and client secret.

The default seed sources use application-only auth, which **cannot** read
`over_18` content — this is a Reddit platform restriction, not a choice made
here. If you add NSFW subreddits later, switch to the password grant (see
the comment in `supabase/functions/ingest/adapters/reddit.ts`) using an
account that has enabled "show me adult content" in its own Reddit
preferences, and set `REDDIT_GRANT=password` plus `REDDIT_USERNAME` /
`REDDIT_PASSWORD` below.

### YouTube (Data API key, required for the youtube-kind sources)

1. In Google Cloud Console, create a project (or reuse one), enable
   **YouTube Data API v3**.
2. Credentials → Create Credentials → API key. Restrict it to the YouTube
   Data API v3.

### Set the secrets on the Edge Function

```bash
supabase secrets set \
  REDDIT_CLIENT_ID=xxx \
  REDDIT_CLIENT_SECRET=xxx \
  YOUTUBE_API_KEY=xxx \
  NEWSAPI_KEY=xxx \
  INGEST_SECRET=$(openssl rand -hex 24)
```

`INGEST_SECRET` is a shared secret the cron job sends as an `x-ingest-secret`
header — it stops random internet traffic from triggering your ingestion
function and burning your API quotas.

`NEWSAPI_KEY` is optional. Only set it if you want to add `newsapi` story
sources.

---

## 3. Deploy the ingestion function

```bash
supabase functions deploy ingest --no-verify-jwt
```

`--no-verify-jwt` because the cron trigger calls this with the shared secret
above, not a user session.

### Schedule it

Supabase's pg_cron + pg_net combo is the free-tier-friendly way to do this
entirely inside Postgres. In the SQL editor:

```sql
select cron.schedule(
  'mixdown-ingest',
  '*/15 * * * *',  -- every 15 minutes; due_sources() only returns what's actually due
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', '<the INGEST_SECRET you set above>'
    )
  );
  $$
);
```

(Enable the `pg_cron` and `pg_net` extensions first if prompted — Database →
Extensions.)

Verify it's working:

```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/ingest \
  -H "x-ingest-secret: <your INGEST_SECRET>"
```

You should get back a JSON report with one line per source polled. Check
`sources.last_error` in the table editor if any show an error.

---

## 4. Configure the app

Copy `.env.example` to `.env` and fill in at least:

```bash
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your anon public key>
# or
SUPABASE_PUBLISHABLE_KEY=<your newer Supabase publishable key>
```

`app.config.js` reads those values automatically for local builds, and GitHub
Actions can provide the same values with repository secrets.

Reconcile dependency versions against your installed Expo SDK (pinned
versions in `package.json` may have moved on since this was written):

```bash
npx expo install --fix
```

---

## 5. Run it in development

The custom Media3 native module means **Expo Go will not work** — this
project requires a development build from the first run.

```bash
npx expo prebuild --platform android
npx expo run:android
```

`prebuild` generates the `android/` directory and links `modules/media3-feed`
via Expo's autolinking (declared through `expo-module.config.json`).
`run:android` builds and installs a debug build onto a connected device or
emulator with Metro attached.

---

## 6. Build a release APK

### Option A — EAS Build (cloud, no local Android SDK needed)

```bash
eas login
eas build:configure          # writes your project ID into app.json/eas.json
eas build --platform android --profile preview
```

This produces a directly-installable APK (see `eas.json` — the `preview`
profile sets `buildType: apk`, not the Play-oriented `app-bundle`). EAS gives
you a download link and QR code when it finishes.

### Option B — Local Gradle build

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

Output lands at `android/app/build/outputs/apk/release/app-release.apk`.

## 7. Build in GitHub Actions

This repo includes `/home/runner/work/mixdown/mixdown/.github/workflows/android-build.yml`
to typecheck, prebuild Android, assemble a release APK, and upload it as a
workflow artifact.

It now also runs on published GitHub releases (and `v*` tags) and attaches
the APK directly to the release page as a downloadable asset.

To make the artifact immediately runnable against your backend, add these
repository secrets before running the workflow:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (optional alternative to `SUPABASE_ANON_KEY`)
- `EAS_PROJECT_ID` (optional, only for EAS-linked builds later)

### Adding NewsAPI story sources

If you set `NEWSAPI_KEY` as an Edge Function secret, you can add `newsapi`
sources from Settings with config JSON like:

```json
{"endpoint":"everything","q":"technology","language":"en","sortBy":"publishedAt"}
```

or:

```json
{"endpoint":"top-headlines","country":"us","category":"technology"}
```

If those secrets are omitted, the workflow still builds an APK, but the app
will stop at startup until valid Supabase values are supplied.

### Triggering and downloading

- Push a tag like `v1.0.0` to run the APK build and upload a workflow artifact.
- Publish a GitHub Release to run the same build and attach the APK asset to
  `https://github.com/thotsl4yer69/mixdown/releases`.
- Artifact/asset filename comes from Gradle output at:
  `android/app/build/outputs/apk/release/app-release.apk`

For a real release you'll want to sign it with your own keystore rather than
the debug key `assembleRelease` falls back to:

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore mixdown-release.keystore -alias mixdown \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then wire the keystore into `android/app/build.gradle` under
`signingConfigs.release` (standard React Native/Expo release-signing setup —
see the *"Generate an upload key"* section of Android's own docs, since the
exact Gradle block format shifts between Android Gradle Plugin versions and
is worth checking against whatever AGP version `expo prebuild` generated).

### Install it

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## 7. Updates without a new APK

Expo Updates can push JS-only changes (ranking tweaks, UI changes) without a
rebuild — but since Play is off the table, point it at your own hosting
rather than EAS's default update service, or just re-run step 6 when you
change anything. For a single-user app, re-building is usually simpler than
standing up OTA infrastructure; mentioned here so you know the option
exists if the ingestion/ranking logic starts changing often.

---

## What's config, not code

Everything in this list is meant to be changed from the Settings screen or
the Supabase table editor, never by editing source:

- Topic buckets, weights, enabled state — `topic_buckets` table / faders
- Every content source and its poll interval — `sources` table / in-app form
- NSFW mode, ranker drift, autoplay, page size, prefetch depth — `prefs` table
- Ranking math constants (similarity/recency/explore weights, half-life) —
  also `prefs`, read by `get_feed()`

If you find yourself editing a `.ts` file to add a subreddit, something's
wrong — file an issue against yourself.
