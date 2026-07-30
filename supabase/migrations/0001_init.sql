-- mixdown :: core schema
-- Everything a user can change at runtime lives in a row, not in code.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Topic buckets. Editable in-app: add, remove, rename, reweight, disable.
-- `weight` is a PRIOR only. The bandit is allowed to drift from it.
-- ---------------------------------------------------------------------------
create table topic_buckets (
  key           text primary key,
  label         text        not null,
  weight        real        not null default 0.1 check (weight >= 0 and weight <= 1),
  lane          text        not null default 'learn' check (lane in ('learn','play')),
  enabled       boolean     not null default true,
  sort_order    int         not null default 100,
  created_at    timestamptz not null default now()
);

comment on column topic_buckets.lane is
  'Drives the accent colour in the client. learn=teal, play=amber. Purely presentational.';

-- ---------------------------------------------------------------------------
-- Sources. The ingestion worker reads this table and nothing else.
-- Adding a source is an INSERT, never a deploy.
-- ---------------------------------------------------------------------------
create table sources (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('rss','peertube','reddit','youtube','direct')),
  label                text not null,
  config               jsonb not null default '{}'::jsonb,
  default_bucket       text references topic_buckets(key) on delete set null,
  is_nsfw              boolean not null default false,
  enabled              boolean not null default true,
  poll_interval_min    int     not null default 60 check (poll_interval_min >= 5),
  max_items_per_poll   int     not null default 25 check (max_items_per_poll between 1 and 100),
  last_polled_at       timestamptz,
  last_error           text,
  consecutive_failures int     not null default 0,
  created_at           timestamptz not null default now()
);

comment on column sources.config is $$Shape depends on kind:
  rss      { "url": "https://..." }
  peertube { "instance": "diode.zone", "filter": "local"|"all", "category"?: int }
  reddit   { "subreddit": "programming", "listing": "hot"|"top"|"new", "time"?: "day"|"week" }
  youtube  { "handle": "@3blue1brown" }   -- channel id is resolved and cached into config.channel_id
  direct   { "url": "https://.../video.mp4", "media_kind": "mp4"|"hls", "title"?: "..." }$$;

create index sources_due_idx on sources (enabled, last_polled_at nulls first);

-- ---------------------------------------------------------------------------
-- Items. One row per feed unit regardless of modality.
-- ---------------------------------------------------------------------------
create table items (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  external_id   text not null,
  kind          text not null check (kind in ('video','article','social')),

  title         text not null,
  author        text,
  permalink     text not null,
  published_at  timestamptz not null default now(),
  bucket        text references topic_buckets(key) on delete set null,
  is_nsfw       boolean not null default false,

  -- video payload
  media_url     text,
  media_kind    text check (media_kind in ('mp4','hls','youtube_embed')),
  duration_s    int,
  poster_url    text,
  aspect_w      int,
  aspect_h      int,

  -- article / social payload: structured token tree, never raw HTML
  body          jsonb,
  excerpt       text,
  comment_count int,
  score         int,

  embedding     vector(384),
  ingested_at   timestamptz not null default now(),

  unique (source_id, external_id)
);

-- HNSW for taste-vector similarity. Cosine because embeddings are normalised.
create index items_embedding_idx on items using hnsw (embedding vector_cosine_ops);
create index items_serve_idx     on items (is_nsfw, kind, published_at desc);
create index items_bucket_idx    on items (bucket, published_at desc);

-- ---------------------------------------------------------------------------
-- Telemetry. Written from the client's SQLite buffer in batches.
-- ---------------------------------------------------------------------------
create table interactions (
  id          bigserial primary key,
  item_id     uuid references items(id) on delete cascade,
  bucket      text,
  event       text not null check (event in
                ('impression','dwell','complete','rewatch','skip','vote_up','vote_down','open_reader','hide')),
  dwell_ms    int,
  completion  real check (completion between 0 and 1),
  occurred_at timestamptz not null default now()
);

create index interactions_item_idx  on interactions (item_id, occurred_at desc);
create index interactions_recent_idx on interactions (occurred_at desc);

-- Fast "have I already seen this" lookup, kept separate from the event log
-- so pruning telemetry never resurfaces old items.
create table seen (
  item_id  uuid primary key references items(id) on delete cascade,
  seen_at  timestamptz not null default now(),
  hidden   boolean not null default false
);

create index seen_at_idx on seen (seen_at desc);

