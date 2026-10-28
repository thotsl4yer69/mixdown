// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";
import { datedShortDraft, shortPublishedAt } from "./published.ts";

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const cleanText = (value: unknown) => String(value ?? "")
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.split("/").filter(Boolean)[0] ?? null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/embed/")) {
        return u.pathname.split("/").filter(Boolean)[1] ?? null;
      }
      return u.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function mediaKind(url: string): "hls" | "mp4" | null {
  if (/\.m3u8(?:\?|$)/i.test(url)) return "hls";
  if (/\.(?:mp4|m4v|webm)(?:\?|$)/i.test(url)) return "mp4";
  return null;
}

function isImageUrl(url: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|avif)(?:\?|$)/i.test(url);
}

function engagement(raw: number): number {
  return clamp(Math.log10(Math.max(raw, 0) + 1) / 6);
}

function qualityFor(item: any): { quality_score: number; visual_score: number; engagement_score: number } {
  const w = numberValue(item.aspect_w) ?? 0;
  const h = numberValue(item.aspect_h) ?? 0;
  const aspect = w > 0 && h > 0 ? h / w : null;
  const orientation = aspect == null ? (item.poster_url ? 0.65 : 0.45) : aspect >= 1.3 ? 1 : aspect >= 0.85 ? 0.78 : 0.45;
  const visual = clamp(orientation * 0.72 + (item.poster_url ? 0.28 : 0.08));
  const engagementScore = item.engagement_score != null
    ? clamp(Number(item.engagement_score))
    : engagement((item.score ?? 0) + (item.comment_count ?? 0) * 2);
  let duration = 0.62;
  if (item.kind === "video") {
    const seconds = numberValue(item.duration_s);
    duration = seconds == null ? 0.62 : seconds >= 3 && seconds <= 75 ? 1 : seconds <= 180 ? 0.76 : 0.2;
  } else if (item.kind === "social") {
    duration = 0.78;
  }
  const completeness = clamp((item.title ? 0.25 : 0) + (item.permalink ? 0.2 : 0) + (item.media_url || item.poster_url ? 0.4 : 0) + (item.author ? 0.15 : 0));
  return {
    quality_score: clamp(duration * 0.38 + visual * 0.27 + engagementScore * 0.22 + completeness * 0.13),
    visual_score: visual,
    engagement_score: engagementScore,
  };
}

