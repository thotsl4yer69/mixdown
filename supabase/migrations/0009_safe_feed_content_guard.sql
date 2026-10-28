-- Mixdown 2.4: Safe-feed defence in depth against adult-labelled community/video posts.
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
  )
  select i.* from ranked r join public.items i on i.id=r.id
  order by r.bucket_turn,r.source_turn,r.published_at desc,i.id
  limit least(greatest(p_limit,1),150) offset greatest(p_offset,0)
$$;
revoke all on function public.get_mixed_safe_feed_page(text,integer,integer) from public;
grant execute on function public.get_mixed_safe_feed_page(text,integer,integer) to anon,authenticated;