-- ---------------------------------------------------------------------------
-- Bandit posterior per bucket. Beta(alpha, beta) over "was this a good slot".
-- Sampling happens in TypeScript; this table is just durable state.
-- ---------------------------------------------------------------------------
create table bandit_state (
  bucket     text primary key references topic_buckets(key) on delete cascade,
  alpha      real not null default 1.0 check (alpha > 0),
  beta       real not null default 1.0 check (beta  > 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rolling taste vector: exponential moving average of engaged-item embeddings.
-- ---------------------------------------------------------------------------
create table taste_vector (
  id         int primary key default 1 check (id = 1),
  embedding  vector(384),
  n          int not null default 0,
  updated_at timestamptz not null default now()
);

insert into taste_vector (id, embedding, n) values (1, null, 0);

-- ---------------------------------------------------------------------------
-- Preferences. Single-row-per-key so the client can add settings without
-- a migration.
-- ---------------------------------------------------------------------------
create table prefs (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- Ranking
-- ===========================================================================

-- Effective bucket weights are computed client-side (Thompson sampling is
-- trivial in TS, painful in plpgsql) and passed in as a jsonb map:
--   { "software-depth": 0.31, "entertainment": 0.19, ... }
--
-- This function does the parts SQL is good at: vector distance, recency
-- decay, seen-exclusion, and weighted-random selection.

create or replace function get_feed(
  p_limit         int     default 20,
  p_nsfw          boolean default false,
  p_weights       jsonb   default '{}'::jsonb,
  p_halflife_h    real    default 72.0,
  p_sim_weight    real    default 0.55,
  p_recency_weight real   default 0.30,
  p_explore       real    default 0.15
)
returns table (
  id           uuid,
  kind         text,
  title        text,
  author       text,
  permalink    text,
  published_at timestamptz,
  bucket       text,
  lane         text,
  is_nsfw      boolean,
  media_url    text,
  media_kind   text,
  duration_s   int,
  poster_url   text,
  body         jsonb,
  excerpt      text,
  score        real
)
language sql
stable
as $$
  with taste as (
    select embedding from taste_vector where id = 1
  ),
  candidate as (
    select
      i.*,
      tb.lane,
      coalesce((p_weights ->> i.bucket)::real, 0.02) as bucket_w,
      -- cosine similarity to taste vector; neutral 0.5 before we know anything
      case
        when t.embedding is null or i.embedding is null then 0.5
        else greatest(0.0, 1.0 - (i.embedding <=> t.embedding))
      end as sim,
      -- exponential recency decay
      exp(
        -0.6931471805599453
        * (extract(epoch from (now() - i.published_at)) / 3600.0)
        / greatest(p_halflife_h, 1.0)
      )::real as recency
    from items i
    join topic_buckets tb on tb.key = i.bucket
    cross join taste t
    where i.is_nsfw = p_nsfw
      and tb.enabled
      and not exists (select 1 from seen s where s.item_id = i.id)
  ),
  scored as (
    select
      c.*,
      (
        c.bucket_w * (
            p_sim_weight     * c.sim
          + p_recency_weight * c.recency
          + p_explore        * random()
        )
      )::real as final_score
    from candidate c
  )
  select
    s.id, s.kind, s.title, s.author, s.permalink, s.published_at,
    s.bucket, s.lane, s.is_nsfw,
    s.media_url, s.media_kind, s.duration_s, s.poster_url,
    s.body, s.excerpt,
    s.final_score
  from scored s
  order by s.final_score desc
  limit p_limit;
$$;

-- Fold an engaged item into the rolling taste vector.
create or replace function absorb_taste(p_item_id uuid, p_strength real default 1.0)
returns void
language plpgsql
as $$
declare
  v_emb   vector(384);
  v_cur   vector(384);
  v_n     int;
  v_rate  real;
begin
  select embedding into v_emb from items where id = p_item_id;
  if v_emb is null then return; end if;

  select embedding, n into v_cur, v_n from taste_vector where id = 1;

  -- Decaying learning rate: fast while the profile is empty, stable later.
  v_rate := least(0.35, greatest(0.02, 1.0 / (v_n + 3))) * greatest(p_strength, 0.0);

  if v_cur is null then
    update taste_vector
       set embedding = v_emb, n = 1, updated_at = now()
     where id = 1;
  else
    update taste_vector
       set embedding  = ((1.0 - v_rate) * v_cur + v_rate * v_emb),
           n          = v_n + 1,
           updated_at = now()
     where id = 1;
  end if;
end;
$$;

-- Which sources are due for a poll right now.
create or replace function due_sources()
returns setof sources
language sql
stable
as $$
  select *
  from sources
  where enabled
    and consecutive_failures < 8
    and (
      last_polled_at is null
      or last_polled_at < now() - make_interval(mins => poll_interval_min)
    )
  order by last_polled_at nulls first
  limit 12;
$$;

-- Housekeeping: keep the free tier's 500MB honest.
create or replace function prune(p_keep_days int default 45)
returns void
language sql
as $$
  delete from interactions where occurred_at < now() - make_interval(days => p_keep_days);
  delete from items
   where ingested_at < now() - make_interval(days => p_keep_days)
     and exists (select 1 from seen s where s.item_id = items.id);
  delete from seen where seen_at < now() - make_interval(days => p_keep_days * 2);
$$;