function normalizedIdentity(item: any): string {
  if (item.canonical_id) return String(item.canonical_id).trim().toLowerCase();
  try {
    const u = new URL(item.permalink);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/$/, "").toLowerCase()}${u.searchParams.get("v") ? `?v=${u.searchParams.get("v")}` : ""}`;
  } catch {
    return `${item.external_id}:${item.permalink}`.toLowerCase();
  }
}

async function contentKey(item: any): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedIdentity(item))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bskyMedia(embed: any): any {
  if (!embed) return null;
  const type = String(embed.$type ?? "");
  if (type.includes("recordWithMedia")) return bskyMedia(embed.media);
  if (type.includes("video")) {
    return {
      kind: "video",
      media_url: embed.playlist ?? null,
      media_kind: embed.playlist ? "hls" : null,
      poster_url: embed.thumbnail ?? null,
      aspect_w: numberValue(embed.aspectRatio?.width),
      aspect_h: numberValue(embed.aspectRatio?.height),
    };
  }
  if (type.includes("images")) {
    const image = embed.images?.[0];
    if (!image) return null;
    return {
      kind: "social",
      poster_url: image.fullsize ?? image.thumb ?? null,
      aspect_w: numberValue(image.aspectRatio?.width),
      aspect_h: numberValue(image.aspectRatio?.height),
    };
  }
  if (type.includes("external")) {
    const external = embed.external;
    if (!external) return null;
    return {
      kind: "social",
      poster_url: external.thumb ?? null,
      linked_url: external.uri ?? null,
      linked_title: external.title ?? null,
      linked_description: external.description ?? null,
    };
  }
  return null;
}

async function fetchBluesky(source: any): Promise<any[]> {
  const feedUri = String(source.config.feed ?? "");
  if (!feedUri) throw new Error("bluesky source missing config.feed");
  const limit = Math.min(source.max_items_per_poll, 100);
  const endpoint = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed");
  endpoint.searchParams.set("feed", feedUri);
  endpoint.searchParams.set("limit", String(limit));
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "Accept-Language": String(source.config.language ?? "en") },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`bluesky ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const json = await response.json();
  const output: any[] = [];
  for (const entry of json.feed ?? []) {
    const post = entry.post;
    if (!post?.uri || !post?.record) continue;
    const publishedAt = shortPublishedAt(post.record.createdAt, source.config.max_age_days);
    if (!publishedAt) continue;
    const labels = [...(post.labels ?? []), ...(post.author?.labels ?? [])].map((l: any) => String(l.val ?? "").toLowerCase());
    if (!source.is_nsfw && labels.some((v: string) => /porn|sexual|nudity|graphic-media/.test(v))) continue;
    if (source.config.adult_labels_only && !labels.some((v: string) => /^(porn|sexual|nudity)$/.test(v))) continue;
    if (!source.is_nsfw && Array.isArray(post.record.langs) && post.record.langs.length > 0 && !post.record.langs.includes("en")) continue;
    const media = bskyMedia(post.embed);
    if (!media || (!media.media_url && !media.poster_url)) continue;
    if (source.config.video_only && media.kind !== "video") continue;
    const rkey = String(post.uri).split("/").pop();
    const handle = post.author?.handle ?? post.author?.did;
    const permalink = `https://bsky.app/profile/${handle}/post/${rkey}`;
    const text = cleanText(post.record.text);
    const title = cleanText(media.linked_title || text || `Post by ${post.author?.displayName ?? handle}`).slice(0, 220);
    output.push({
      external_id: post.uri,
      canonical_id: post.uri,
      kind: media.kind,
      title,
      author: post.author?.displayName || `@${handle}`,
      permalink,
      published_at: publishedAt,
      is_nsfw: source.is_nsfw,
      media_url: media.media_url ?? null,
      media_kind: media.media_kind ?? null,
      poster_url: media.poster_url ?? null,
      aspect_w: media.aspect_w ?? null,
      aspect_h: media.aspect_h ?? null,
      excerpt: cleanText(media.linked_description || text).slice(0, 320) || null,
      score: Number(post.likeCount ?? 0) + Number(post.repostCount ?? 0) * 2 + Number(post.quoteCount ?? 0) * 2,
      comment_count: Number(post.replyCount ?? 0),
    });
  }
  return output;
}

