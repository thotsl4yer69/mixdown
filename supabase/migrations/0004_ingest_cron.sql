-- mixdown :: ingest automation
-- Replace the two placeholders below before applying this migration, or set the
-- same cron job from the Supabase SQL editor after deploying the Edge Function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('mixdown-ingest')
where exists (select 1 from cron.job where jobname = 'mixdown-ingest');

select cron.schedule(
  'mixdown-ingest',
  '0 */2 * * *',
  $job$
    select net.http_post(
      url := 'https://<your-project-ref>.supabase.co/functions/v1/ingest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ingest-secret', '<your-ingest-secret>'
      )
    );
  $job$
);
