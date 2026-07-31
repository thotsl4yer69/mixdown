export type ItemKind = "video" | "article" | "social";
export type MediaKind = "mp4" | "hls" | "youtube_embed";
export type Lane = "learn" | "play";

export type Block =
  | { t: "h"; level: 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "quote"; text: string }
  | { t: "code"; text: string; lang?: string }
  | { t: "li"; text: string; ordered: boolean }
  | { t: "img"; url: string; alt?: string }
  | { t: "hr" };

export interface FeedItem {
  id: string;
  kind: ItemKind;
  title: string;
  author: string | null;
  permalink: string;
  published_at: string;
  bucket: string | null;
  lane: Lane;
  is_nsfw: boolean;

  media_url: string | null;
  media_kind: MediaKind | null;
  duration_s: number | null;
  poster_url: string | null;

  body: Block[] | null;
  excerpt: string | null;

  score: number;
}

export interface TopicBucket {
  key: string;
  label: string;
  weight: number;
  lane: Lane;
  enabled: boolean;
  sort_order: number;
}

export interface Prefs {
  nsfw_mode: boolean;
  drift: number;
  halflife_hours: number;
  sim_weight: number;
  recency_weight: number;
  explore: number;
  page_size: number;
  preload_ahead: number;
  decoder_slots: number;
  autoplay_muted: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  nsfw_mode: false,
  drift: 0.45,
  halflife_hours: 72,
  sim_weight: 0.55,
  recency_weight: 0.3,
  explore: 0.15,
  page_size: 20,
  preload_ahead: 6,
  decoder_slots: 3,
  autoplay_muted: true,
};
