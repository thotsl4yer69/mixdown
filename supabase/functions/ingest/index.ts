// @ts-nocheck

// supabase/functions/ingest/lib/extract.ts
var DROP_TAGS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "form",
  "nav",
  "aside",
  "header",
  "footer",
  "figcaption",
  "button",
  "template"
];
var ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&hellip;": "\u2026",
  "&rsquo;": "\u2019",
  "&lsquo;": "\u2018",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D"
};
function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function preClean(html) {
  let out = html;
  for (const tag2 of DROP_TAGS) {
    out = out.replace(new RegExp(`<${tag2}\\b[^>]*>[\\s\\S]*?</${tag2}>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag2}\\b[^>]*/?>`, "gi"), " ");
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}
var BLOCK_RE = /<(h2|h3|p|blockquote|pre|li|img|hr)\b([^>]*)>([\s\S]*?)<\/\1>|<(img|hr)\b([^>]*?)\/?>/gi;
function htmlToBlocks(html, maxBlocks = 60) {
  const cleaned = preClean(html);
  const blocks = [];
  for (const m of cleaned.matchAll(BLOCK_RE)) {
    if (blocks.length >= maxBlocks) break;
    const tag2 = (m[1] ?? m[4] ?? "").toLowerCase();
    const attrs = m[2] ?? m[5] ?? "";
    const inner = m[3] ?? "";
    switch (tag2) {
      case "h2":
      case "h3": {
        const text = stripTags(inner);
        if (text) blocks.push({ t: "h", level: tag2 === "h2" ? 2 : 3, text });
        break;
      }
      case "p": {
        const text = stripTags(inner);
        if (text.length > 1) blocks.push({ t: "p", text });
        break;
      }
      case "blockquote": {
        const text = stripTags(inner);
        if (text) blocks.push({ t: "quote", text });
        break;
      }
      case "pre": {
        const text = decodeEntities(inner.replace(/<\/?code[^>]*>/gi, "")).replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
        if (text) {
          const lang = /class=["'][^"']*language-([a-z0-9+#-]+)/i.exec(attrs)?.[1];
          blocks.push({ t: "code", text, lang });
        }
        break;
      }
      case "li": {
        const text = stripTags(inner);
        if (text) blocks.push({ t: "li", text, ordered: false });
        break;
      }
      case "img": {
        const url = /src=["']([^"']+)["']/i.exec(attrs)?.[1];
        if (url && /^https?:/i.test(url)) {
          blocks.push({ t: "img", url, alt: /alt=["']([^"']*)["']/i.exec(attrs)?.[1] });
        }
        break;
      }
      case "hr":
        blocks.push({ t: "hr" });
        break;
    }
  }
  if (blocks.length === 0) {
    const flat = stripTags(cleaned);
    if (flat) {
      for (const para of flat.split(/(?<=[.!?])\s+(?=[A-Z])/).reduce((acc, s) => {
        const last = acc[acc.length - 1];
        if (last && last.length < 320) acc[acc.length - 1] = `${last} ${s}`;
        else acc.push(s);
        return acc;
      }, [])) {
        blocks.push({ t: "p", text: para });
        if (blocks.length >= maxBlocks) break;
      }
    }
  }
  return blocks;
}
function markdownToBlocks(md, maxBlocks = 60) {
  const blocks = [];
  const text = decodeEntities(md).replace(/\r\n/g, "\n");
  const chunks = text.split(/\n{2,}/);
  for (const raw of chunks) {
    if (blocks.length >= maxBlocks) break;
    const chunk = raw.trim();
    if (!chunk) continue;
    if (chunk.startsWith("```")) {
      const body = chunk.replace(/^```[a-z0-9+#-]*\n?/i, "").replace(/```$/, "");
      const lang = /^```([a-z0-9+#-]+)/i.exec(chunk)?.[1];
      if (body.trim()) blocks.push({ t: "code", text: body.trimEnd(), lang });
      continue;
    }
    if (/^#{2,6}\s/.test(chunk)) {
      blocks.push({ t: "h", level: chunk.startsWith("###") ? 3 : 2, text: chunk.replace(/^#+\s*/, "") });
      continue;
    }
    if (/^>\s?/.test(chunk)) {
      blocks.push({ t: "quote", text: chunk.replace(/^>\s?/gm, "").trim() });
      continue;
    }
    if (/^([-*]|\d+\.)\s/.test(chunk)) {
      for (const line of chunk.split("\n")) {
        const li = line.replace(/^\s*([-*]|\d+\.)\s+/, "").trim();
        if (li) blocks.push({ t: "li", text: li, ordered: /^\s*\d+\./.test(line) });
      }
      continue;
    }
    if (/^(\*{3}|-{3}|_{3})$/.test(chunk)) {
      blocks.push({ t: "hr" });
      continue;
    }
    blocks.push({ t: "p", text: chunk.replace(/\n/g, " ") });
  }
  return blocks;
}
function excerptOf(blocks, chars = 320) {
  const prose = blocks.filter((b) => b.t === "p").map((b) => b.text).join(" ");
  if (prose.length <= chars) return prose;
  const cut = prose.slice(0, chars);
  return `${cut.slice(0, cut.lastIndexOf(" "))}\u2026`;
}

// Mixdown original-publication validator (mirrors ingest/lib/published.ts).
/**
 * A feed timestamp is a claim about when the publisher released the item.
 * Never replace a missing/invalid publication date with ingestion time.
 * RFC 2822 (RSS) and ISO 8601 (Atom/NewsAPI) both contain a four-digit year.
 */
function sourcePublishedAt(value, now = new Date() {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (!/(?:^|\D)\d{4}(?:\D|$)/.test(raw)) return null;
  // Date.parse normalizes impossible ISO calendar dates (e.g. February 30). Reject them.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > lastDay) return null;
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds) || milliseconds > now.getTime() + 86_400_000) return null;
  return new Date(milliseconds).toISOString();
}

// supabase/functions/ingest/adapters/rss.ts
var UA = "mixdown/1.0 (personal feed reader)";
function tag(xml, name) {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}
function attr(xml, tagName, attrName) {
  const m = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, "i").exec(xml);
  return m?.[1] ?? null;
}
function mediaKindFor(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return "hls";
  if (/\.(mp4|m4v|webm)(\?|$)/i.test(url)) return "mp4";
  return null;
}
var rssAdapter = {
  async fetch(source) {
    const url = String(source.config.url ?? "");
    if (!url) throw new Error("rss source missing config.url");
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!res.ok) throw new Error(`rss ${res.status} ${res.statusText}`);
    const xml = await res.text();
    const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]).slice(0, source.max_items_per_poll);
    const items = [];
    for (const entry of entries) {
      const title = decodeEntities(tag(entry, "title") ?? "").replace(/<[^>]+>/g, "").trim();
      if (!title) continue;
      const link = tag(entry, "link") || attr(entry, "link", "href") || tag(entry, "guid") || "";
      if (!/^https?:/i.test(link)) continue;
      const rawBody = tag(entry, "content:encoded") ?? tag(entry, "content") ?? tag(entry, "description") ?? tag(entry, "summary") ?? "";
      const publishedAt = sourcePublishedAt(tag(entry, "pubDate") ?? tag(entry, "published"));
      if (!publishedAt) continue;
      const enclosureUrl = attr(entry, "enclosure", "url") ?? attr(entry, "media:content", "url") ?? null;
      const mediaKind = enclosureUrl ? mediaKindFor(enclosureUrl) : null;
      const poster = attr(entry, "media:thumbnail", "url") ?? /<img[^>]+src=["']([^"']+)["']/i.exec(rawBody)?.[1] ?? null;
      // A valid publisher date is required; edit time and poll time are not publication time.
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
          poster_url: poster
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
        poster_url: poster
      });
    }
    return items;
  }
};

// supabase/functions/ingest/adapters/peertube.ts
var UA2 = "mixdown/1.0 (personal feed reader)";
var peertubeAdapter = {
  async fetch(source) {
    const instance = String(source.config.instance ?? "").replace(/^https?:\/\//, "");
    if (!instance) throw new Error("peertube source missing config.instance");
    const filter = source.config.filter === "all" ? "" : "&isLocal=true";
    const count = Math.min(source.max_items_per_poll, 25);
    const listUrl = `https://${instance}/api/v1/videos?sort=-publishedAt&count=${count}&nsfw=${source.is_nsfw ? "true" : "false"}${filter}`;
    const listRes = await fetch(listUrl, {
      headers: { "User-Agent": UA2, Accept: "application/json" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!listRes.ok) throw new Error(`peertube list ${listRes.status}`);
    const { data } = await listRes.json();
    const items = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      const slice = data.slice(i, i + CONCURRENCY);
      const details = await Promise.allSettled(
        slice.map(async (v) => {
          const id = v.shortUUID ?? v.uuid;
          const r = await fetch(`https://${instance}/api/v1/videos/${id}`, {
            headers: { "User-Agent": UA2, Accept: "application/json" },
            signal: AbortSignal.timeout(15e3)
          });
          if (!r.ok) throw new Error(`detail ${r.status}`);
          return await r.json();
        })
      );
      for (const result of details) {
        if (result.status !== "fulfilled") continue;
        const v = result.value;
        const hls = v.streamingPlaylists?.find((p) => p.playlistUrl)?.playlistUrl ?? null;
        const progressive = (v.files ?? v.streamingPlaylists?.[0]?.files ?? []).filter((f) => f.fileUrl).sort((a, b) => (b.resolution?.id ?? 0) - (a.resolution?.id ?? 0)).find((f) => (f.resolution?.id ?? 0) <= 720)?.fileUrl ?? null;
        const mediaUrl = hls ?? progressive;
        if (!mediaUrl) continue;
        const id = v.shortUUID ?? v.uuid;
        items.push({
          external_id: `${instance}:${v.uuid}`,
          canonical_id: `peertube:${instance}:${v.uuid}`,
          kind: "video",
          title: v.name,
          author: v.channel?.displayName ?? v.account?.displayName ?? null,
          permalink: `https://${instance}/w/${id}`,
          published_at: new Date(v.publishedAt).toISOString(),
          is_nsfw: source.is_nsfw || v.nsfw,
          media_url: mediaUrl,
          media_kind: hls ? "hls" : "mp4",
          duration_s: v.duration ?? null,
          poster_url: v.previewPath ? `https://${instance}${v.previewPath}` : v.thumbnailPath ? `https://${instance}${v.thumbnailPath}` : null,
          excerpt: v.description?.slice(0, 320) ?? null
        });
      }
    }
    return items;
  }
};

// supabase/functions/ingest/adapters/reddit.ts
var UA3 = "android:mixdown:1.0 (personal feed reader)";
var cachedToken = null;
async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 6e4) {
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
      "User-Agent": UA3
    },
    body,
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`reddit token ${res.status}: ${await res.text()}`);
  const json = await res.json();
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1e3
  };
  return cachedToken.value;
}
var redditAdapter = {
  async fetch(source) {
    const sub = String(source.config.subreddit ?? "");
    if (!sub) throw new Error("reddit source missing config.subreddit");
    const listing = String(source.config.listing ?? "hot");
    const time = source.config.time ? `&t=${source.config.time}` : "";
    const limit = Math.min(source.max_items_per_poll, 100);
    const token = await getToken();
    const res = await fetch(
      `https://oauth.reddit.com/r/${sub}/${listing}?limit=${limit}&raw_json=1${time}`,
      {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA3 },
        signal: AbortSignal.timeout(2e4)
      }
    );
    if (res.status === 401) {
      cachedToken = null;
      throw new Error("reddit 401 \u2014 token rejected, will re-auth next run");
    }
    if (!res.ok) throw new Error(`reddit ${res.status} on r/${sub}`);
    const json = await res.json();
    const items = [];
    for (const { data: p } of json.data.children) {
      if (p.stickied) continue;
      if (p.over_18 && !source.is_nsfw) continue;
      const permalink = `https://www.reddit.com${p.permalink}`;
      const publishedAt = new Date(p.created_utc * 1e3).toISOString();
      const rv = p.secure_media?.reddit_video;
      if (rv?.hls_url || rv?.fallback_url) {
        items.push({
          external_id: p.id,
          canonical_id: `reddit:${p.id}`,
          kind: "video",
          title: decodeEntities(p.title),
          author: `u/${p.author}`,
          permalink,
          published_at: publishedAt,
          is_nsfw: p.over_18,
          media_url: rv.hls_url ?? rv.fallback_url,
          media_kind: rv.hls_url ? "hls" : "mp4",
          duration_s: rv.duration ?? null,
          aspect_w: rv.width ?? null,
          aspect_h: rv.height ?? null,
          poster_url: p.preview?.images?.[0]?.source?.url ?? null,
          comment_count: p.num_comments,
          score: p.score
        });
        continue;
      }
      const blocks = p.selftext?.trim() ? markdownToBlocks(p.selftext) : [];
      const linkOut = p.url_overridden_by_dest;
      if (blocks.length === 0 && !linkOut) continue;
      items.push({
        external_id: p.id,
        canonical_id: `reddit:${p.id}`,
        kind: "social",
        title: decodeEntities(p.title),
        author: `u/${p.author}`,
        permalink,
        published_at: publishedAt,
        is_nsfw: p.over_18,
        body: blocks.length ? blocks : null,
        excerpt: blocks.length ? excerptOf(blocks) : linkOut ?? null,
        poster_url: p.post_hint === "image" ? linkOut ?? null : p.preview?.images?.[0]?.source?.url ?? null,
        comment_count: p.num_comments,
        score: p.score
      });
    }
    return items;
  }
};

