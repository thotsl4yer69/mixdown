import type { Adapter, DraftItem, SourceRow } from "../../_shared/types.ts";

const UA = "mixdown/1.0 (personal feed reader)";

interface PtVideo {
  uuid: string;
  shortUUID?: string;
  name: string;
  description: string | null;
  duration: number;
  publishedAt: string;
  nsfw: boolean;
  thumbnailPath: string | null;
  previewPath: string | null;
  account?: { displayName?: string; name?: string };
  channel?: { displayName?: string };
}

interface PtStreaming {
  playlistUrl?: string;
  files?: { fileUrl?: string; resolution?: { id?: number } }[];
}

interface PtDetail extends PtVideo {
  streamingPlaylists?: PtStreaming[];
  files?: { fileUrl?: string; resolution?: { id?: number } }[];
}

/**
 * PeerTube exposes a documented REST API and, critically, stable direct media
 * URLs — an HLS master playlist or a progressive MP4 per resolution. Those are
 * cacheable, which is what makes this the fast playback lane.
 *
 * We prefer HLS (segmented, seeks better under prefetch) and fall back to the
 * 720p-or-below progressive file to keep decode cost down on a scrolling feed.
 */
export const peertubeAdapter: Adapter = {
  async fetch(source: SourceRow): Promise<DraftItem[]> {
    const instance = String(source.config.instance ?? "").replace(/^https?:\/\//, "");
    if (!instance) throw new Error("peertube source missing config.instance");

    const filter = source.config.filter === "all" ? "" : "&isLocal=true";
    const count = Math.min(source.max_items_per_poll, 25);
    const listUrl =
      `https://${instance}/api/v1/videos` +
      `?sort=-publishedAt&count=${count}&nsfw=${source.is_nsfw ? "true" : "false"}${filter}`;

    const listRes = await fetch(listUrl, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!listRes.ok) throw new Error(`peertube list ${listRes.status}`);

    const { data } = (await listRes.json()) as { data: PtVideo[] };
    const items: DraftItem[] = [];

    // Detail fetches are sequential-with-concurrency-cap: PeerTube instances are
    // volunteer-run and will rate-limit a burst.
    const CONCURRENCY = 4;
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const slice = data.slice(i, i + CONCURRENCY);
      const details = await Promise.allSettled(
        slice.map(async (v) => {
          const id = v.shortUUID ?? v.uuid;
          const r = await fetch(`https://${instance}/api/v1/videos/${id}`, {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) throw new Error(`detail ${r.status}`);
          return (await r.json()) as PtDetail;
        }),
      );

      for (const result of details) {
        if (result.status !== "fulfilled") continue;
        const v = result.value;

        const hls = v.streamingPlaylists?.find((p) => p.playlistUrl)?.playlistUrl ?? null;

        const progressive = (v.files ?? v.streamingPlaylists?.[0]?.files ?? [])
          .filter((f) => f.fileUrl)
          .sort((a, b) => (b.resolution?.id ?? 0) - (a.resolution?.id ?? 0))
          .find((f) => (f.resolution?.id ?? 0) <= 720)?.fileUrl ?? null;

        const mediaUrl = hls ?? progressive;
        if (!mediaUrl) continue;

        const id = v.shortUUID ?? v.uuid;
        items.push({
          external_id: `${instance}:${v.uuid}`,
          kind: "video",
          title: v.name,
          author: v.channel?.displayName ?? v.account?.displayName ?? null,
          permalink: `https://${instance}/w/${id}`,
          published_at: new Date(v.publishedAt).toISOString(),
          is_nsfw: source.is_nsfw || v.nsfw,
          media_url: mediaUrl,
          media_kind: hls ? "hls" : "mp4",
          duration_s: v.duration ?? null,
          poster_url: v.previewPath
            ? `https://${instance}${v.previewPath}`
            : v.thumbnailPath
            ? `https://${instance}${v.thumbnailPath}`
            : null,
          excerpt: v.description?.slice(0, 320) ?? null,
        });
      }
    }

    return items;
  },
};
