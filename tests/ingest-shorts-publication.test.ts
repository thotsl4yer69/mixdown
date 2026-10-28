import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datedShortDraft, shortPublishedAt } from '../supabase/functions/ingest-shorts/published.ts';

const now = new Date('2026-10-29T00:00:00Z');

test('provider ISO publication time survives unchanged, including old archives and offsets', () => {
  assert.equal(shortPublishedAt('2020-04-12T03:04:05Z', null, now), '2020-04-12T03:04:05.000Z');
  assert.equal(shortPublishedAt('2026-10-28T12:30:00+11:00', null, now), '2026-10-28T01:30:00.000Z');
  assert.equal(shortPublishedAt('2024-02-29T03:04:05.123456Z', null, now), '2024-02-29T03:04:05.123Z');
  assert.equal(shortPublishedAt('2026-10-28T23:59:59Z', null, now), '2026-10-28T23:59:59.000Z');
});

test('missing, indexed-only, impossible, ambiguous and future dates cannot become recent', () => {
  for (const value of [null, undefined, 0, '', 'today', '2026-10-28', '2026-10-28T12:00:00',
    '2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-13-01T12:00:00Z',
    '2026-10-28T25:00:00Z', '2026-10-28T12:60:00Z', '2026-10-28T12:00:60Z',
    '2026-10-28T12:00:00+14:30', '2026-10-28T12:00:00+23:00',
    '2026-10-31T00:00:00Z']) {
    assert.equal(shortPublishedAt(value, null, now), null, String(value));
  }
  assert.equal(shortPublishedAt('2026-10-30T00:00:00Z', null, now), '2026-10-30T00:00:00.000Z');
});

test('configured freshness checks fail closed, without changing the original date', () => {
  assert.equal(shortPublishedAt('2020-04-12T03:04:05Z', 7, now), null);
  assert.equal(shortPublishedAt('2026-10-27T00:00:00Z', 2, now), '2026-10-27T00:00:00.000Z');
  assert.equal(shortPublishedAt('2026-10-26T23:59:59Z', 2, now), null);
  for (const badConfig of ['invalid', '0', -1, Number.NaN]) {
    assert.equal(shortPublishedAt('2026-10-28T00:00:00Z', badConfig, now), null);
  }
});

test('final write boundary rejects undated or forged drafts instead of using ingest time', () => {
  const item = { external_id: 'original-post', published_at: '2020-04-12T03:04:05Z' };
  assert.deepEqual(datedShortDraft(item, null, now), { ...item, published_at: '2020-04-12T03:04:05.000Z' });
  assert.equal(datedShortDraft({ ...item, published_at: undefined }, null, now), null);
  assert.equal(datedShortDraft({ ...item, published_at: '2026-02-30T03:04:05Z' }, null, now), null);
  assert.equal(datedShortDraft(item, 30, now), null);
});

test('all four adapters and the database write path enforce publication provenance', () => {
  const source = readFileSync(new URL('../supabase/functions/ingest-shorts/index.ts', import.meta.url), 'utf8');
  for (const field of ['post.record.createdAt', 'status.created_at', 'post.published', 'v.publishedAt']) {
    assert.ok(source.includes(`shortPublishedAt(${field}, source.config.max_age_days)`), field);
  }
  assert.match(source, /datedShortDraft\(draft, source\.config\?\.max_age_days\)/);
  assert.doesNotMatch(source, /published_at:\s*[^\n]*(?:new Date\(\)\.toISOString\(\)|indexedAt|Date\.now\(\))/);
  assert.doesNotMatch(source, /Date\.parse\((?:post\.record\.createdAt|status\.created_at)/);
});