// supabase/functions/ingest/adapters/youtube.ts
var API = "https://www.googleapis.com/youtube/v3";
async function resolveChannel(handle, key) {
  const clean = handle.startsWith("@") ? handle : `@${handle}`;
  const res = await fetch(
    `${API}/channels?part=contentDetails&forHandle=${encodeURIComponent(clean)}&key=${key}`,
    { signal: AbortSignal.timeout(15e3) }
  );
  if (!res.ok) throw new Error(`youtube channels ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const first = json.items?.[0];
  const uploads = first?.contentDetails?.relatedPlaylists?.uploads;
  if (!first || !uploads) throw new Error(`youtube: could not resolve handle ${clean}`);
  return { channelId: first.id, uploadsPlaylistId: uploads };
}
function isoDurationSeconds(value) {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}
var youtubeResolutions = /* @__PURE__ */ new Map();
var youtubeAdapter = {
  async fetch(source) {
    const key = Deno.env.get("YOUTUBE_API_KEY");
    if (!key) throw new Error("YOUTUBE_API_KEY not set");
    let uploads = source.config.uploads_playlist_id;
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
      { signal: AbortSignal.timeout(2e4) }
    );
    if (!res.ok) throw new Error(`youtube playlistItems ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const playlistItems = json.items ?? [];
    const ids = playlistItems.map((item) => item.contentDetails.videoId).filter(Boolean);
    const detailMap = /* @__PURE__ */ new Map();
    if (ids.length > 0) {
      const detailsResponse = await fetch(
        `${API}/videos?part=contentDetails,statistics&id=${ids.join(",")}&key=${key}`,
        { signal: AbortSignal.timeout(2e4) }
      );
      if (detailsResponse.ok) {
        const details = await detailsResponse.json();
        for (const detail of details.items ?? []) detailMap.set(detail.id, detail);
      }
    }
    const maxDuration = Number(source.config.max_duration_s ?? (source.config.shorts_only ? 180 : 900));
    return playlistItems.map((v) => {
      const thumbs = v.snippet.thumbnails ?? {};
      const best = Object.values(thumbs).sort((a, b) => b.width - a.width)[0];
      const detail = detailMap.get(v.contentDetails.videoId);
      const duration = isoDurationSeconds(detail?.contentDetails?.duration);
      const views = Number(detail?.statistics?.viewCount ?? 0);
      return {
        external_id: v.contentDetails.videoId,
        canonical_id: `youtube:${v.contentDetails.videoId}`,
        kind: "video",
        title: v.snippet.title,
        author: v.snippet.channelTitle,
        permalink: `https://www.youtube.com/watch?v=${v.contentDetails.videoId}`,
        published_at: new Date(
          v.contentDetails.videoPublishedAt ?? v.snippet.publishedAt
        ).toISOString(),
        is_nsfw: source.is_nsfw,
        // The embed player resolves playback itself; this is an identifier,
        // not a media URL.
        media_url: v.contentDetails.videoId,
        media_kind: "youtube_embed",
        duration_s: duration,
        poster_url: best?.url ?? null,
        excerpt: v.snippet.description?.slice(0, 320) || null,
        score: Number(detail?.statistics?.likeCount ?? 0) || null,
        comment_count: Number(detail?.statistics?.commentCount ?? 0) || null,
        engagement_score: views > 0 ? Math.min(Math.log10(views + 1) / 8, 1) : null
      };
    }).filter((item) => item.duration_s == null || item.duration_s <= maxDuration);
  }
};

