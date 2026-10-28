/** A social post's publication date must come from the publisher, never the poll. */
export function shortPublishedAt(value: unknown, maxAgeDays: unknown = null, now: Date = new Date()): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // All four short-feed providers supply ISO 8601 timestamps. Require an explicit
  // timezone: a local/ambiguous time must not be silently interpreted as UTC.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) return null;
  if (zone.toUpperCase() !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds) || milliseconds > now.getTime() + 86_400_000) return null;
  if (maxAgeDays !== null && maxAgeDays !== undefined && maxAgeDays !== '') {
    const days = Number(maxAgeDays);
    if (!Number.isFinite(days) || days <= 0 || milliseconds < now.getTime() - days * 86_400_000) return null;
  }
  return new Date(milliseconds).toISOString();
}

/** Final write-boundary check: a malformed adapter must never invent recency. */
export function datedShortDraft<T extends { published_at?: unknown }>(
  item: T, maxAgeDays: unknown = null, now: Date = new Date(),
): (T & { published_at: string }) | null {
  const publishedAt = shortPublishedAt(item.published_at, maxAgeDays, now);
  return publishedAt ? { ...item, published_at: publishedAt } : null;
}
