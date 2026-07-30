#!/usr/bin/env bash
set -euo pipefail

# mixdown :: one-shot setup
#
# Run this from your own machine (it needs to reach supabase.co, reddit.com,
# and googleapis.com — none of which are reachable from the sandbox this
# repo was built in). It does everything mechanical between "I have my
# account keys" and "the app has a working backend": patches app.json,
# links + pushes the Supabase project, sets Edge Function secrets, deploys
# ingestion, and schedules the cron job.
#
# It does NOT create the Supabase project, the Reddit OAuth app, or the
# Google Cloud API key — those need an authenticated browser session on
# each site, which nothing running non-interactively can do for you.
#
# Usage:
#   cp .env.example .env   # fill in every value
#   ./setup.sh

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill in every value first."
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

required=(
  SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_URL SUPABASE_ANON_KEY
  REDDIT_CLIENT_ID REDDIT_CLIENT_SECRET YOUTUBE_API_KEY
)
missing=()
for var in "${required[@]}"; do
  if [ -z "${!var:-}" ]; then missing+=("$var"); fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing from .env: ${missing[*]}"
  exit 1
fi

INGEST_SECRET="${INGEST_SECRET:-$(openssl rand -hex 24)}"
if ! grep -q '^INGEST_SECRET=' .env 2>/dev/null; then
  echo "INGEST_SECRET=${INGEST_SECRET}" >> .env
  echo "Generated INGEST_SECRET and saved it to .env — needed again for the cron step below."
fi

command -v supabase >/dev/null || { echo "Install the Supabase CLI first: npm install -g supabase"; exit 1; }
command -v node >/dev/null || { echo "Node.js is required"; exit 1; }

echo "==> Using SUPABASE_URL / SUPABASE_ANON_KEY from .env via app.config.js"

echo "==> Linking Supabase project ${SUPABASE_PROJECT_REF}"
export SUPABASE_ACCESS_TOKEN
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "==> Pushing migrations (schema, seed data, RLS)"
echo "    (may prompt for your database password — Project Settings → Database)"
supabase db push

echo "==> Setting Edge Function secrets (server-side only — never enter the repo)"
supabase secrets set \
  REDDIT_CLIENT_ID="$REDDIT_CLIENT_ID" \
  REDDIT_CLIENT_SECRET="$REDDIT_CLIENT_SECRET" \
  YOUTUBE_API_KEY="$YOUTUBE_API_KEY" \
  INGEST_SECRET="$INGEST_SECRET" \
  ${REDDIT_GRANT:+REDDIT_GRANT="$REDDIT_GRANT"} \
  ${REDDIT_USERNAME:+REDDIT_USERNAME="$REDDIT_USERNAME"} \
  ${REDDIT_PASSWORD:+REDDIT_PASSWORD="$REDDIT_PASSWORD"}

echo "==> Deploying the ingest function"
supabase functions deploy ingest --no-verify-jwt

echo "==> Scheduling ingestion via pg_cron (every 15 minutes)"
CRON_SQL="$(mktemp)"
cat > "$CRON_SQL" <<SQL
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('mixdown-ingest')
where exists (select 1 from cron.job where jobname = 'mixdown-ingest');

select cron.schedule(
  'mixdown-ingest',
  '*/15 * * * *',
  \$\$
  select net.http_post(
    url := 'https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ingest-secret', '${INGEST_SECRET}'
    )
  );
  \$\$
);
SQL
# `db query` is current as of this writing; the CLI's exact subcommand name
# has moved before (older versions used other names). If this fails, run
# `supabase db query --help` and adjust, or just paste $CRON_SQL's contents
# into the SQL editor in the Supabase dashboard — that always works.
supabase db query --file "$CRON_SQL"
rm -f "$CRON_SQL"

echo "==> Triggering ingestion once now so the app has content on first launch"
curl -fsS -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/ingest" \
  -H "x-ingest-secret: ${INGEST_SECRET}" | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log(`Polled ${data.polled} sources:`);
    for (const [label, result] of Object.entries(data.report)) {
      console.log(`  ${result.startsWith("error") ? "\u2717" : "\u2713"} ${label}: ${result}`);
    }
  '

echo ""
echo "==> Done. Remaining steps are local build steps, not account setup:"
echo "    npm install && npx expo install --fix"
echo "    npx expo prebuild --platform android"
echo "    npx expo run:android"
