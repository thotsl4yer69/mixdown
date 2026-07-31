import type { Block } from "../../_shared/types.ts";

/**
 * Article extraction without a headless browser.
 *
 * Strategy: strip everything structurally non-content, then walk the remaining
 * block-level tags in document order and emit typed blocks. This is
 * deliberately not a full Readability port — for RSS feeds carrying
 * content:encoded the markup is already clean, and the failure mode we care
 * about (nav/script/style bleeding into the body) is handled by the strip pass.
 */

const DROP_TAGS = [
  "script", "style", "noscript", "iframe", "svg", "form", "nav",
  "aside", "header", "footer", "figcaption", "button", "template",
];

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&apos;": "'", "&nbsp;": " ", "&mdash;": "\u2014", "&ndash;": "\u2013",
  "&hellip;": "\u2026", "&rsquo;": "\u2019", "&lsquo;": "\u2018",
  "&ldquo;": "\u201C", "&rdquo;": "\u201D",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function preClean(html: string): string {
  let out = html;
  for (const tag of DROP_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, "gi"), " ");
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}

const BLOCK_RE =
  /<(h2|h3|p|blockquote|pre|li|img|hr)\b([^>]*)>([\s\S]*?)<\/\1>|<(img|hr)\b([^>]*?)\/?>/gi;

export function htmlToBlocks(html: string, maxBlocks = 60): Block[] {
  const cleaned = preClean(html);
  const blocks: Block[] = [];

  for (const m of cleaned.matchAll(BLOCK_RE)) {
    if (blocks.length >= maxBlocks) break;

    const tag = (m[1] ?? m[4] ?? "").toLowerCase();
    const attrs = m[2] ?? m[5] ?? "";
    const inner = m[3] ?? "";

    switch (tag) {
      case "h2":
      case "h3": {
        const text = stripTags(inner);
        if (text) blocks.push({ t: "h", level: tag === "h2" ? 2 : 3, text });
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
        const text = decodeEntities(inner.replace(/<\/?code[^>]*>/gi, ""))
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
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

  // Feeds that ship a single unwrapped text blob produce zero blocks above.
  if (blocks.length === 0) {
    const flat = stripTags(cleaned);
    if (flat) {
      for (const para of flat.split(/(?<=[.!?])\s+(?=[A-Z])/).reduce<string[]>((acc, s) => {
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

/** Reddit/markdown bodies: lighter grammar, same output shape. */
export function markdownToBlocks(md: string, maxBlocks = 60): Block[] {
  const blocks: Block[] = [];
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

export function excerptOf(blocks: Block[], chars = 320): string {
  const prose = blocks
    .filter((b): b is Extract<Block, { t: "p" }> => b.t === "p")
    .map((b) => b.text)
    .join(" ");
  if (prose.length <= chars) return prose;
  const cut = prose.slice(0, chars);
  return `${cut.slice(0, cut.lastIndexOf(" "))}\u2026`;
}

/** Text handed to the embedding model. Title carries most of the signal. */
export function embedText(title: string, excerpt: string | null, bucket: string | null): string {
  return [title, bucket ?? "", excerpt ?? ""].filter(Boolean).join("\n").slice(0, 1400);
}
