import type { Adapter, DraftItem, SourceRow } from "../../_shared/types.ts";
import { sourcePublishedAt } from "../lib/published.ts";

/** Fixed test-media URLs are not proof of a new publication on every poll. */
export const directAdapter: Adapter = {
  fetch(source: SourceRow): Promise<DraftItem[]> {
    const url = String(source.config.url ?? "");
    if (!url) throw new Error("direct source missing config.url");
    // Existing un-dated smoke-test sources remain configured but do not enter
    // the public feed with a fabricated "published today" timestamp.
    const publishedAt = sourcePublishedAt(source.config.published_at);
    if (!publishedAt) return Promise.resolve([]);
    return Promise.resolve([{
      external_id: url,
      canonical_id: `direct:${url}`,
      kind: "video",
      title: String(source.config.title ?? source.label),
      permalink: url,
      published_at: publishedAt,
      is_nsfw: source.is_nsfw,
      media_url: url,
      media_kind: (source.config.media_kind as "mp4" | "hls") ?? "mp4",
      poster_url: (source.config.poster_url as string) ?? null,
    }]);
  },
};
