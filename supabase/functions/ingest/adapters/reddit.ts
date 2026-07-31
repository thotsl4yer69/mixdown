import type { Adapter, DraftItem, SourceRow } from "../../_shared/types.ts";
import { markdownToBlocks, excerptOf, decodeEntities } from "../lib/extract.ts";

const UA = "android:mixdown:1.0 (personal feed reader)";

/**
 * Reddit requires OAuth for anything useful. We use the client_credentials
 * grant ("application only" auth), which needs no user login and is the right
 * fit for a single-user ingestion worker.
 *
 * NOTE: application-only tokens cannot read over_18 content. If you add NSFW
 * subreddits you must switch REDDIT_GRANT to "password" and supply
 * REDDIT_USERNAME / REDDIT_PASSWORD for an account that has opted in to adult
 * content in its Reddit preferences. The code below handles both grants.
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const id = Deno.env.get("REDDIT_CLIENT_ID");
  const secret = Deno.env.get("REDDIT_CLIENT_SECRET");
  if (!id || !secret) throw new Error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set");

  const grant = Deno.env.get("REDDIT_GRANT") ?? "client_credentials";
  const body = new URLSearchParams();

  if (grant === "password") {
    const user = Deno.env.get("REDDIT_USERNAME");
    const pass = Deno.env.get("REDDIT_PASSWORD");
    if (!user || !pass) throw new Error("password grant needs REDDIT_USERNAME / REDDIT_PASSWORD");
    body.set("grant_type", "password");
    body.set("username", user);
    body.set("password", pass);
  } else {
    body.set("grant_type", "client_credentials");
  }

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`reddit token ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

interface RedditPost {
  id: string;
  title: string;
  author: string;
  permalink: string;
  created_utc: number;
  over_18: boolean;
  selftext: string;
  url_overridden_by_dest?: string;
  num_comments: number;
  score: number;
  stickied: boolean;
  is_self: boolean;
  post_hint?: string;
  preview?: { images?: { source?: { url?: string } }[] };
  secure_media?: {
    reddit_video?: { hls_url?: string; fallback_url?: string; duration?: number; width?: number; height?: number };
  };
}

export const redditAdapter: Adapter = {
  async fetch(source: SourceRow): Promise<DraftItem[]> {
    const sub = String(source.config.subreddit ?? "");
    if (!sub) throw new Error("reddit source missing config.subreddit");

    const listing = String(source.config.listing ?? "hot");
    const time = source.config.time ? `&t=${source.config.time}` : "";
    const limit = Math.min(source.max_items_per_poll, 100);

    const token = await getToken();
    const res = await fetch(
      `https://oauth.reddit.com/r/${sub}/${listing}?limit=${limit}&raw_json=1${time}`,
      {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (res.status === 401) {
      cachedToken = null;
      throw new Error("reddit 401 — token rejected, will re-auth next run");
    }
    if (!res.ok) throw new Error(`reddit ${res.status} on r/${sub}`);

    const json = (await res.json()) as { data: { children: { data: RedditPost }[] } };
    const items: DraftItem[] = [];

    for (const { data: p } of json.data.children) {
      if (p.stickied) continue;

      // Hard gate: an over_18 post never enters the feed through a source that
      // isn't itself flagged NSFW, regardless of which subreddit it came from.
      if (p.over_18 && !source.is_nsfw) continue;

      const permalink = `https://www.reddit.com${p.permalink}`;
      const publishedAt = new Date(p.created_utc * 1000).toISOString();
      const rv = p.secure_media?.reddit_video;

      if (rv?.hls_url || rv?.fallback_url) {
        items.push({
          external_id: p.id,
          kind: "video",
          title: decodeEntities(p.title),
          author: `u/${p.author}`,
          permalink,
          published_at: publishedAt,
          is_nsfw: p.over_18,
          media_url: rv.hls_url ?? rv.fallback_url!,
          media_kind: rv.hls_url ? "hls" : "mp4",
          duration_s: rv.duration ?? null,
          aspect_w: rv.width ?? null,
          aspect_h: rv.height ?? null,
          poster_url: p.preview?.images?.[0]?.source?.url ?? null,
          comment_count: p.num_comments,
          score: p.score,
        });
        continue;
      }

      const blocks = p.selftext?.trim() ? markdownToBlocks(p.selftext) : [];
      const linkOut = p.url_overridden_by_dest;

      // Link posts with no body still carry signal via title + destination.
      if (blocks.length === 0 && !linkOut) continue;

      items.push({
        external_id: p.id,
        kind: "social",
        title: decodeEntities(p.title),
        author: `u/${p.author}`,
        permalink,
        published_at: publishedAt,
        is_nsfw: p.over_18,
        body: blocks.length ? blocks : null,
        excerpt: blocks.length ? excerptOf(blocks) : (linkOut ?? null),
        poster_url:
          p.post_hint === "image"
            ? linkOut ?? null
            : p.preview?.images?.[0]?.source?.url ?? null,
        comment_count: p.num_comments,
        score: p.score,
      });
    }

    return items;
  },
};