// supabase/functions/ingest/adapters/newsapi.ts
var API2 = "https://newsapi.org/v2";
function cleanedText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s*\[\+\d+\s+chars\]$/, "").trim();
  return text ? text : null;
}
function bodyFor(article) {
  const text = cleanedText(article.content) ?? cleanedText(article.description);
  return text ? [{ t: "p", text }] : null;
}
function buildUrl(source) {
  const endpoint = source.config.endpoint ?? "everything";
  if (endpoint !== "everything" && endpoint !== "top-headlines") {
    throw new Error("newsapi source config.endpoint must be everything or top-headlines");
  }
  const url = new URL(`${API2}/${endpoint}`);
  const limit = Math.min(source.max_items_per_poll, 100);
  url.searchParams.set("pageSize", String(limit));
  const params = endpoint === "everything" ? ["q", "searchIn", "sources", "domains", "excludeDomains", "from", "to", "language", "sortBy"] : ["q", "sources", "category", "country"];
  for (const key of params) {
    const value = source.config[key];
    if (typeof value === "string" && value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }
  if (endpoint === "everything" && !url.searchParams.get("q") && !url.searchParams.get("sources")) {
    throw new Error("newsapi everything sources need config.q or config.sources");
  }
  if (endpoint === "top-headlines" && !url.searchParams.get("q") && !url.searchParams.get("sources") && !url.searchParams.get("category") && !url.searchParams.get("country")) {
    url.searchParams.set("country", "us");
  }
  return url;
}
var newsApiAdapter = {
  async fetch(source) {
    const key = Deno.env.get("NEWSAPI_KEY");
    if (!key) throw new Error("NEWSAPI_KEY not set");
    const res = await fetch(buildUrl(source), {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(2e4)
    });
    if (!res.ok) throw new Error(`newsapi ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.status !== "ok") {
      throw new Error(`newsapi ${json.code ?? "error"}: ${json.message ?? "request failed"}`);
    }
    return (json.articles ?? []).map((article) => {
      const url = cleanedText(article.url);
      const title = cleanedText(article.title);
      if (!url || !title) return null;
      const publishedAt = sourcePublishedAt(article.publishedAt);
      if (!publishedAt) return null;
      const excerpt = cleanedText(article.description) ?? cleanedText(article.content);
      return {
        external_id: url,
        kind: "article",
        title,
        author: cleanedText(article.author) ?? cleanedText(article.source?.name) ?? null,
        permalink: url,
        published_at: publishedAt,
        is_nsfw: source.is_nsfw,
        body: bodyFor(article),
        excerpt,
        poster_url: cleanedText(article.urlToImage)
      };
    }).filter((item) => item !== null);
  }
};

// supabase/functions/ingest/adapters/tikhub.ts
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function path(value, ...keys) {
  let current = value;
  for (const key of keys) current = record(current)?.[key];
  return current;
}
function firstString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return null;
}
function candidateRows(payload) {
  const roots = [payload, path(payload, "data"), path(payload, "data", "data")];
  for (const root of roots) {
    if (Array.isArray(root)) return root.map(record).filter((row) => Boolean(row));
    for (const key of ["aweme_list", "item_list", "items", "videos"]) {
      const value = record(root)?.[key];
      if (Array.isArray(value)) return value.map(record).filter((row) => Boolean(row));
    }
  }
  const single = record(path(payload, "data")) ?? record(payload);
  return single ? [single] : [];
}
function mapTikTok(row, isNsfw) {
  const id = firstString(row.aweme_id ?? row.id);
  const video = record(row.video);
  const author = record(row.author);
  const stats = record(row.statistics ?? row.stats);
  const play = firstString(path(video, "play_addr", "url_list") ?? video?.play_url ?? video?.url_list);
  if (!id || !play) return null;
  const cover = firstString(
    path(video, "origin_cover", "url_list") ?? path(video, "cover", "url_list") ?? path(video, "dynamic_cover", "url_list")
  );
  const durationRaw = Number(video?.duration ?? row.duration ?? 0);
  const duration = durationRaw > 1e3 ? durationRaw / 1e3 : durationRaw;
  const created = Number(row.create_time ?? 0);
  const views = Number(stats?.play_count ?? stats?.view_count ?? 0);
  return {
    external_id: id,
    canonical_id: `tiktok:${id}`,
    kind: "video",
    title: firstString(row.desc ?? row.title) ?? `TikTok ${id}`,
    author: firstString(author?.unique_id ?? author?.nickname),
    permalink: `https://www.tiktok.com/@${firstString(author?.unique_id) ?? "user"}/video/${id}`,
    published_at: created > 0 ? new Date(created * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
    is_nsfw: isNsfw,
    media_url: play,
    media_kind: "mp4",
    duration_s: duration > 0 ? Math.round(duration) : null,
    poster_url: cover,
    aspect_w: Number(video?.width ?? 0) || null,
    aspect_h: Number(video?.height ?? 0) || null,
    comment_count: Number(stats?.comment_count ?? 0) || null,
    score: Number(stats?.digg_count ?? 0) || null,
    engagement_score: views > 0 ? Math.min(Math.log10(views + 1) / 8, 1) : null
  };
}
async function tikhubRequest(pathname, params = {}) {
  const key = Deno.env.get("TIKHUB_API_KEY");
  if (!key) throw new Error("TIKHUB_API_KEY not set");
  const endpoint = new URL(`https://api.tikhub.io${pathname}`);
  for (const [keyName, value] of Object.entries(params)) endpoint.searchParams.set(keyName, value);
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(3e4)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`tikhub ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function resolveTikTokUrl(url, isNsfw = false) {
  const payload = await tikhubRequest(
    "/api/v1/tiktok/app/v3/fetch_one_video_by_share_url",
    { share_url: url }
  );
  const row = candidateRows(payload)[0];
  return row ? mapTikTok(row, isNsfw) : null;
}
var tikhubAdapter = {
  async fetch(source) {
    const pathname = String(
      source.config.endpoint ?? "/api/v1/tiktok/web/fetch_trending_post"
    );
    if (!pathname.startsWith("/api/")) throw new Error("invalid TikHub endpoint");
    const params = Object.fromEntries(
      Object.entries(source.config.params ?? {}).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])
    );
    const payload = await tikhubRequest(pathname, params);
    return candidateRows(payload).map((row) => mapTikTok(row, source.is_nsfw)).filter((item) => Boolean(item)).slice(0, source.max_items_per_poll);
  }
};

// supabase/functions/ingest/adapters/virlo.ts
var virloAdapter = {
  async fetch(source) {
    const key = Deno.env.get("VIRLO_API_KEY");
    if (!key) throw new Error("VIRLO_API_KEY not set");
    const platform = String(source.config.platform ?? "videos");
    const segment = ["youtube", "tiktok", "instagram"].includes(platform) ? `${platform}/` : "";
    const endpoint = new URL(`https://api.virlo.ai/v1/${segment}videos/digest`);
    endpoint.searchParams.set("limit", String(Math.min(source.max_items_per_poll, 100)));
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(3e4)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`virlo ${response.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    const output = [];
    for (const video of json.data ?? []) {
      const id = video.external_id ?? video.id;
      if (!id || !video.url) continue;
      if (video.duration != null && video.duration > Number(source.config.max_duration_s ?? 90)) continue;
      const platformName = (video.type ?? platform).toLowerCase();
      if (platformName === "tiktok") {
        try {
          const resolved = await resolveTikTokUrl(video.url, source.is_nsfw);
          if (resolved) {
            output.push({
              ...resolved,
              title: video.description?.slice(0, 140) || resolved.title,
              poster_url: video.thumbnail_url ?? resolved.poster_url,
              score: video.number_of_likes ?? resolved.score,
              comment_count: video.number_of_comments ?? resolved.comment_count,
              engagement_score: video.views ? Math.min(Math.log10(video.views + 1) / 8, 1) : resolved.engagement_score
            });
          }
        } catch {
        }
        continue;
      }
      if (platformName !== "youtube") continue;
      output.push({
        external_id: id,
        canonical_id: `youtube:${id}`,
        kind: "video",
        title: video.description?.slice(0, 140) || `YouTube Short ${id}`,
        author: video.niche ?? "Virlo",
        permalink: video.url,
        published_at: video.publish_date ?? (/* @__PURE__ */ new Date()).toISOString(),
        is_nsfw: source.is_nsfw,
        media_url: id,
        media_kind: "youtube_embed",
        duration_s: video.duration ?? null,
        poster_url: video.thumbnail_url ?? null,
        score: video.number_of_likes ?? null,
        comment_count: video.number_of_comments ?? null,
        engagement_score: video.views ? Math.min(Math.log10(video.views + 1) / 8, 1) : null
      });
    }
    return output;
  }
};

// supabase/functions/ingest/adapters/redgifs.ts
var cachedToken2 = null;
async function redGifsToken() {
  if (cachedToken2 && cachedToken2.expiresAt > Date.now() + 6e4) return cachedToken2.value;
  const response = await fetch("https://api.redgifs.com/v2/auth/temporary", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok) throw new Error(`redgifs auth ${response.status}`);
  const json = await response.json();
  if (!json.token) throw new Error("redgifs temporary token missing");
  cachedToken2 = { value: json.token, expiresAt: Date.now() + 55 * 6e4 };
  return json.token;
}
function idFromUrl(url) {
  const match = url.match(/redgifs\.com\/(?:watch|ifr)\/([a-z0-9]+)/i) ?? url.match(/redgifs\.com\/([a-z0-9]+)(?:[-.](?:mobile|silent))?\.(?:mp4|m3u8)/i);
  return match?.[1]?.toLowerCase() ?? null;
}
async function fetchGif(id) {
  const token = await redGifsToken();
  const response = await fetch(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(2e4)
  });
  if (response.status === 401) {
    cachedToken2 = null;
    return null; // Avoid unbounded recursion on repeated authentication failure.
  }
  if (!response.ok) return null;
  const json = await response.json();
  return json.gif ?? null;
}
function draftFromGif(gif) {
  const id = gif.id?.toLowerCase();
  const mediaUrl = gif.urls?.hd ?? gif.urls?.sd;
  if (!id || !mediaUrl) return null;
  const created = gif.createDate ? new Date(gif.createDate * 1e3) : /* @__PURE__ */ new Date();
  const tags = gif.tags?.slice(0, 4).join(" \xB7 ");
  return {
    external_id: id,
    canonical_id: `redgifs:${id}`,
    kind: "video",
    title: tags || `RedGifs clip ${id}`,
    author: gif.username ? `@${gif.username}` : "RedGifs",
    permalink: `https://www.redgifs.com/watch/${id}`,
    published_at: created.toISOString(),
    is_nsfw: true,
    media_url: mediaUrl,
    media_kind: mediaUrl.includes(".m3u8") ? "hls" : "mp4",
    duration_s: gif.duration ?? null,
    poster_url: gif.urls?.poster ?? gif.urls?.thumbnail ?? null,
    aspect_w: gif.width ?? null,
    aspect_h: gif.height ?? null,
    score: gif.likes ?? null,
    engagement_score: gif.views ? Math.min(Math.log10(gif.views + 1) / 7, 1) : null
  };
}
async function resolveRedGifs(url) {
  const id = idFromUrl(url);
  if (!id) return null;
  const gif = await fetchGif(id);
  return gif ? draftFromGif(gif) : null;
}
var redGifsAdapter = {
  async fetch(source) {
    const terms = Array.isArray(source.config.search_terms) ? source.config.search_terms.map(String).filter(Boolean) : ["amateur"];
    let token = await redGifsToken();
    const limit = Math.min(source.max_items_per_poll, 40);
    const output = [];
    let successfulSearches = 0;
    let lastError = "no search terms";
    for (const term of terms.slice(0, 3)) {
      const endpoint = new URL("https://api.redgifs.com/v2/gifs/search");
      endpoint.searchParams.set("search_text", term);
      endpoint.searchParams.set("count", String(limit));
      endpoint.searchParams.set("page", "1");
      endpoint.searchParams.set("order", "trending");
      let response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(2e4)
      });
      if (response.status === 401 || response.status === 403) {
        cachedToken2 = null;
        token = await redGifsToken();
        response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(2e4)
        });
      }
      if (!response.ok) {
        lastError = `search HTTP ${response.status} for ${term}`;
        continue;
      }
      const json = await response.json();
      successfulSearches++;
      for (const gif of json.gifs ?? []) {
        const resolved = draftFromGif(gif);
        if (resolved) output.push({ ...resolved, is_nsfw: source.is_nsfw });
      }
    }
    if (successfulSearches === 0) throw new Error("redgifs: " + lastError);
    return output.slice(0, limit);
  }
};

