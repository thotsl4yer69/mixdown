import type { Adapter, Block, DraftItem, SourceRow } from "../../_shared/types.ts";

const API = "https://newsapi.org/v2";

type Endpoint = "everything" | "top-headlines";

interface NewsApiArticle {
  source?: { id?: string | null; name?: string | null };
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  urlToImage?: string | null;
  publishedAt?: string | null;
  content?: string | null;
}

function cleanedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s*\[\+\d+\s+chars\]$/, "").trim();
  return text ? text : null;
}

function bodyFor(article: NewsApiArticle): Block[] | null {
  const text = cleanedText(article.content) ?? cleanedText(article.description);
  return text ? [{ t: "p", text }] : null;
}

function buildUrl(source: SourceRow): URL {
  const endpoint = (source.config.endpoint as Endpoint | undefined) ?? "everything";
  if (endpoint !== "everything" && endpoint !== "top-headlines") {
    throw new Error("newsapi source config.endpoint must be everything or top-headlines");
  }

  const url = new URL(`${API}/${endpoint}`);
  const limit = Math.min(source.max_items_per_poll, 100);
  url.searchParams.set("pageSize", String(limit));

  const params =
    endpoint === "everything"
      ? ["q", "searchIn", "sources", "domains", "excludeDomains", "from", "to", "language", "sortBy"]
      : ["q", "sources", "category", "country"];

  for (const key of params) {
    const value = source.config[key];
    if (typeof value === "string" && value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  if (endpoint === "everything" && !url.searchParams.get("q") && !url.searchParams.get("sources")) {
    throw new Error("newsapi everything sources need config.q or config.sources");
  }

  if (
    endpoint === "top-headlines" &&
    !url.searchParams.get("q") &&
    !url.searchParams.get("sources") &&
    !url.searchParams.get("category") &&
    !url.searchParams.get("country")
  ) {
    url.searchParams.set("country", "us");
  }

  return url;
}

export const newsApiAdapter: Adapter = {
  async fetch(source: SourceRow): Promise<DraftItem[]> {
    const key = Deno.env.get("NEWSAPI_KEY");
    if (!key) throw new Error("NEWSAPI_KEY not set");

    const res = await fetch(buildUrl(source), {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) throw new Error(`newsapi ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as {
      status?: string;
      code?: string;
      message?: string;
      articles?: NewsApiArticle[];
    };

    if (json.status !== "ok") {
      throw new Error(`newsapi ${json.code ?? "error"}: ${json.message ?? "request failed"}`);
    }

    return (json.articles ?? [])
      .map((article) => {
        const url = cleanedText(article.url);
        const title = cleanedText(article.title);
        if (!url || !title) return null;

        const publishedAt = new Date(article.publishedAt ?? Date.now());
        const excerpt = cleanedText(article.description) ?? cleanedText(article.content);

        return {
          external_id: url,
          kind: "article" as const,
          title,
          author: cleanedText(article.author) ?? cleanedText(article.source?.name) ?? null,
          permalink: url,
          published_at: Number.isNaN(publishedAt.getTime())
            ? new Date().toISOString()
            : publishedAt.toISOString(),
          is_nsfw: source.is_nsfw,
          body: bodyFor(article),
          excerpt,
          poster_url: cleanedText(article.urlToImage),
        };
      })
      .filter((item): item is DraftItem => item !== null);
  },
};
