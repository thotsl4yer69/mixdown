-- Mixdown 2.5: Extend regular-feed defence to explicit publisher domains.
-- Upstream source NSFW flags alone are not reliable for user-generated video.
-- Editorial news articles are intentionally not keyword-censored.
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
      -- Avoid adult-tagged clips/social content even when provider is_nsfw=false.
      and (i.kind='article' or
        (coalesce(i.title,'') || ' ' || coalesce(i.excerpt,'') || ' ' ||
         coalesce(i.bucket,'')) !~*
        '(^|[^[:alpha:]])(nsfw|xxx|porn|pornography|nude|nudity|naked|topless|boob|boobs|nipple|nipples|tit|tits|onlyfans|fetish|erotic|hentai|sex|sexy|sexual|orgasm|masturbation|striptease|adult.only)([^[:alpha:]]|$)'
      )
      and (i.kind='article' or (
        coalesce(i.permalink,'') !~* '^https?://([a-z0-9-]+\.)*(redgifs\.com|pornhub\.com|xvideos\.com|xhamster\.com|spankbang\.com|erome\.com|onlyfans\.com|fansly\.com|rule34\.xxx|chaturbate\.com)([/:?#]|$)'
        and coalesce(i.media_url,'') !~* '^https?://([a-z0-9-]+\.)*(redgifs\.com|pornhub\.com|xvideos\.com|xhamster\.com|spankbang\.com|erome\.com|onlyfans\.com|fansly\.com|rule34\.xxx|chaturbate\.com)([/:?#]|$)'
      ))
  )
  select i.* from ranked r join public.items i on i.id=r.id
  order by r.bucket_turn,r.source_turn,r.published_at desc,i.id
  limit least(greatest(p_limit,1),150) offset greatest(p_offset,0)
$$;
revoke all on function public.get_mixed_safe_feed_page(text,integer,integer) from public;
grant execute on function public.get_mixed_safe_feed_page(text,integer,integer) to anon,authenticated;

-- Known terminal-error feeds are explicitly disabled (they were already
-- excluded by due_sources after eight failures). Keep historical items.
update public.sources
set enabled=false, health_status='disabled'
where consecutive_failures >= 8
  and label in (
    'Mastodon video hashtag', 'Bluesky What’s Hot',
    'Lemmy hot media', 'Mastodon trending media',
    'Lemmy memes', 'Fediverse public media'
  );

-- The original RSS adapter now deduplicates external IDs and isolates
-- occasional conflicting rows; retry these two editorial publishers.
update public.sources
set consecutive_failures=0, last_error=null, health_status='unknown'
where enabled and label in ('Julia Evans','Quanta Magazine')
  and consecutive_failures >= 8;