// supabase/functions/ingest/lib/apify.ts
async function runApify(source) {
  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token) throw new Error("APIFY_API_TOKEN not set");
  const actor = String(source.config.actor ?? "").replace("/", "~");
  if (!actor) throw new Error(`${source.kind} source missing config.actor`);
  const input = source.config.input ?? {};
  const timeoutSeconds = Math.min(Math.max(Number(source.config.timeout_s ?? 90), 30), 100);
  const response = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?timeout=${timeoutSeconds}&clean=true&format=json`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSeconds + 10) * 1e3)
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`apify ${actor} ${response.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`apify ${actor} returned a non-array dataset`);
  return parsed.filter((row) => Boolean(row && typeof row === "object"));
}
function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function numberValue(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
function parseDuration(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.round(Number(value));
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0));
}

// supabase/functions/ingest/adapters/apify_reddit.ts
function nestedMedia(row) {
  return Array.isArray(row.media) ? row.media.filter((item) => Boolean(item && typeof item === "object")) : [];
}
var apifyRedditAdapter = {
  async fetch(source) {
    if (!source.is_nsfw) throw new Error("apify_reddit is restricted to NSFW sources");
    const rows = await runApify(source);
    const items = [];
    for (const row of rows) {
      const media = nestedMedia(row);
      const mediaRow = media.find((entry) => String(entry.type ?? "").toLowerCase().includes("video")) ?? media[0];
      const candidate = stringValue(
        row.mediaUrl,
        row.videoUrl,
        row.linkUrl,
        mediaRow?.url,
        mediaRow?.videoUrl
      );
      if (!candidate) continue;
      if (/redgifs\.com/i.test(candidate)) {
        const resolved = await resolveRedGifs(candidate);
        if (resolved) {
          items.push({
            ...resolved,
            title: stringValue(row.title, row.postTitle, resolved.title),
            author: stringValue(row.author, resolved.author),
            permalink: stringValue(row.permalink, row.url, resolved.permalink),
            published_at: stringValue(row.created, row.createdAt, resolved.published_at),
            comment_count: numberValue(row.numComments, row.commentCount),
            score: numberValue(row.score, row.ups)
          });
        }
        continue;
      }
      const looksPlayable = /(?:\.mp4(?:\?|$)|\.m3u8(?:\?|$)|v\.redd\.it)/i.test(candidate);
      if (!looksPlayable) continue;
      const id = stringValue(row.id, row.postId);
      const permalink = stringValue(row.permalink, row.url);
      if (!id || !permalink) continue;
      const duration = numberValue(row.duration, mediaRow?.duration);
      const width = numberValue(row.width, mediaRow?.width);
      const height = numberValue(row.height, mediaRow?.height);
      items.push({
        external_id: id,
        canonical_id: `reddit:${id}`,
        kind: "video",
        title: stringValue(row.title, row.postTitle, `Reddit clip ${id}`),
        author: stringValue(row.author),
        permalink,
        published_at: stringValue(row.created, row.createdAt, (/* @__PURE__ */ new Date()).toISOString()),
        is_nsfw: true,
        media_url: candidate,
        media_kind: candidate.includes(".m3u8") ? "hls" : "mp4",
        duration_s: duration == null ? null : Math.round(duration),
        poster_url: stringValue(row.thumbnail, row.poster, mediaRow?.thumbnail),
        aspect_w: width == null ? null : Math.round(width),
        aspect_h: height == null ? null : Math.round(height),
        comment_count: numberValue(row.numComments, row.commentCount),
        score: numberValue(row.score, row.ups)
      });
    }
    return items;
  }
};

