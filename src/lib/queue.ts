import { supabase } from "./supabase";
import { effectiveWeights, fetchBanditState, fetchBuckets } from "./bandit";
import { localSeenIds } from "./db";
import { DEFAULT_PREFS, type FeedItem, type Prefs } from "./types";

export async function fetchPrefs(): Promise<Prefs> {
  const { data, error } = await supabase.from("prefs").select("key, value");
  if (error || !data) return DEFAULT_PREFS;

  const merged = { ...DEFAULT_PREFS };
  for (const row of data) {
    if (row.key in merged) {
      (merged as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return merged;
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  await supabase.from("prefs").upsert({ key, value, updated_at: new Date().toISOString() });
}

export interface QueuePage {
  items: FeedItem[];
  weights: Record<string, number>;
}

const QUEUE_RETRY_DELAY_MS = 1500;

/** Give the ingest/WAL buffer a moment to produce content before declaring EOF. */
export async function fetchQueuePageWithRetry(
  prefs: Prefs,
  excludeExtra: Set<string> = new Set(),
  attempts = 3,
): Promise<QueuePage> {
  let page = await fetchQueuePage(prefs, excludeExtra);
  for (let attempt = 1; attempt < attempts && page.items.length === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, QUEUE_RETRY_DELAY_MS));
    page = await fetchQueuePage(prefs, excludeExtra);
  }
  return page;
}

/**
 * One page of ranked, deduplicated feed items. Local seen IDs are merged in
 * on top of the server-side exclusion so an item impressed in the last few
 * seconds — before its telemetry has synced — still can't reappear later in
 * the same session.
 */
export async function fetchQueuePage(prefs: Prefs, excludeExtra: Set<string> = new Set()): Promise<QueuePage> {
  const [buckets, bandit, localSeen] = await Promise.all([
    fetchBuckets(),
    fetchBanditState(),
    localSeenIds(),
  ]);

  const weights = effectiveWeights(buckets, bandit, prefs.drift);

  const { data, error } = await supabase.rpc("get_feed", {
    p_limit: prefs.page_size + localSeen.size, // overfetch to survive local-only exclusions
    p_nsfw: prefs.nsfw_mode,
    p_weights: weights,
    p_halflife_h: prefs.halflife_hours,
    p_sim_weight: prefs.sim_weight,
    p_recency_weight: prefs.recency_weight,
    p_explore: prefs.explore,
  });

  if (error) throw error;

  const rows = (data ?? []) as FeedItem[];
  const filtered = rows.filter((r) => !localSeen.has(r.id) && !excludeExtra.has(r.id));

  return { items: filtered.slice(0, prefs.page_size), weights };
}
