import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceKind, SourceRow } from "../supabase/functions/_shared/types.ts";
import { sourcePublishedAt } from "../supabase/functions/ingest/lib/published.ts";
import { rssAdapter } from "../supabase/functions/ingest/adapters/rss.ts";
import { newsApiAdapter } from "../supabase/functions/ingest/adapters/newsapi.ts";
import { directAdapter } from "../supabase/functions/ingest/adapters/direct.ts";

function source(kind: SourceKind, config: Record<string, unknown>): SourceRow {
  return {
    id: "fixture", kind, label: "Test source", config, default_bucket: "news-analysis",
    is_nsfw: false, max_items_per_poll: 20, consecutive_failures: 0,
  };
}

test("only real publication dates are accepted; ingestion is never used as fallback", () => {
  const now = new Date("2026-10-26T00:00:00Z");
  assert.equal(sourcePublishedAt(null, now), null);
  assert.equal(sourcePublishedAt("", now), null);
  assert.equal(sourcePublishedAt("not a date", now), null);
  assert.equal(sourcePublishedAt("yesterday", now), null);
  assert.equal(sourcePublishedAt("2030-01-01T00:00:00Z", now), null);
  assert.equal(sourcePublishedAt("2020-10-08T20:50:55Z", now), "2020-10-08T20:50:55.000Z");
  assert.equal(sourcePublishedAt("Fri, 24 Oct 2025 15:30:00 GMT", now), "2025-10-24T15:30:00.000Z");
});

test("RSS keeps the publisher's old date and skips updated-only or invalid entries", async () => {
  const xml = `<rss><channel>
    <item><title>Archive video</title><link>https://example.test/old</link>
      <pubDate>Fri, 24 Oct 2025 15:30:00 GMT</pubDate>
      <description><![CDATA[<p>Originally published in 2025.</p>]]></description></item>
    <item><title>Edited only</title><link>https://example.test/edited</link>
      <updated>2026-10-25T00:00:00Z</updated>
      <description><![CDATA[<p>Updated but undated.</p>]]></description></item>
    <item><title>Broken date</title><link>https://example.test/broken</link>
      <pubDate>not a date</pubDate>
      <description><![CDATA[<p>Invalid date.</p>]]></description></item>
  </channel></rss>`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(xml, { status: 200 });
  try {
    const items = await rssAdapter.fetch(source("rss", { url: "https://example.test/rss" }));
    assert.deepEqual(items.map(item => item.permalink), ["https://example.test/old"]);
    assert.equal(items[0].published_at, "2025-10-24T15:30:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("NewsAPI never invents a date for missing or malformed publishedAt", async () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = (globalThis as any).Deno;
  (globalThis as any).Deno = { env: { get: () => "isolated-test-key" } };
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "ok",
    articles: [
      { title: "Archive", url: "https://example.test/old", publishedAt: "2020-10-08T20:50:55Z" },
      { title: "No date", url: "https://example.test/missing" },
      { title: "Invalid", url: "https://example.test/invalid", publishedAt: "bad-date" },
    ],
  }), { status: 200 });
  try {
    const items = await newsApiAdapter.fetch(source("newsapi", { q: "technology" }));
    assert.deepEqual(items.map(item => item.permalink), ["https://example.test/old"]);
    assert.equal(items[0].published_at, "2020-10-08T20:50:55.000Z");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete (globalThis as any).Deno;
    else (globalThis as any).Deno = originalDeno;
  }
});

test("direct smoke-test videos are not presented as newly published without source evidence", async () => {
  const base = { url: "https://example.test/archive.mp4", media_kind: "mp4", title: "Archive" };
  assert.deepEqual(await directAdapter.fetch(source("direct", base)), []);
  const items = await directAdapter.fetch(source("direct", {
    ...base, published_at: "2020-10-08T20:50:55Z",
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].published_at, "2020-10-08T20:50:55.000Z");
});