async function fetchMastodon(source: any): Promise<any[]> {
  const instance = String(source.config.instance ?? "mastodon.social").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const mode = String(source.config.mode ?? "trends");
  const limit = Math.min(source.max_items_per_poll, 40);
  let path = `/api/v1/trends/statuses?limit=${limit}`;
  if (mode === "public") path = `/api/v1/timelines/public?only_media=true&limit=${limit}${source.config.local ? "&local=true" : ""}`;
  if (mode === "tag") path = `/api/v1/timelines/tag/${encodeURIComponent(String(source.config.tag ?? "video"))}?only_media=true&limit=${limit}`;
  const response = await fetch(`https://${instance}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "mixdown/1.1 short-feed" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`mastodon ${instance} ${response.status}: ${(await response.text()).slice(0, 220)}`);
  const statuses = await response.json();
  const output: any[] = [];
  for (const raw of statuses ?? []) {
    const status = raw.reblog ?? raw;
    if (!status?.id || !status?.url) continue;
    if (source.config.language && !String(status.language ?? "").startsWith(String(source.config.language))) continue;
    const publishedAt = shortPublishedAt(status.created_at, source.config.max_age_days);
    if (!publishedAt) continue;
    if (!source.is_nsfw && status.sensitive) continue;
    if (source.config.sensitive_only && !status.sensitive) continue;
    const attachments = status.media_attachments ?? [];
    const attachment = attachments.find((a: any) => ["video", "gifv"].includes(a.type)) ?? attachments.find((a: any) => a.type === "image");
    if (!attachment) continue;
    const isVideo = ["video", "gifv"].includes(attachment.type);
    if (source.config.video_only && !isVideo) continue;
    const mediaUrl = isVideo ? (attachment.url ?? attachment.remote_url) : null;
    const poster = isVideo ? (attachment.preview_url ?? attachment.url) : (attachment.url ?? attachment.preview_url);
    if (isVideo && !mediaUrl) continue;
    const text = cleanText(status.content || status.card?.title || status.spoiler_text);
    output.push({
      external_id: `${instance}:${status.id}`,
      canonical_id: status.uri ?? status.url,
      kind: isVideo ? "video" : "social",
      title: (text || `Post by ${status.account?.display_name || status.account?.acct}`).slice(0, 220),
      author: status.account?.display_name || `@${status.account?.acct}`,
      permalink: status.url,
      published_at: publishedAt,
      is_nsfw: source.is_nsfw,
      media_url: mediaUrl,
      media_kind: isVideo ? (mediaKind(mediaUrl) ?? "mp4") : null,
      duration_s: numberValue(attachment.meta?.original?.duration),
      poster_url: poster,
      aspect_w: numberValue(attachment.meta?.original?.width, attachment.meta?.small?.width),
      aspect_h: numberValue(attachment.meta?.original?.height, attachment.meta?.small?.height),
      excerpt: text.slice(0, 320) || null,
      score: Number(status.favourites_count ?? 0) + Number(status.reblogs_count ?? 0) * 2,
      comment_count: Number(status.replies_count ?? 0),
    });
  }
  return output;
}

async function fetchLemmy(source: any): Promise<any[]> {
  const instance = String(source.config.instance ?? "lemmy.world").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const limit = Math.min(source.max_items_per_poll, 50);
  const endpoint = new URL(`https://${instance}/api/v3/post/list`);
  endpoint.searchParams.set("sort", String(source.config.sort ?? "Hot"));
  endpoint.searchParams.set("type_", String(source.config.type ?? "All"));
  endpoint.searchParams.set("limit", String(limit));
  if (source.config.community) endpoint.searchParams.set("community_name", String(source.config.community));
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "mixdown/1.1 short-feed" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`lemmy ${instance} ${response.status}: ${(await response.text()).slice(0, 220)}`);
  const json = await response.json();
  const output: any[] = [];
  for (const view of json.posts ?? []) {
    const post = view.post;
    if (!post?.id || !post?.name) continue;
    const publishedAt = shortPublishedAt(post.published, source.config.max_age_days);
    if (!publishedAt) continue;
    if (!source.is_nsfw && post.nsfw) continue;
    const url = String(post.url ?? "");
    const youtubeId = parseYouTubeId(url);
    const directKind = mediaKind(post.embed_video_url ?? url);
    const image = post.thumbnail_url ?? (isImageUrl(url) ? url : null);
    let kind: "video" | "social" | null = null;
    let media_url: string | null = null;
    let media_kind: string | null = null;
    if (youtubeId) {
      kind = "video";
      media_url = youtubeId;
      media_kind = "youtube_embed";
    } else if (post.embed_video_url || directKind) {
      kind = "video";
      media_url = post.embed_video_url ?? url;
      media_kind = mediaKind(media_url) ?? "mp4";
    } else if (image) {
      kind = "social";
    }
    if (!kind) continue;
    const permalink = `https://${instance}/post/${post.id}`;
    output.push({
      external_id: `${instance}:${post.id}`,
      canonical_id: post.ap_id ?? permalink,
      kind,
      title: cleanText(post.name).slice(0, 220),
      author: view.creator?.display_name || `@${view.creator?.name ?? "lemmy"}`,
      permalink,
      published_at: publishedAt,
      is_nsfw: source.is_nsfw,
      media_url,
      media_kind,
      poster_url: image,
      excerpt: cleanText(post.body).slice(0, 320) || null,
      score: Number(view.counts?.score ?? 0),
      comment_count: Number(view.counts?.comments ?? 0),
    });
  }
  return output;
}

