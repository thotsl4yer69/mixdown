# Security Policy — Mixdown

**Reviewed:** 2026-08-13  
**Project maturity:** Software prototype

## 2026-08-13 credential incident

During the account-wide GitHub cleanup, the public Android build workflow was found to contain multiple hard-coded live-looking credentials.

The current workflow has been rewritten so the Android client receives only the configuration that `app.config.js` is designed to expose:

- Supabase project URL;
- Supabase anon/publishable client key;
- optional EAS project ID.

The removed hard-coded values included privileged or potentially billable credentials for Supabase and multiple third-party ingestion/content providers, plus a TikTok client secret. Because those values existed in a public repository's Git history, **every non-public credential from that historical workflow must be treated as compromised and revoked/rotated at its issuing provider**.

Do not restore historical values from Git.

## Client/server boundary

A mobile APK is a public client. Anything shipped in it must be treated as extractable.

### Client-safe configuration

The application may contain:

- Supabase URL;
- Supabase anon/publishable key;
- EAS project identifier;
- other identifiers explicitly designed by their provider to be public-client values.

The Supabase anon/publishable key is **not** the authorization boundary. Row Level Security and server-side policies must enforce data access.

### Server-only secrets

Never compile or inject into the Android application/workflow:

- Supabase secret/service-role keys;
- Supabase account/access tokens;
- database passwords;
- Reddit client secrets/passwords;
- ingestion trigger secrets;
- NewsAPI or other billable/provider API keys unless the provider explicitly designs them for untrusted public clients;
- Apify/aggregator/content-provider secrets;
- TikTok client secrets;
- private OAuth client secrets;
- signing/private keys.

Ingestion/provider credentials belong in Supabase Edge Function secrets or another server-side secret store.

## CI

`.github/workflows/android-build.yml` now builds with only client-safe Supabase/EAS configuration from repository secrets. It does not generate an `.env` file containing privileged service credentials.

A successful build with missing Supabase client configuration is useful as compile verification but does not mean the resulting APK is connected to a working backend.

## Required credential rotations

Review the historical workflow and rotate/revoke every non-public credential that appeared there. At minimum, check the issuing dashboards for:

- Supabase privileged/secret key;
- APITube;
- SearchCans;
- SociaVault;
- Apify;
- Opus API;
- Zernio;
- TikTok client secret;
- TikHub;
- NewsAPI;
- any other provider key from the same historical block that can authorize requests or consume quota/billing.

A value labelled `public`, `publishable`, project URL, client ID or JWKS URL may be intentionally public; verify provider semantics rather than rotating indiscriminately.

## If a secret reaches Git

1. revoke/rotate it at the provider;
2. remove it from the current tree;
3. inspect workflows, releases and build artifacts for copies;
4. update CI to use the correct trust boundary;
5. consider history rewriting for hygiene only after revocation;
6. review provider usage/billing logs where available.

History rewriting does not revoke an already exposed secret.
