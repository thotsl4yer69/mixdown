-- Native Mixdown 2.2 reads only public.items. All personal preferences,
-- seen history and ranking state now stay on-device, not in a shared anon table.
-- Existing legacy Expo clients relying on shared anonymous cloud state are
-- deliberately no longer supported by this release migration.
begin;

drop policy if exists anon_all on public.interactions;
drop policy if exists anon_all on public.seen;
drop policy if exists anon_all on public.seen_history;
drop policy if exists anon_all on public.prefs;
drop policy if exists anon_all on public.taste_vector;
drop policy if exists anon_all on public.bandit_state;

revoke all privileges on table
  public.interactions, public.seen, public.seen_history,
  public.prefs, public.taste_vector, public.bandit_state
from anon, authenticated;

-- Public feed metadata can be read, but never edited, with a client key.
drop policy if exists anon_all on public.sources;
drop policy if exists anon_all on public.topic_buckets;
drop policy if exists public_sources_read on public.sources;
drop policy if exists public_topic_buckets_read on public.topic_buckets;
create policy public_sources_read on public.sources
  for select to anon, authenticated using (true);
create policy public_topic_buckets_read on public.topic_buckets
  for select to anon, authenticated using (true);
revoke all privileges on public.sources, public.topic_buckets from anon, authenticated;
grant select on public.sources, public.topic_buckets to anon, authenticated;

-- Legacy shared taste mutations must not remain callable through PostgREST.
revoke execute on function public.absorb_taste(uuid, real)
  from PUBLIC, anon, authenticated;

-- Preserve the native Android app's published content path unchanged.
-- public.items keeps its existing read-only RLS policy.
commit;
