import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const liveBundle = readFileSync(new URL('../supabase/functions/ingest/index.ts', import.meta.url), 'utf8');

function bundledAdapters(fetchImpl) {
  const environment = {
    console,
    URL,
    URLSearchParams,
    AbortSignal,
    Headers,
    Request,
    Response,
    TextEncoder,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    Deno: { env: { get: () => 'fixture-api-key' }, serve: () => {} },
  };
  runInNewContext(liveBundle + '\n;globalThis.__test = { ADAPTERS, sourcePublishedAt };', environment, { timeout: 2000 });
  return environment.__test;
}

const source = (kind, config) => ({
  id: 'fixture', kind, config, label: 'Fixture', max_items_per_poll: 10,
  is_nsfw: false, default_bucket: 'news-analysis',
});

test('the deployable bundled RSS adapter rejects undated, edited-only and impossible calendar dates', async () => {
  const xml = `<rss><channel>
    <item><title>Archived</title><link>https://example.org/a</link><pubDate>Fri, 24 Oct 2025 15:30:00 GMT</pubDate><description>Original dated article</description></item>
    <item><title>Edited only</title><link>https://example.org/b</link><updated>2026-10-29T01:00:00Z</updated><description>Edited article</description></item>
    <item><title>Impossible</title><link>https://example.org/c</link><pubDate>2026-02-30T01:00:00Z</pubDate><description>Invalid calendar article</description></item>
  </channel></rss>`;
  const { ADAPTERS } = bundledAdapters(async () => new Response(xml, {status: 200}));
  const result = await ADAPTERS.rss.fetch(source('rss', {url: 'https://example.org/feed'}));
  assert.equal(result.length, 1);
  assert.equal(result[0].permalink, 'https://example.org/a');
  assert.equal(result[0].published_at, '2025-10-24T15:30:00.000Z');
});

test('the deployable bundled NewsAPI adapter preserves publication and skips undated articles', async () => {
  const news = {status: 'ok', articles: [
    {url:'https://example.org/old',title:'Older news',publishedAt:'2025-10-24T15:30:00Z',description:'Original'},
    {url:'https://example.org/no-date',title:'No date',description:'Undated'},
    {url:'https://example.org/bad',title:'Impossible date',publishedAt:'2026-02-30T01:00:00Z'}
  ]};
  const { ADAPTERS } = bundledAdapters(async () => new Response(JSON.stringify(news), {status: 200,headers:{'content-type':'application/json'}}));
  const result = await ADAPTERS.newsapi.fetch(source('newsapi', {endpoint:'everything',q:'test'}));
  assert.equal(result.length, 1);
  assert.equal(result[0].published_at, '2025-10-24T15:30:00.000Z');
});

test('the deployable bundled direct adapter requires a configured publication date', async () => {
  const { ADAPTERS, sourcePublishedAt } = bundledAdapters(async () => {throw Error('no network expected')});
  const undated = await ADAPTERS.direct.fetch(source('direct', {url:'https://example.org/video.mp4'}));
  assert.equal(undated.length, 0);
  const old = await ADAPTERS.direct.fetch(source('direct', {url:'https://example.org/video.mp4',published_at:'2025-10-24T15:30:00Z'}));
  assert.equal(old.length, 1);
  assert.equal(old[0].published_at, '2025-10-24T15:30:00.000Z');
  assert.equal(sourcePublishedAt('2026-02-30T12:00:00Z', new Date('2026-10-29T00:00:00Z')), null);
});
