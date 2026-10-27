-- Mixdown v2.3: English-first, publisher-and-topic-balanced safe feed.
-- Repeatable source seeds. All URLs were live-checked before enabling.
insert into public.topic_buckets(key,label,lane,weight,sort_order) values
  ('australia','Australia & local','learn',0.8,11),
  ('music','Music & artists','play',0.8,12),
  ('gaming','Gaming & fandom','play',0.8,13),
  ('comedy','Comedy & satire','play',0.8,14)
on conflict (key) do nothing;

insert into public.sources
  (kind,label,config,default_bucket,is_nsfw,enabled,poll_interval_min,max_items_per_poll,consecutive_failures,health_status)
select v.kind,v.label,v.config,v.bucket,false,true,35,20,0,'unknown'
from (values
  ('rss','Guardian Australia','{"url":"https://www.theguardian.com/australia-news/rss","language":"en"}'::jsonb,'australia'),
  ('rss','The Age Australia','{"url":"https://www.theage.com.au/rss/feed.xml","language":"en"}'::jsonb,'australia'),
  ('rss','ABC Australia','{"url":"https://www.abc.net.au/news/feed/1948/rss.xml","language":"en"}'::jsonb,'australia'),
  ('rss','Stereogum','{"url":"https://www.stereogum.com/feed/","language":"en"}'::jsonb,'music'),
  ('rss','Consequence Music','{"url":"https://consequence.net/feed/","language":"en"}'::jsonb,'music'),
  ('rss','Pitchfork','{"url":"https://pitchfork.com/rss/news/","language":"en"}'::jsonb,'music'),
  ('rss','Polygon Gaming & Culture','{"url":"https://www.polygon.com/rss/index.xml","language":"en"}'::jsonb,'gaming'),
  ('rss','PC Gamer','{"url":"https://www.pcgamer.com/rss/","language":"en"}'::jsonb,'gaming'),
  ('rss','The Conversation Australia','{"url":"https://theconversation.com/au/articles.atom","language":"en"}'::jsonb,'australia'),
  ('rss','The Hard Times Satire','{"url":"https://thehardtimes.net/feed/","language":"en"}'::jsonb,'comedy'),
  ('rss','ScienceAlert','{"url":"https://www.sciencealert.com/feed","language":"en"}'::jsonb,'science')
) v(kind,label,config,bucket)
where not exists (select 1 from public.sources s where s.label=v.label);

insert into public.sources
  (kind,label,config,default_bucket,is_nsfw,enabled,poll_interval_min,max_items_per_poll,consecutive_failures,health_status)
select 'mastodon',v.label,v.config,v.bucket,false,true,20,40,0,'unknown'
from (values
  ('English Fediverse Video','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"video","language":"en","video_only":true,"max_age_days":10}'::jsonb,'quick-hits'),
  ('Animation & Motion','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"animation","language":"en","video_only":true,"max_age_days":10}'::jsonb,'visual-culture'),
  ('Gaming Clips','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"gaming","language":"en","video_only":true,"max_age_days":10}'::jsonb,'gaming'),
  ('Comedy Clips','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"funny","language":"en","video_only":true,"max_age_days":10}'::jsonb,'comedy'),
  ('Short Films','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"shortfilm","language":"en","video_only":true,"max_age_days":10}'::jsonb,'visual-culture'),
  ('Music Moments','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"music","language":"en","video_only":false,"max_age_days":10}'::jsonb,'music'),
  ('Creative Community','{"pipeline":"shorts","mode":"tag","instance":"mastodon.social","tag":"art","language":"en","video_only":false,"max_age_days":10}'::jsonb,'visual-culture')
) v(label,config,bucket)
where not exists (select 1 from public.sources s where s.label=v.label);

-- Exclude a predominantly non-English short-video source and a blocked Bluesky feed.
update public.sources set enabled=false,health_status='disabled'
where label in ('PeerTube newest shorts','Framatube short videos','P2Tube short videos','SkyTok video feed');

-- ABC top-stories endpoint currently serves stale October articles despite HTTP 200.
-- Do not burn ingestion slots on it until a verified fresh ABC feed is available.
update public.sources set enabled=false,health_status='disabled'
where label='ABC Australia'
  and not exists (
    select 1 from public.items i
    where i.source_id=public.sources.id
      and i.published_at>now()-interval '10 days'
  );

-- Source categorisation remains independent of video/article format.
update public.sources set default_bucket='australia'
where label in ('ABC Australia','Guardian Australia','The Age Australia','The Conversation Australia');
update public.sources set default_bucket='music'
where label in ('Stereogum','Consequence Music','Pitchfork','Music Moments');
update public.sources set default_bucket='gaming'
where label in ('Polygon Gaming & Culture','PC Gamer','Gaming Clips');
update public.sources set default_bucket='comedy'
where label in ('The Hard Times Satire','Comedy Clips');

update public.items i set bucket=s.default_bucket
from public.sources s where i.source_id=s.id and i.bucket is distinct from s.default_bucket
and s.label in (
'ABC Australia','Guardian Australia','The Age Australia','The Conversation Australia',
'Stereogum','Consequence Music','Pitchfork','Music Moments',
'Polygon Gaming & Culture','PC Gamer','Gaming Clips',
'The Hard Times Satire','Comedy Clips'
);

-- Return fresh, enabled, non-expired posts with fair publisher/topic rotation.
-- Invoker security preserves existing RLS and cannot expose adult rows.
create or replace function public.get_mixed_safe_feed_page(
  p_kind text, p_limit integer default 45, p_offset integer default 0
)
returns setof public.items
language sql stable security invoker set search_path = ''
as $$
  with ranked as (
    select i.id,i.published_at,
      row_number() over (partition by i.bucket order by i.published_at desc,i.id) bucket_turn,
      row_number() over (partition by i.source_id order by i.published_at desc,i.id) source_turn
    from public.items i
    join public.sources s on s.id=i.source_id
    where p_kind in ('video','article','social')
      and i.is_nsfw=false and s.enabled=true and i.kind=p_kind
      and i.published_at >= now() -
        case when p_kind='video' then interval '30 days' else interval '10 days' end
      and i.published_at <= now()+interval '1 day'
      and (i.expires_at is null or i.expires_at>now())
      and (p_kind<>'video' or (i.media_kind in ('mp4','hls')
        and i.media_url like 'https://%'))
  )
  select i.* from ranked r join public.items i on i.id=r.id
  order by r.bucket_turn,r.source_turn,r.published_at desc,i.id
  limit least(greatest(p_limit,1),150) offset greatest(p_offset,0)
$$;
revoke all on function public.get_mixed_safe_feed_page(text,integer,integer) from public;
grant execute on function public.get_mixed_safe_feed_page(text,integer,integer) to anon,authenticated;
