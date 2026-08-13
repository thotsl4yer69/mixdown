# Mixdown

**Android-first multimodal feed prototype combining media playback, configurable sources and adaptive ranking.**

[![Status](https://img.shields.io/badge/status-software%20prototype-blue)](PROJECT_STATUS.md)
![Mobile](https://img.shields.io/badge/mobile-Expo%20%2B%20Android-blue)
![Native](https://img.shields.io/badge/native-Kotlin%20%2B%20Media3-green)

> **Maturity: Software prototype.** Mixdown explores consumer-feed architecture, native Android media performance and configurable ranking. Recommendation quality, ingestion reliability and deployment scale should be demonstrated with tests rather than inferred from the architecture.

## What it is

Mixdown is a personal multimodal feed experiment that brings different content types into one paged/swipe interface and lets the user influence ranking preferences directly.

The engineering challenge is broader than the UI: a JavaScript/Expo application coordinates with a custom native Android Media3 module, local telemetry buffering and a Supabase-backed ingestion/ranking data layer.

## Repository map

```text
app/
  Expo Router screens
  feed / reader / settings

src/
  theme and UI components
  Supabase client/data types
  feed queue/preferences
  Thompson-sampling ranker
  SQLite telemetry buffer + sync

modules/media3-feed/
  custom Expo/Kotlin module
  Media3 playback/preload/cache work

supabase/
  migrations / RLS / seed data
  ingestion Edge Function
  source adapters
```

See [BUILD.md](BUILD.md) for the build workflow rather than relying on machine-specific CI paths.

## Two architecture ideas

### One visible media surface

A vertically paged feed normally displays one active media item at a time. Mixdown experiments with keeping a persistent Android media surface while preparing a small set of player/decoder resources around it, instead of repeatedly creating/destroying the complete view path during scroll transitions.

The implementation lives primarily in the custom Media3 module and should be evaluated with device profiling rather than assumed to eliminate every playback hitch.

### Preferences live in data

Sources, topic/ranking preferences and product settings are designed to be data/configuration rather than scattered constants in UI code. This makes it possible to change behaviour through application state/settings and backend data without recompiling every preference adjustment.

## Data / ranking layer

The project explores:

- configurable content-source adapters;
- Postgres/Supabase-backed application data;
- RLS policy work;
- local SQLite write-ahead telemetry buffering;
- synchronisation of local events;
- Thompson-sampling/bandit-style ranking over topic buckets;
- user-adjustable preference controls.

The use of a bandit algorithm is an implementation choice, not evidence that the resulting feed is objectively better or more engaging. Ranking quality needs real evaluation data.

## Android media layer

The custom Expo module is Android-specific and uses Kotlin/Media3 for playback-oriented work that is awkward to express purely in the React Native/Expo layer.

That gives the repository useful evidence of crossing a framework boundary:

```text
TypeScript / Expo UI
        │
        ▼
 Expo module bridge
        │
        ▼
 Kotlin / Media3
        │
        ▼
 Android playback primitives
```

## Content and distribution boundary

The project includes user-controlled source/content settings, including support for content categories that may make some distribution channels unsuitable depending on the current store/platform rules and the exact build configuration.

The repository therefore focuses on development/sideloadable Android builds rather than making a permanent claim about any store's policies. Distribution requirements should be checked against current platform rules at release time.

## Build

Use the instructions in [BUILD.md](BUILD.md). Runtime configuration should come from local environment/configuration or CI secrets and must not be committed as live credentials.

The current architecture is Android-first. The native Media3 module means iOS support would require separate implementation work rather than a simple build switch.

## Evidence boundary

Mixdown is a product/engineering prototype. It does not yet prove:

- recommendation quality at scale;
- ingestion reliability across all external providers;
- sustained playback performance across Android hardware;
- production backend capacity;
- long-term schema compatibility with external APIs;
- public-store release readiness.

## Development provenance

Mixdown is an authored MAZLABZ project developed with AI coding agents as part of the engineering workflow. AI supports implementation, research, refactoring and testing; product definition, architecture, integration, debugging and acceptance remain the project owner's responsibility.

## Portfolio significance

Mixdown is useful because it spans layers that are often kept separate:

**Expo/React Native · Kotlin · Media3 · Supabase/Postgres · SQLite · ranking systems · mobile product architecture**
