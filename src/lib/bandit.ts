import { supabase } from "./supabase";
import type { TopicBucket } from "./types";

export interface BanditState {
  bucket: string;
  alpha: number;
  beta: number;
}

/**
 * Marsaglia-Tsang gamma sampler (shape >= 1; boosted for shape < 1 via the
 * standard u^(1/shape) trick). Good enough variance for a single-user
 * recommendation bandit — this isn't simulation-grade, it just needs to be
 * an honest sample from Beta(alpha, beta).
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(1 + shape) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box-Muller for a standard normal draw.
      const u1 = Math.random() || 1e-12;
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const ga = sampleGamma(alpha);
  const gb = sampleGamma(beta);
  return ga / (ga + gb);
}

export async function fetchBuckets(): Promise<TopicBucket[]> {
  const { data, error } = await supabase
    .from("topic_buckets")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TopicBucket[];
}

export async function fetchBanditState(): Promise<Map<string, BanditState>> {
  const { data, error } = await supabase.from("bandit_state").select("*");
  if (error) throw error;
  const map = new Map<string, BanditState>();
  for (const row of (data ?? []) as BanditState[]) map.set(row.bucket, row);
  return map;
}

/**
 * `drift` is the user's own knob (0 = sliders are law, 1 = let the bandit run
 * free). Effective weight per bucket blends the stated prior with a live
 * Thompson sample, then the result is renormalized to sum to 1 so it's a
 * valid probability simplex for get_feed's weighted-random selection.
 */
export function effectiveWeights(
  buckets: TopicBucket[],
  bandit: Map<string, BanditState>,
  drift: number,
): Record<string, number> {
  const d = Math.min(Math.max(drift, 0), 1);
  const raw: Record<string, number> = {};

  for (const b of buckets) {
    const state = bandit.get(b.key) ?? { bucket: b.key, alpha: 1, beta: 1 };
    const sample = sampleBeta(state.alpha, state.beta);
    raw[b.key] = (1 - d) * b.weight + d * sample;
  }

  const total = Object.values(raw).reduce((a, v) => a + v, 0) || 1;
  for (const key of Object.keys(raw)) raw[key] = raw[key] / total;
  return raw;
}

/**
 * Fold one interaction outcome into a bucket's posterior. Reward is a 0..1
 * signal: full completion or an upvote is a strong 1, a fast skip is a
 * near-0, a plain impression with average dwell sits in between. Read-modify-
 * write against Postgres is accepted as fine for a single-user app; there is
 * no concurrent writer to race against.
 */
export async function updateBandit(bucket: string, reward: number) {
  const r = Math.min(Math.max(reward, 0), 1);

  const { data, error } = await supabase
    .from("bandit_state")
    .select("alpha, beta")
    .eq("bucket", bucket)
    .single();
  if (error || !data) return;

  await supabase
    .from("bandit_state")
    .update({
      alpha: data.alpha + r,
      beta: data.beta + (1 - r),
      updated_at: new Date().toISOString(),
    })
    .eq("bucket", bucket);
}

/** Maps a raw interaction into the reward shape updateBandit expects. */
export function rewardFor(event: string, completion?: number | null): number | null {
  switch (event) {
    case "vote_up":
      return 1;
    case "vote_down":
      return 0;
    case "complete":
      return 1;
    case "skip":
      // A very fast skip (low completion) is a stronger negative signal
      // than a skip after watching most of it.
      return completion != null ? Math.min(completion, 0.35) : 0.15;
    case "rewatch":
      return 1;
    default:
      return null;
  }
}
