/**
 * A feed timestamp is a claim about when the publisher released the item.
 * Never replace a missing/invalid publication date with ingestion time.
 * RFC 2822 (RSS) and ISO 8601 (Atom/NewsAPI) both contain a four-digit year.
 */
export function sourcePublishedAt(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (!/(?:^|\D)\d{4}(?:\D|$)/.test(raw)) return null;
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds) || milliseconds > now.getTime() + 86_400_000) return null;
  return new Date(milliseconds).toISOString();
}
