-- Diversify Mixdown's mature-video lane without requiring paid Apify actors.
-- These use public provider APIs through ingest-shorts; no media is rehosted.
-- The NSFW toggle still controls app visibility.
insert into public.sources
  (kind, label, config, default_bucket, is_nsfw, enabled,
   poll_interval_min, max_items_per_poll, health_status)
select
  v.kind, v.label, v.config::jsonb, 'entertainment', true, true,
  20, v.max_items, 'unknown'
from (values
  ('bluesky', 'NSFW verified creator videos',
    '{"pipeline":"shorts","feed":"at://did:plc:f3vidph7pwounzpikz64oiiu/app.bsky.feed.generator/aaant4zk2kv3i","adult_labels_only":true,"video_only":true}', 60),
  ('mastodon', 'Thicc.Horse adult video posts',
    '{"pipeline":"shorts","instance":"thicc.horse","mode":"public","local":true,"sensitive_only":true,"video_only":true}', 40),
  ('mastodon', 'Mastobate adult video posts',
    '{"pipeline":"shorts","instance":"mastobate.social","mode":"public","local":true,"sensitive_only":true,"video_only":true}', 40)
) as v(kind, label, config, max_items)
where not exists (
  select 1 from public.sources s where s.label = v.label
);

-- Return videos in source-round-robin order, not raw global recency.
-- This avoids RedGIFs filling a whole page when other sources have fewer clips.
-- Explicit SECURITY INVOKER retains source items' existing RLS boundaries.
create or replace function public.get_mixed_nsfw_video_page(
  p_limit integer default 45,
  p_offset integer default 0
)
returns setof public.items
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select i.id, i.published_at,
      row_number() over (
        partition by i.source_id
        order by i.published_at desc, i.id
      ) as source_turn
    from public.items i
    where i.is_nsfw = true
      and i.kind = 'video'
      and i.media_kind in ('mp4', 'hls')
      and i.media_url like 'https://%'
      and i.published_at >= now() - interval '30 days'
      and i.published_at <= now() + interval '1 day'
      and (i.expires_at is null or i.expires_at > now())
  )
  select i.*
  from ranked r
  join public.items i on i.id = r.id
  order by r.source_turn, r.published_at desc, i.id
  limit least(greatest(p_limit,1),150)
  offset greatest(p_offset,0)
$$;

revoke all on function public.get_mixed_nsfw_video_page(integer,integer) from public;
grant execute on function public.get_mixed_nsfw_video_page(integer,integer)
  to anon, authenticated;
