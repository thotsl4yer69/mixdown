-- mixdown :: initial defaults
-- Every row here is editable in-app. Nothing below is referenced by name in code.

-- ---------------------------------------------------------------------------
-- Six buckets. Weights are priors and sum to 1.00.
-- ---------------------------------------------------------------------------
insert into topic_buckets (key, label, weight, lane, sort_order) values
  ('entertainment',     'Entertainment',      0.24, 'play',  10),
  ('software-depth',    'Software internals', 0.20, 'learn', 20),
  ('science',           'Science explainers', 0.18, 'learn', 30),
  ('news-analysis',     'News & analysis',    0.14, 'play',  40),
  ('making',            'Making & hardware',  0.14, 'learn', 50),
  ('language',          'Language immersion', 0.10, 'learn', 60);

insert into bandit_state (bucket) select key from topic_buckets;

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
insert into prefs (key, value) values
  ('nsfw_mode',        'false'::jsonb),
  ('drift',            '0.45'::jsonb),   -- 0 = obey sliders exactly, 1 = bandit rules
  ('halflife_hours',   '72'::jsonb),
  ('sim_weight',       '0.55'::jsonb),
  ('recency_weight',   '0.30'::jsonb),
  ('explore',          '0.15'::jsonb),
  ('page_size',        '20'::jsonb),
  ('preload_ahead',    '6'::jsonb),      -- byte prefetch depth
  ('decoder_slots',    '3'::jsonb),      -- overridden downward by hardware probe
  ('autoplay_muted',   'true'::jsonb);

-- ---------------------------------------------------------------------------
-- Reddit. High signal-to-noise, active moderation, stable OAuth listings.
-- ---------------------------------------------------------------------------
insert into sources (kind, label, config, default_bucket, poll_interval_min) values
  ('reddit','r/programming',       '{"subreddit":"programming","listing":"hot"}',        'software-depth', 45),
  ('reddit','r/ExperiencedDevs',   '{"subreddit":"ExperiencedDevs","listing":"hot"}',    'software-depth', 90),
  ('reddit','r/MachineLearning',   '{"subreddit":"MachineLearning","listing":"hot"}',    'software-depth', 60),
  ('reddit','r/askscience',        '{"subreddit":"askscience","listing":"hot"}',         'science',        90),
  ('reddit','r/explainlikeimfive', '{"subreddit":"explainlikeimfive","listing":"top","time":"day"}', 'science', 90),
  ('reddit','r/todayilearned',     '{"subreddit":"todayilearned","listing":"top","time":"day"}',     'entertainment', 60),
  ('reddit','r/InternetIsBeautiful','{"subreddit":"InternetIsBeautiful","listing":"hot"}','entertainment', 180),
  ('reddit','r/embedded',          '{"subreddit":"embedded","listing":"hot"}',           'making',        120),
  ('reddit','r/DIY',               '{"subreddit":"DIY","listing":"top","time":"week"}',  'making',        180),
  ('reddit','r/languagelearning',  '{"subreddit":"languagelearning","listing":"hot"}',   'language',      180);

-- ---------------------------------------------------------------------------
-- RSS / Atom. All publish full-text or near-full-text feeds.
-- ---------------------------------------------------------------------------
insert into sources (kind, label, config, default_bucket, poll_interval_min) values
  ('rss','Hacker News front page', '{"url":"https://hnrss.org/frontpage?points=150"}',                       'software-depth', 45),
  ('rss','Ars Technica',           '{"url":"https://feeds.arstechnica.com/arstechnica/index"}',               'news-analysis',  60),
  ('rss','Quanta Magazine',        '{"url":"https://www.quantamagazine.org/feed/"}',                          'science',        180),
  ('rss','Simon Willison',         '{"url":"https://simonwillison.net/atom/everything/"}',                    'software-depth', 90),
  ('rss','Julia Evans',            '{"url":"https://jvns.ca/atom.xml"}',                                      'software-depth', 240),
  ('rss','Hackaday',               '{"url":"https://hackaday.com/feed/"}',                                    'making',         60),
  ('rss','MIT Technology Review',  '{"url":"https://www.technologyreview.com/feed/"}',                         'news-analysis',  120),
  ('rss','Nautilus',               '{"url":"https://nautil.us/feed/"}',                                        'science',        240),
  ('rss','The Verge',              '{"url":"https://www.theverge.com/rss/index.xml"}',                          'news-analysis',  60);

-- ---------------------------------------------------------------------------
-- PeerTube. Real REST API, CC-licensed, direct MP4/HLS — the fast playback lane.
-- ---------------------------------------------------------------------------
insert into sources (kind, label, config, default_bucket, poll_interval_min) values
  ('peertube','diode.zone (tech)',   '{"instance":"diode.zone","filter":"local"}',   'software-depth', 120),
  ('peertube','TILvids',             '{"instance":"tilvids.com","filter":"local"}',   'science',        120),
  ('peertube','Framatube',           '{"instance":"framatube.org","filter":"local"}', 'entertainment',  180),
  ('peertube','Blender Video',       '{"instance":"video.blender.org","filter":"local"}', 'making',     240);

-- ---------------------------------------------------------------------------
-- YouTube. Official Data API + embedded player only. Channel IDs are resolved
-- from the handle at first poll and cached back into config.channel_id.
-- ---------------------------------------------------------------------------
insert into sources (kind, label, config, default_bucket, poll_interval_min) values
  ('youtube','3Blue1Brown',   '{"handle":"@3blue1brown"}',   'science',        360),
  ('youtube','Veritasium',    '{"handle":"@veritasium"}',    'science',        360),
  ('youtube','Computerphile', '{"handle":"@Computerphile"}', 'software-depth', 360),
  ('youtube','Applied Science','{"handle":"@AppliedScience"}','making',        720),
  ('youtube','Dreaming Spanish','{"handle":"@DreamingSpanish"}','language',    360);

-- ---------------------------------------------------------------------------
-- Direct media. Seeds the video lane with known-good CMAF/HLS so you can
-- verify the preload pipeline before any external source has been polled.
-- ---------------------------------------------------------------------------
insert into sources (kind, label, config, default_bucket, poll_interval_min) values
  ('direct','Sintel (HLS test)',
     '{"url":"https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8","media_kind":"hls","title":"Sintel"}',
     'entertainment', 10080),
  ('direct','Big Buck Bunny (MP4 test)',
     '{"url":"https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4","media_kind":"mp4","title":"Big Buck Bunny"}',
     'entertainment', 10080);

-- ---------------------------------------------------------------------------
-- NSFW sources: intentionally empty.
--
-- Add your own with is_nsfw = true. They are hard-partitioned from the default
-- feed by get_feed(p_nsfw), so they never appear unless NSFW mode is on.
-- Use authenticated Reddit listings — the public JSON endpoints strip
-- over_18 content, and subreddit-level moderation is the only content-safety
-- layer this pipeline has. Example shape:
--
--   insert into sources (kind, label, config, default_bucket, is_nsfw)
--   values ('reddit','r/<name>','{"subreddit":"<name>","listing":"hot"}','entertainment',true);
-- ---------------------------------------------------------------------------
