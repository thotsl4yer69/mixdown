export type SourceKind = "rss" | "peertube" | "reddit" | "youtube" | "direct";
export type ItemKind = "video" | "article" | "social";
export type MediaKind = "mp4" | "hls" | "youtube_embed";

export interface SourceRow {
  id: string;
  kind: SourceKind;
  label: string;
  config: Record<string, unknown>;
  default_bucket: string | null;
  is_nsfw: boolean;
  max_items_per_poll: number;
  consecutive_failures: number;
}

/** A block in the structured body tree. No raw HTML ever reaches the client. */
export type Block =
  | { t: "h"; level: 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "quote"; text: string }
  | { t: "code"; text: string; lang?: string }
  | { t: "li"; text: string; ordered: boolean }
  | { t: "img"; url: string; alt?: string }
  | { t: "hr" };

export interface DraftItem {
  external_id: string;
  kind: ItemKind;
  title: string;
  author?: string | null;
  permalink: string;
  published_at: string;
  is_nsfw: boolean;

  media_url?: string | null;
  media_kind?: MediaKind | null;
  duration_s?: number | null;
  poster_url?: string | null;
  aspect_w?: number | null;
  aspect_h?: number | null;

  body?: Block[] | null;
  excerpt?: string | null;
  comment_count?: number | null;
  score?: number | null;
}

export interface Adapter {
  fetch(source: SourceRow): Promise<DraftItem[]>;
}