// supabase/functions/ingest/adapters/apify_telegram.ts
var apifyTelegramAdapter = {
  async fetch(source) {
    if (!source.is_nsfw) throw new Error("apify_telegram is restricted to NSFW sources");
    const rows = await runApify(source);
    const items = [];
    for (const row of rows) {
      if (row.recordType && row.recordType !== "post") continue;
      const attachments = Array.isArray(row.mediaAttachments) ? row.mediaAttachments.filter(
        (entry) => Boolean(entry && typeof entry === "object")
      ) : [];
      const videos = attachments.filter(
        (entry) => String(entry.type ?? "").toLowerCase().includes("video")
      );
      const mediaUrls = Array.isArray(row.mediaUrls) ? row.mediaUrls.map(String) : [];
      const media = videos[0] ?? (mediaUrls.length > 0 ? { url: mediaUrls[0] } : null);
      const mediaUrl = media ? stringValue(media.url, media.downloadUrl) : null;
      if (!mediaUrl) continue;
      const channel = stringValue(row.channel, row.channelHandle, row.channelUsername, "telegram");
      const id = stringValue(row.id, row.postId);
      const permalink = stringValue(row.url, row.postUrl);
      if (!id || !permalink) continue;
      const text = stringValue(row.text, row.caption);
      items.push({
        external_id: `${channel}:${id}`,
        canonical_id: `telegram:${channel.toLowerCase()}:${id}`,
        kind: "video",
        title: text?.slice(0, 120) || `${channel} clip ${id}`,
        author: `@${channel.replace(/^@/, "")}`,
        permalink,
        published_at: stringValue(row.publishedAt, row.postedAt, row.date, (/* @__PURE__ */ new Date()).toISOString()),
        is_nsfw: true,
        media_url: mediaUrl,
        media_kind: mediaUrl.includes(".m3u8") ? "hls" : "mp4",
        duration_s: numberValue(media.duration, row.duration),
        poster_url: stringValue(media.thumbnailUrl, row.thumbnailUrl, row.previewUrl),
        aspect_w: numberValue(media.width, row.width),
        aspect_h: numberValue(media.height, row.height),
        score: numberValue(row.viewCount, row.views),
        engagement_score: (() => {
          const views = numberValue(row.viewCount, row.views);
          return views == null ? null : Math.min(Math.log10(views + 1) / 6, 1);
        })()
      });
    }
    return items;
  }
};

