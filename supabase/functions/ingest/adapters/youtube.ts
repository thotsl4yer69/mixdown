import type { Adapter, DraftItem, SourceRow } from "../../_shared/types.ts";

const API = "https://www.googleapis.com/youtube/v3";

/**
 * Official Data API only, and deliberately quota-frugal.
 *
 * search.list costs 100 units per call — at a 10,000/day quota that is 100
 * calls and nothing else. playlistItems.list costs 1 unit. So we resolve the
 * channel's uploads playlist once, cache the ID back into sources.config, and
 * poll the playlist thereafter. Twenty channels polled hourly costs ~480
 * units/day instead of ~48,000.
 *
 * Playback is via the embedded IFrame player. We never touch the media URL —
 * that is the whole point. These items get media_kind 'youtube_embed' and the
 * client routes them away from the Media3 preload path.
 */

interface ResolveResult {
  channelId: string;
  uploadsPlaylistId: string;
}

async function resolveChannel(handle: string, key: string): Promise<ResolveResult> {
  const clean = handle.startsWith("@") ? handle : `@${handle}`;

  // forHandle is 1 unit and exists specifically so you don't need search.list.
  const res = await fetch(
    `${API}/channels?part=contentDetails&forHandle=${encodeURIComponent(clean)}&key=${key}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`youtube channels ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as {
    items?: { id: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };

  const first = json.items?.[0];
  const uploads = first?.contentDetails?.relatedPlaylists?.uploads;
  if (!first || !uploads) throw new Error(`youtube: could not resolve handle ${clean}`);

  return { channelId: first.id, uploadsPlaylistId: uploads };
}

interface PlaylistItem {
  contentDetails: { videoId: string; videoPublishedAt?: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
    thumbnails?: Record<string, { url: string; width: number; height: number }>;
  };
}

/**
 * Returned so the caller can persist newly resolved IDs. Keeping this out of
 * the adapter's return type would mean re-resolving every poll.
 */
export const youtubeResolutions = new Map<string, ResolveResult>();

export const youtubeAdapter: Adapter = {
  async fetch(source: SourceRow): Promise<DraftItem[]> {
    const key = Deno.env.get("YOUTUBE_API_KEY");
    if (!key) throw new Error("YOUTUBE_API_KEY not set");

    let uploads = source.config.uploads_playlist_id as string | undefined;

    if (!uploads) {
      const handle = String(source.config.handle ?? "");
      if (!handle) throw new Error("youtube source needs config.handle or config.uploads_playlist_id");
      const resolved = await resolveChannel(handle, key);
      uploads = resolved.uploadsPlaylistId;
      youtubeResolutions.set(source.id, resolved);
    }

    const limit = Math.min(source.max_items_per_poll, 50);
    const res = await fetch(
      `${API}/playlistItems?part=snippet,contentDetails&playlistId=${uploads}&maxResults=${limit}&key=${key}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`youtube playlistItems ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as { items?: PlaylistItem[] };

    return (json.items ?? []).map((v) => {
      const thumbs = v.snippet.thumbnails ?? {};
      const best = Object.values(thumbs).sort((a, b) => b.width - a.width)[0];

      return {
        external_id: v.contentDetails.videoId,
        kind: "video" as const,
        title: v.snippet.title,
        author: v.snippet.channelTitle,
        permalink: `https://www.youtube.com/watch?v=${v.contentDetails.videoId}`,
        published_at: new Date(
          v.contentDetails.videoPublishedAt ?? v.snippet.publishedAt,
        ).toISOString(),
        is_nsfw: source.is_nsfw,
        // The embed player resolves playback itself; this is an identifier,
        // not a media URL.
        media_url: v.contentDetails.videoId,
        media_kind: "youtube_embed" as const,
        poster_url: best?.url ?? null,
        excerpt: v.snippet.description?.slice(0, 320) || null,
      };
    });
  },
};