async function fetchPeerTube(source: any): Promise<any[]> {
  const instance = String(source.config.instance ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!instance) throw new Error("peertube_short source missing config.instance");
  const maxDuration = Number(source.config.max_duration_s ?? 180);
  const count = Math.min(Math.max(source.max_items_per_poll * 2, 25), 60);
  const endpoint = new URL(`https://${instance}/api/v1/videos`);
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("sort", String(source.config.sort ?? "-trending"));
  endpoint.searchParams.set("nsfw", source.is_nsfw ? "true" : "false");
  endpoint.searchParams.set("isLive", "false");
  let response = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": "mixdown/1.1 short-feed" }, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    endpoint.searchParams.delete("nsfw");
    endpoint.searchParams.delete("isLive");
    response = await fetch(endpoint, { headers: { Accept: "application/json", "User-Agent": "mixdown/1.1 short-feed" }, signal: AbortSignal.timeout(25_000) });
  }
  if (!response.ok) throw new Error(`peertube ${instance} ${response.status}: ${(await response.text()).slice(0, 220)}`);
  const list = await response.json();
  const candidates = (list.data ?? []).filter((v: any) => Number(v.duration ?? 0) >= 3 && Number(v.duration ?? 0) <= maxDuration).slice(0, source.max_items_per_poll);
  const output: any[] = [];
  const concurrency = 5;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (v: any) => {
      const id = v.shortUUID ?? v.uuid;
      const detailResponse = await fetch(`https://${instance}/api/v1/videos/${id}`, { headers: { Accept: "application/json", "User-Agent": "mixdown/1.1 short-feed" }, signal: AbortSignal.timeout(18_000) });
      if (!detailResponse.ok) throw new Error(`detail ${detailResponse.status}`);
      return await detailResponse.json();
    }));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const v = result.value;
      if (!source.is_nsfw && v.nsfw) continue;
      const publishedAt = shortPublishedAt(v.publishedAt, source.config.max_age_days);
      if (!publishedAt) continue;
      const duration = Number(v.duration ?? 0);
      if (duration < 3 || duration > maxDuration) continue;
      const playlist = (v.streamingPlaylists ?? []).find((p: any) => p.playlistUrl)?.playlistUrl ?? null;
      const file = (v.files ?? v.streamingPlaylists?.[0]?.files ?? []).filter((f: any) => f.fileUrl).sort((a: any, b: any) => Number(b.resolution?.id ?? 0) - Number(a.resolution?.id ?? 0))[0]?.fileUrl ?? null;
      const playable = playlist ?? file;
      if (!playable) continue;
      const id = v.shortUUID ?? v.uuid;
      output.push({
        external_id: `${instance}:${v.uuid}`,
        canonical_id: `peertube:${instance}:${v.uuid}`,
        kind: "video",
        title: cleanText(v.name).slice(0, 220),
        author: v.channel?.displayName ?? v.account?.displayName ?? null,
        permalink: `https://${instance}/w/${id}`,
        published_at: publishedAt,
        is_nsfw: source.is_nsfw,
        media_url: playable,
        media_kind: playlist ? "hls" : "mp4",
        duration_s: Math.round(duration),
        poster_url: v.previewPath ? `https://${instance}${v.previewPath}` : v.thumbnailPath ? `https://${instance}${v.thumbnailPath}` : null,
        aspect_w: numberValue(v.width),
        aspect_h: numberValue(v.height),
        excerpt: cleanText(v.description).slice(0, 320) || null,
        score: Number(v.likes ?? 0) + Math.round(Number(v.views ?? 0) / 50),
        comment_count: Number(v.comments ?? 0),
      });
    }
  }
  return output;
}