// supabase/functions/ingest/adapters/apify_tube.ts
function downloadUrl(row) {
  const downloads = Array.isArray(row.downloadUrls) ? row.downloadUrls.filter(
    (entry) => Boolean(entry && typeof entry === "object")
  ) : [];
  const preferred = downloads.filter((entry) => stringValue(entry.videoUrl, entry.url)).sort((a, b) => (numberValue(b.quality) ?? 0) - (numberValue(a.quality) ?? 0))[0];
  const formats = Array.isArray(row.availableFormats) ? row.availableFormats.filter(
    (entry) => Boolean(entry && typeof entry === "object")
  ) : [];
  const preferredFormat = formats.filter((entry) => stringValue(entry.mediaUrl, entry.url)).sort((a, b) => (numberValue(b.height, b.quality) ?? 0) - (numberValue(a.height, a.quality) ?? 0))[0];
  const renditions = Array.isArray(row.hlsRenditions) ? row.hlsRenditions.filter(
    (entry) => Boolean(entry && typeof entry === "object")
  ) : [];
  const preferredRendition = renditions.filter((entry) => stringValue(entry.url)).sort((a, b) => (numberValue(b.height) ?? 0) - (numberValue(a.height) ?? 0))[0];
  return stringValue(
    row.downloadUrl,
    row.previewUrl,
    row.bestM3u8Url,
    row.masterM3u8Url,
    row.hlsUrl,
    row.hls,
    preferredRendition?.url,
    row.mp4High,
    row.mp4Low,
    row.videoUrl,
    row.video_url,
    preferred?.videoUrl,
    preferred?.url,
    preferredFormat?.mediaUrl,
    preferredFormat?.url,
    row.mp4Url
  );
}
var apifyTubeAdapter = {
  async fetch(source) {
    if (!source.is_nsfw) throw new Error("apify_tube is restricted to NSFW sources");
    const rows = await runApify(source);
    const platform = String(source.config.platform ?? "adult-tube").toLowerCase();
    const items = [];
    for (const row of rows) {
      const mediaUrl = downloadUrl(row);
      const permalink = stringValue(row.url, row.sourceUrl, row.pageUrl, row.videoPageUrl);
      const id = stringValue(row.viewKey, row.videoId, row.video_id, row.id);
      if (!mediaUrl || !permalink || !id) continue;
      const duration = parseDuration(row.duration ?? row.durationSeconds ?? row.durationFormatted);
      const views = numberValue(row.views, row.viewCount);
      const votes = numberValue(row.upVotes, row.likes, row.rating);
      items.push({
        external_id: `${platform}:${id}`,
        canonical_id: `${platform}:${id}`,
        kind: "video",
        title: stringValue(row.title, `${platform} clip ${id}`),
        author: stringValue(row.channelName, row.uploader, row.author),
        permalink,
        published_at: stringValue(
          row.uploadDate,
          row.publishedAt,
          row.scrapedAt,
          row.fetchedAt,
          (/* @__PURE__ */ new Date()).toISOString()
        ),
        is_nsfw: true,
        media_url: mediaUrl,
        media_kind: mediaUrl.includes(".m3u8") ? "hls" : "mp4",
        duration_s: duration,
        poster_url: stringValue(row.thumbnailUrl, row.thumbnail, row.posterUrl),
        aspect_w: numberValue(row.width),
        aspect_h: numberValue(row.height),
        score: votes,
        engagement_score: views == null ? null : Math.min(Math.log10(views + 1) / 8, 1)
      });
    }
    return items;
  }
};

