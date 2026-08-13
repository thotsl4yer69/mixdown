# Building Mixdown

Mixdown is an **Android-first software prototype** built with Expo/React Native plus a custom Kotlin/Media3 module. This guide separates mobile-client configuration from server-side ingestion credentials so secrets are not accidentally compiled into APKs.

See [`SECURITY.md`](SECURITY.md) before configuring any provider credentials.

## 1. Prerequisites

- Node.js 20+
- npm
- JDK 17 + Android SDK for local Android builds
- a Supabase project for the current backend/data path
- Supabase CLI only when deploying migrations/functions

```bash
npm install
```

## 2. Mobile-client configuration

The mobile application only needs client-safe Supabase configuration:

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-public-key>
# or
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Optional:

```dotenv
EAS_PROJECT_ID=<expo-project-id>
```

`app.config.js` reads these values and exposes them to the app. Anything exposed to an Android application must be treated as public/extractable.

**Never put a Supabase secret/service-role key, database password, OAuth client secret or ingestion-provider credential into the Android build environment.**

## 3. Supabase schema

Link the intended project and apply migrations from a trusted developer/admin environment:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

The migration set contains the application schema, RLS policies, feed/ranking functions and seed data used by the prototype.

A Supabase anon/publishable key is intentionally client-facing. **RLS and server-side database policy are the real authorization boundary.**

## 4. Ingestion credentials stay server-side

External source credentials belong in Supabase Edge Function secrets, not `.env` values injected into the APK.

Depending on which adapters you enable, server-side secrets may include values such as:

```text
REDDIT_CLIENT_ID
REDDIT_CLIENT_SECRET
YOUTUBE_API_KEY
NEWSAPI_KEY
INGEST_SECRET
```

Set them through the Supabase secret mechanism from a trusted admin environment:

```bash
supabase secrets set \
  REDDIT_CLIENT_ID=<value> \
  REDDIT_CLIENT_SECRET=<value> \
  YOUTUBE_API_KEY=<value> \
  NEWSAPI_KEY=<value> \
  INGEST_SECRET=<random-high-entropy-value>
```

Only configure adapters you actually use. Third-party APIs change independently of this repository; check current provider requirements when enabling them.

## 5. Deploy ingestion

```bash
supabase functions deploy ingest --no-verify-jwt
```

The current ingestion design can use a server-held `INGEST_SECRET` for its scheduled trigger. Treat that as server-to-server configuration and do not include it in the mobile client.

If you schedule ingestion with `pg_cron`/`pg_net`, keep the trigger secret in an appropriate server/database secret path rather than publishing it in source.

## 6. Local Android development

The custom Media3 module means Expo Go is not sufficient for the full Android build.

```bash
npx expo prebuild --platform android
npx expo run:android
```

For a local development `.env`, use only client-safe app configuration unless the command being run is explicitly a trusted server/admin command.

## 7. Local release-style APK build

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

Output is normally under:

```text
android/app/build/outputs/apk/release/
```

A release-style Gradle task does not by itself prove production release readiness or establish a trusted signing identity.

## 8. GitHub Actions

`.github/workflows/android-build.yml` performs:

1. dependency installation;
2. TypeScript typecheck;
3. Expo Android prebuild;
4. Gradle APK assembly;
5. artifact upload.

The workflow now accepts only these client-safe/application configuration values from GitHub Actions Secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
- optional `EAS_PROJECT_ID`

It intentionally does **not** receive provider API secrets, Supabase secret/service-role credentials, database passwords or OAuth client secrets.

If the Supabase client configuration is absent, compile verification may still succeed, but the resulting artifact will not have a usable connected backend configuration.

## 9. Signing

For trusted distribution, create and protect a dedicated Android signing identity outside the repository. Do not commit keystores or encoded keystores.

The current workflow should be treated as prototype build automation until a deliberate signing/release process is added and tested.

## 10. Security incident note

An older public Android workflow committed multiple live-looking service credentials directly in YAML. Those values were removed on 2026-08-13.

Because Git history retains old revisions, all non-public credentials from that historical block must be **revoked/rotated at their providers**. Removing them from `main` is not sufficient.

See [`SECURITY.md`](SECURITY.md) for the provider categories requiring review.

## 11. Distribution/content policy

Mixdown contains configurable content-source features, including mature-content modes. Distribution eligibility depends on the exact build and the **current** rules of the chosen platform/store. Check those rules at release time instead of relying on a permanent policy claim in repository documentation.

## Evidence boundary

A successful local/CI APK build proves that the software can compile under the tested environment. It does not prove:

- production backend security or capacity;
- recommendation quality;
- long-term compatibility with external APIs;
- store approval;
- trusted release signing;
- current third-party provider availability.