const ADAPTERS: Record<string, (source: any) => Promise<any[]>> = {
  bluesky: fetchBluesky,
  mastodon: fetchMastodon,
  lemmy: fetchLemmy,
  peertube_short: fetchPeerTube,
};

async function persist(db: any, source: any, drafts: any[]): Promise<number> {
  if (!drafts.length) return 0;
  const rows: any[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    // Revalidate at the database boundary, even if an adapter regresses.
    const item = datedShortDraft(draft, source.config?.max_age_days);
    if (!item || !item.external_id || !item.title || !item.permalink) continue;
    if (item.kind === "video" && (!item.media_url || !item.media_kind)) continue;
    const key = await contentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const scoring = qualityFor(item);
    rows.push({
      source_id: source.id,
      external_id: String(item.external_id),
      content_key: key,
      kind: item.kind,
      title: String(item.title).slice(0, 300),
      author: item.author ?? null,
      permalink: item.permalink,
      published_at: item.published_at,
      bucket: source.default_bucket,
      is_nsfw: Boolean(item.is_nsfw),
      media_url: item.media_url ?? null,
      media_kind: item.media_kind ?? null,
      duration_s: item.duration_s == null ? null : Math.round(Number(item.duration_s)),
      poster_url: item.poster_url ?? null,
      aspect_w: item.aspect_w == null ? null : Math.round(Number(item.aspect_w)),
      aspect_h: item.aspect_h == null ? null : Math.round(Number(item.aspect_h)),
      body: null,
      excerpt: item.excerpt ?? null,
      comment_count: item.comment_count == null ? null : Math.round(Number(item.comment_count)),
      score: item.score == null ? null : Math.round(Number(item.score)),
      embedding: null,
      ...scoring,
    });
  }
  if (!rows.length) return 0;
  // One malformed upstream post must not poison the entire provider feed.
  // Chunk inserts; on failure, isolate only the individual bad record.
  let written = 0;
  let rejected = 0;
  for (let offset = 0; offset < rows.length; offset += 12) {
    const chunk = rows.slice(offset, offset + 12);
    const { error } = await db.from("items").upsert(chunk, {
      onConflict: "content_key", ignoreDuplicates: true,
    });
    if (!error) { written += chunk.length; continue; }
    for (const row of chunk) {
      const { error: singleError } = await db.from("items").upsert(row, {
        onConflict: "content_key", ignoreDuplicates: true,
      });
      if (singleError) {
        rejected++;
        console.warn(`[ingest-shorts] skipping invalid item ${String(row.external_id).slice(0,100)}: ${singleError.message}`);
      } else written++;
    }
  }
  if (rejected) console.warn(`[ingest-shorts] skipped ${rejected}/${rows.length} malformed or conflicting posts`);
  if (!written && rejected) throw new Error(`No valid items; ${rejected} failed database validation`);
  return written;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) return new Response("forbidden", { status: 403 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "database credentials missing" }, { status: 503 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: sources, error: dueError } = await db.rpc("due_short_sources", { p_limit: 8 });
  if (dueError) return Response.json({ error: dueError.message }, { status: 500 });
  const report: Record<string, string> = {};
  for (const source of sources ?? []) {
    const adapter = ADAPTERS[source.kind];
    if (!adapter) {
      report[source.label] = `unsupported kind ${source.kind}`;
      await db.from("sources").update({ lease_until: null }).eq("id", source.id);
      continue;
    }
    try {
      const drafts = await adapter(source);
      const written = await persist(db, source, drafts);
      await db.from("sources").update({
        last_polled_at: new Date().toISOString(),
        last_error: null,
        consecutive_failures: 0,
        lease_until: null,
      }).eq("id", source.id);
      report[source.label] = `+${written} of ${drafts.length}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.from("sources").update({
        last_polled_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
        consecutive_failures: Number(source.consecutive_failures ?? 0) + 1,
        lease_until: null,
      }).eq("id", source.id);
      report[source.label] = `error: ${message}`;
      console.error(`[${source.label}]`, message);
    }
  }
  return Response.json({ polled: Object.keys(report).length, report });
});
