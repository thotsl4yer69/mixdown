-- mixdown :: ingest automation
-- This migration enables the required extensions. The cron job must be
-- scheduled manually after deploying the Edge Function — copy the statement
-- below into the Supabase SQL editor and replace the two placeholders before
-- running it:
--
--   select cron.schedule(
--     'mixdown-ingest',
--     '0 */2 * * *',
--     $job$
--       select net.http_post(
--         url := 'https://<your-project-ref>.supabase.co/functions/v1/ingest',
--         headers := jsonb_build_object(
--           'Content-Type', 'application/json',
--           'x-ingest-secret', '<your-ingest-secret>'
--         )
--       );
--     $job$
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('mixdown-ingest')
where exists (select 1 from cron.job where jobname = 'mixdown-ingest');