// supabase/functions/ingest/lib/quality.ts
var LOW_SIGNAL_TITLE = /^(untitled|deleted|removed|test|video|clip|post)$/i;
var SPAM_TITLE = /(?:free\s+crypto|giveaway|whatsapp|telegram\s+me|click\s+here|promo\s+code)/i;
function clamp(value) {
  return Math.min(Math.max(value, 0), 1);
}
function engagementScore(item) {
  if (item.engagement_score != null) return clamp(item.engagement_score);
  const score = Math.max(item.score ?? 0, 0);
  const comments = Math.max(item.comment_count ?? 0, 0);
  return clamp(Math.log10(score + 1) / 5 * 0.75 + Math.log10(comments + 1) / 4 * 0.25);
}
function visualScore(item) {
  if (item.visual_score != null) return clamp(item.visual_score);
  const w = item.aspect_w ?? 0;
  const h = item.aspect_h ?? 0;
  const aspect = w > 0 && h > 0 ? h / w : null;
  const orientation = aspect == null ? 0.55 : aspect >= 1.35 ? 1 : aspect >= 1 ? 0.72 : 0.25;
  const poster = item.poster_url ? 1 : 0.35;
  return clamp(orientation * 0.72 + poster * 0.28);
}
function durationScore(item) {
  if (item.kind !== "video") return 0.5;
  const duration = item.duration_s;
  if (duration == null) return 0.48;
  if (duration >= 5 && duration <= 45) return 1;
  if (duration >= 3 && duration <= 90) return 0.88;
  if (duration <= 180) return 0.56;
  return 0.1;
}
function prepareDraft(item, source) {
  const title = item.title.trim().replace(/\s+/g, " ");
  if (title.length < 2 || LOW_SIGNAL_TITLE.test(title) || SPAM_TITLE.test(title)) return null;
  if (item.kind === "video") {
    if (!item.media_url || !item.media_kind) return null;
    const maxDuration = Number(source.config.max_duration_s ?? (source.is_nsfw ? 180 : 240));
    if (item.duration_s != null && item.duration_s > maxDuration) return null;
    if (item.duration_s != null && item.duration_s < 2) return null;
  }
  const visual = visualScore(item);
  const engagement = engagementScore(item);
  const completeness = clamp(
    (item.permalink ? 0.25 : 0) + (item.title ? 0.2 : 0) + (item.kind !== "video" || item.media_url ? 0.3 : 0) + (item.poster_url ? 0.25 : 0)
  );
  const sourceBoost = clamp(Number(source.config.quality_boost ?? 0.5));
  const quality = clamp(
    durationScore(item) * 0.3 + visual * 0.26 + engagement * 0.24 + completeness * 0.14 + sourceBoost * 0.06
  );
  const minimum = clamp(Number(source.config.min_quality ?? (source.is_nsfw ? 0.42 : 0.34)));
  if (quality < minimum) return null;
  return {
    ...item,
    title,
    quality_score: quality,
    visual_score: visual,
    engagement_score: engagement
  };
}
function normalizedIdentity(item) {
  if (item.canonical_id?.trim()) return item.canonical_id.trim().toLowerCase();
  try {
    const url = new URL(item.permalink);
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/$/, "").toLowerCase();
    // Strip *only* known tracking keys. For many publishers ?p=123,
    // ?article=... or other opaque parameters ARE the article identity.
    // Sort retained pairs so harmless parameter reordering deduplicates.
    const trackingKey = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|yclid)$/i;
    const identifying = Array.from(url.searchParams.entries())
      .filter(([key, value]) => value !== "" && !trackingKey.test(key))
      .sort(([ka, va], [kb, vb]) => ka.localeCompare(kb) || va.localeCompare(vb));
    const query = new URLSearchParams(identifying).toString();
    return `${host}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return `${item.external_id}:${item.permalink}`.toLowerCase();
  }
}
async function contentKeyFor(item) {
  const bytes = new TextEncoder().encode(normalizedIdentity(item));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// supabase/functions/ingest/index.ts
var ADAPTERS = {
  rss: rssAdapter,
  peertube: peertubeAdapter,
  reddit: redditAdapter,
  youtube: youtubeAdapter,
  newsapi: newsApiAdapter,
  tikhub: tikhubAdapter,
  virlo: virloAdapter,
  redgifs: redGifsAdapter,
  apify_reddit: apifyRedditAdapter,
  apify_telegram: apifyTelegramAdapter,
  apify_tube: apifyTubeAdapter,
  direct: {
    // A 'direct' source is a single fixed media URL. Polling it re-asserts the
    // row rather than discovering anything, which is what makes it useful as a
    // playback smoke test.
    fetch(source) {
      const url = String(source.config.url ?? "");
      if (!url) throw new Error("direct source missing config.url");
      const publishedAt = sourcePublishedAt(source.config.published_at);
      if (!publishedAt) return Promise.resolve([]);
      return Promise.resolve([
        {
          external_id: url,
          canonical_id: `direct:${url}`,
          kind: "video",
          title: String(source.config.title ?? source.label),
          permalink: url,
          published_at: publishedAt,
          is_nsfw: source.is_nsfw,
          media_url: url,
          media_kind: source.config.media_kind ?? "mp4",
          poster_url: source.config.poster_url ?? null
        }
      ]);
    }
  }
};
var MIN_RUN_INTERVAL_MS = 15 * 1e3;
var lastRunAt = 0;
var running = false;
function integerOrNull(value) {
  return value == null || !Number.isFinite(value) ? null : Math.round(value);
}
async function dbFetch(db, path2, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("apikey", db.key);
  headers.set("Authorization", `Bearer ${db.key}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const response = await fetch(`${db.url}/rest/v1/${path2}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`database ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}
