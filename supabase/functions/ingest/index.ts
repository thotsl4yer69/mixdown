import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Adapter, DraftItem, SourceRow } from "../_shared/types.ts";
import { rssAdapter } from "./adapters/rss.ts";
import { peertubeAdapter } from "./adapters/peertube.ts";
import { redditAdapter } from "./adapters/reddit.ts";
import { youtubeAdapter, youtubeResolutions } from "./adapters/youtube.ts";
import { newsApiAdapter } from "./adapters/newsapi.ts";
import { embedText } from "./lib/extract.ts";

const ADAPTERS: Record<string, Adapter> = {
  rss: rssAdapter,
  peertube: peertubeAdapter,
  reddit: redditAdapter,
  youtube: youtubeAdapter,
  newsapi: newsApiAdapter,
  direct: {
    // A 'direct' source is a single fixed media URL. Polling it re-asserts the
    // row rather than discovering anything, which is what makes it useful as a
    // playback smoke test.
    fetch(source: SourceRow): Promise<DraftItem[]> {
      const url = String(source.config.url ?? "");
      if (!url) throw new Error("direct source missing config.url");
      return Promise.resolve([
        {
          external_id: url,
          kind: "video",
          title: String(source.config.title ?? source.label),
          permalink: url,
          published_at: new Date().toISOString(),
          is_nsfw: source.is_nsfw,
          media_url: url,
          media_kind: (source.config.media_kind as "mp4" | "hls") ?? "mp4",
          poster_url: (source.config.poster_url as string) ?? null,
        },
      ]);
    },
  },
};

/**
 * Embeddings run in-process on Supabase's bundled gte-small model: 384 dims,
 * no external API, no per-token cost. That is the only reason a semantic
 * ranker fits inside a free tier.
 */
const session = new Supabase.ai.Session("gte-small");
const MIN_RUN_INTERVAL_MS = 2 * 60 * 1000;
let lastRunAt = 0;
let running = false;

async function embed(text: string): Promise<number[] | null> {
  try {
    const out = await session.run(text, { mean_pool: true, normalize: true });
    return out as number[];
  } catch (err) {
    console.error("embed failed:", err);
    return null;
  }
}

async function persist(
  db: SupabaseClient,
  source: SourceRow,
  drafts: DraftItem[],
): Promise<number> {
  if (drafts.length === 0) return 0;

  // Skip embedding work for items we already have.
  const { data: existing } = await db
    .from("items")
    .select("external_id")
    .eq("source_id", source.id)
    .in("external_id", drafts.map((d) => d.external_id));

  const known = new Set((existing ?? []).map((r: { external_id: string }) => r.external_id));
  const fresh = drafts.filter((d) => !known.has(d.external_id));
  if (fresh.length === 0) return 0;

  const rows = [];
  for (const d of fresh) {
    const vector = await embed(embedText(d.title, d.excerpt ?? null, source.default_bucket));
    rows.push({
      source_id: source.id,
      external_id: d.external_id,
      kind: d.kind,
      title: d.title,
      author: d.author ?? null,
      permalink: d.permalink,
      published_at: d.published_at,
      bucket: source.default_bucket,
      is_nsfw: d.is_nsfw,
      media_url: d.media_url ?? null,
      media_kind: d.media_kind ?? null,
      duration_s: d.duration_s ?? null,
      poster_url: d.poster_url ?? null,
      aspect_w: d.aspect_w ?? null,
      aspect_h: d.aspect_h ?? null,
      body: d.body ?? null,
      excerpt: d.excerpt ?? null,
      comment_count: d.comment_count ?? null,
      score: d.score ?? null,
      embedding: vector,
    });
  }

  const { error } = await db
    .from("items")
    .upsert(rows, { onConflict: "source_id,external_id", ignoreDuplicates: true });

  if (error) throw new Error(`upsert failed: ${error.message}`);
  return rows.length;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("INGEST_SECRET");
  if (secret && req.headers.get("x-ingest-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const now = Date.now();
  if (running || now - lastRunAt < MIN_RUN_INTERVAL_MS) {
    return Response.json({ error: "ingest already running or recently started" }, { status: 429 });
  }
  running = true;
  lastRunAt = now;

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: sources, error } = await db.rpc("due_sources");
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const report: Record<string, string> = {};

    for (const source of (sources ?? []) as SourceRow[]) {
      const adapter = ADAPTERS[source.kind];
      if (!adapter) {
        report[source.label] = `no adapter for kind ${source.kind}`;
        continue;
      }

      try {
        const drafts = await adapter.fetch(source);
        const written = await persist(db, source, drafts);

      // Cache a resolved YouTube uploads playlist so we never pay for it twice.
      const resolved = youtubeResolutions.get(source.id);
      const configPatch = resolved
        ? {
            config: {
              ...source.config,
              channel_id: resolved.channelId,
              uploads_playlist_id: resolved.uploadsPlaylistId,
            },
          }
        : {};

      await db
        .from("sources")
        .update({
          last_polled_at: new Date().toISOString(),
          last_error: null,
          consecutive_failures: 0,
          ...configPatch,
        })
        .eq("id", source.id);

        report[source.label] = `+${written} of ${drafts.length}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .from("sources")
          .update({
            last_polled_at: new Date().toISOString(),
            last_error: message.slice(0, 500),
            consecutive_failures: source.consecutive_failures + 1,
          })
          .eq("id", source.id);
        report[source.label] = `error: ${message}`;
        console.error(`[${source.label}]`, message);
      }
    }

    return Response.json({ polled: Object.keys(report).length, report });
  } catch (err) {
    console.error("ingest failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    running = false;
  }
});
