import type { Adapter, DraftItem, SourceRow, MediaKind } from "../../_shared/types.ts";
import { htmlToBlocks, excerptOf, decodeEntities } from "../lib/extract.ts";

const UA = "mixdown/1.0 (personal feed reader)";

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

function attr(xml: string, tagName: string, attrName: string): string | null {
  const m = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, "i").exec(xml);
  return m?.[1] ?? null;
}

function mediaKindFor(url: string): MediaKind | null {
  if (/\.m3u8(\?|$)/i.test(url)) return "hls";
  if (/\.(mp4|m4v|webm)(\?|$)/i.test(url)) return "mp4";
  return null;
}

/**
 * Handles RSS 2.0 and Atom in one pass. Video is detected from
 * <enclosure>, <media:content>, or a media-typed <link rel="enclosure">,
 * which is how podcast and PeerTube-syndicated feeds carry direct MP4s.
 */
export const rssAdapter: Adapter = {
  async fetch(source: SourceRow): Promise<DraftItem[]> {
    const url = String(source.config.url ?? "");
    if (!url) throw new Error("rss source missing config.url");

    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`rss ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((m) => m[2])
      .slice(0, source.max_items_per_poll);

    const items: DraftItem[] = [];

    for (const entry of entries) {
      const title = decodeEntities(tag(entry, "title") ?? "").replace(/<[^>]+>/g, "").trim();
      if (!title) continue;

      const link =
        tag(entry, "link") ||
        attr(entry, "link", "href") ||
        tag(entry, "guid") ||
        "";
      if (!/^https?:/i.test(link)) continue;

      const rawBody =
        tag(entry, "content:encoded") ??
        tag(entry, "content") ??
        tag(entry, "description") ??
        tag(entry, "summary") ??
        "";

      const published =
        tag(entry, "pubDate") ??
        tag(entry, "published") ??
        tag(entry, "updated") ??
        new Date().toISOString();

      const enclosureUrl =
        attr(entry, "enclosure", "url") ??
        attr(entry, "media:content", "url") ??
        null;

      const mediaKind = enclosureUrl ? mediaKindFor(enclosureUrl) : null;
      const poster =
        attr(entry, "media:thumbnail", "url") ??
        /<img[^>]+src=["']([^"']+)["']/i.exec(rawBody)?.[1] ??
        null;

      const parsedDate = new Date(published);
      const publishedAt = Number.isNaN(parsedDate.getTime())
        ? new Date().toISOString()
        : parsedDate.toISOString();

      if (mediaKind && enclosureUrl) {
        const durAttr = attr(entry, "media:content", "duration");
        items.push({
          external_id: link,
          kind: "video",
          title,
          author: tag(entry, "dc:creator") ?? tag(entry, "author") ?? null,
          permalink: link,
          published_at: publishedAt,
          is_nsfw: source.is_nsfw,
          media_url: enclosureUrl,
          media_kind: mediaKind,
          duration_s: durAttr ? Number(durAttr) || null : null,
          poster_url: poster,
        });
        continue;
      }

      const blocks = htmlToBlocks(rawBody);
      if (blocks.length === 0) continue;

      items.push({
        external_id: link,
        kind: "article",
        title,
        author: tag(entry, "dc:creator") ?? tag(entry, "author") ?? null,
        permalink: link,
        published_at: publishedAt,
        is_nsfw: source.is_nsfw,
        body: blocks,
        excerpt: excerptOf(blocks),
        poster_url: poster,
      });
    }

    return items;
  },
};
