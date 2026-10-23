-- Keep the native Android feed fast as source ingestion grows.
-- Applied to the existing Mixdown Supabase project on 24 October 2026.
-- The native app queries recent items by (is_nsfw, kind, ingested_at).
-- Older indexes sort by published_at, forcing a sort of large partitions.
-- This additive index is safe to reapply and preserves all existing rows.
create index if not exists items_native_feed_idx
  on public.items (is_nsfw, kind, ingested_at desc);
analyze public.items;