async function persist(db, source, drafts) {
  if (drafts.length === 0) return 0;
  const rows = [];
  for (const d of drafts) {
    const prepared = prepareDraft(d, source);
    if (!prepared) continue;
    rows.push({
      source_id: source.id,
      external_id: prepared.external_id,
      content_key: await contentKeyFor(prepared),
      kind: prepared.kind,
      title: prepared.title,
      author: prepared.author ?? null,
      permalink: prepared.permalink,
      published_at: prepared.published_at,
      bucket: source.default_bucket,
      is_nsfw: prepared.is_nsfw,
      media_url: prepared.media_url ?? null,
      media_kind: prepared.media_kind ?? null,
      duration_s: integerOrNull(prepared.duration_s),
      poster_url: prepared.poster_url ?? null,
      aspect_w: integerOrNull(prepared.aspect_w),
      aspect_h: integerOrNull(prepared.aspect_h),
      body: prepared.body ?? null,
      excerpt: prepared.excerpt ?? null,
      comment_count: integerOrNull(prepared.comment_count),
      score: integerOrNull(prepared.score),
      quality_score: prepared.quality_score ?? 0.5,
      visual_score: prepared.visual_score ?? 0.5,
      engagement_score: prepared.engagement_score ?? 0,
      // Keep ingestion inside the free Edge Function CPU budget. Ranking has
      // a neutral similarity fallback for null embeddings, so recency,
      // bucket preference and exploration still produce a useful feed.
      embedding: null
    });
  }
  if (rows.length === 0) return 0;
  const dedupedRows = Array.from(
    new Map(rows.map((row) => [row.content_key, row])).values()
  );
  // One conflicting legacy source_id/external_id previously failed the
  // entire publisher. Degrade to per-item writes only when the batch fails;
  // skip unique-conflicting legacy rows, retaining all healthy new items.
  let accepted = 0;
  let skippedConflicts = 0;
  for (let i = 0; i < dedupedRows.length; i += 12) {
    const batch = dedupedRows.slice(i, i + 12);
    const submit = (rows) => dbFetch(
      db,
      "items?on_conflict=content_key",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows)
      }
    );
    try {
      await submit(batch);
      accepted += batch.length;
    } catch (batchError) {
      for (const row of batch) {
        try {
          await submit([row]);
          accepted++;
        } catch (rowError) {
          if (/database 409:.*(23505|duplicate key)/i.test(String(rowError))) {
            skippedConflicts++;
            continue;
          }
          throw rowError;
        }
      }
    }
  }
  if (skippedConflicts) {
    console.warn("[ingest] skipped conflicting existing rows", source.label, skippedConflicts);
  }
  return accepted;
}
Deno.serve(async (req) => {
  const secret = Deno.env.get("INGEST_SECRET");
  if (secret && req.headers.get("x-ingest-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const now = Date.now();
  if (running || now - lastRunAt < MIN_RUN_INTERVAL_MS) {
    return Response.json({ error: "ingest already running or recently started" }, { status: 429 });
  }
  running = true;
  lastRunAt = now;
  try {
    const db = {
      url: Deno.env.get("SUPABASE_URL"),
      key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    };
    const sources = await dbFetch(db, "rpc/due_sources", {
      method: "POST",
      body: "{}"
    });
    const report = {};
    for (const source of sources ?? []) {
      const adapter = ADAPTERS[source.kind];
      if (!adapter) {
        report[source.label] = `no adapter for kind ${source.kind}`;
        await dbFetch(db, `sources?id=eq.${encodeURIComponent(source.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ lease_until: null })
        });
        continue;
      }
      try {
        const drafts = await adapter.fetch(source);
        const written = await persist(db, source, drafts);
        const resolved = youtubeResolutions.get(source.id);
        const configPatch = resolved ? {
          config: {
            ...source.config,
            channel_id: resolved.channelId,
            uploads_playlist_id: resolved.uploadsPlaylistId
          }
        } : {};
        await dbFetch(db, `sources?id=eq.${encodeURIComponent(source.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            last_polled_at: (/* @__PURE__ */ new Date()).toISOString(),
            last_error: null,
            consecutive_failures: 0,
            lease_until: null,
            ...configPatch
          })
        });
        report[source.label] = `+${written} of ${drafts.length}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await dbFetch(db, `sources?id=eq.${encodeURIComponent(source.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            last_polled_at: (/* @__PURE__ */ new Date()).toISOString(),
            last_error: message.slice(0, 500),
            consecutive_failures: source.consecutive_failures + 1,
            lease_until: null
          })
        });
        report[source.label] = `error: ${message}`;
        console.error(`[${source.label}]`, message);
      }
    }
    await dbFetch(db, "rpc/prune", {
      method: "POST",
      body: JSON.stringify({ p_keep_days: 45 })
    });
    return Response.json({ polled: Object.keys(report).length, report });
  } catch (err) {
    console.error("ingest failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    running = false;
  }
});
