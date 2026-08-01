import * as SQLite from "expo-sqlite";
import { AppState } from "react-native";
import { supabase } from "./supabase";

/**
 * A swipe must never block on a network write. Every interaction lands here
 * first (single-digit-ms local insert) and a background flush pushes batches
 * to Supabase. If the flush fails — no connectivity, cold start — nothing is
 * lost; it retries next tick.
 */

export type EventName =
  | "impression"
  | "dwell"
  | "complete"
  | "rewatch"
  | "skip"
  | "vote_up"
  | "vote_down"
  | "open_reader"
  | "hide";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync("mixdown-telemetry.db");
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS pending_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id TEXT NOT NULL,
            bucket TEXT,
            event TEXT NOT NULL,
            dwell_ms INTEGER,
            completion REAL,
            occurred_at TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS pending_events_synced_idx ON pending_events (synced);

          CREATE TABLE IF NOT EXISTS seen_cache (
            item_id TEXT PRIMARY KEY,
            hidden INTEGER NOT NULL DEFAULT 0,
            seen_at TEXT NOT NULL
          );
        `);
        return db;
      } catch (error) {
        dbPromise = null;
        throw error;
      }
    })();
  }
  return dbPromise;
}

export async function logEvent(
  itemId: string,
  event: EventName,
  opts: { bucket?: string | null; dwellMs?: number; completion?: number } = {},
) {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO pending_events (item_id, bucket, event, dwell_ms, completion, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [itemId, opts.bucket ?? null, event, opts.dwellMs ?? null, opts.completion ?? null, now],
  );

  // Mark seen immediately and locally — this is what keeps get_feed() from
  // resurfacing an item before the next sync has run.
  if (event === "impression" || event === "hide") {
    await db.runAsync(
      `INSERT INTO seen_cache (item_id, hidden, seen_at) VALUES (?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET hidden = excluded.hidden, seen_at = excluded.seen_at`,
      [itemId, event === "hide" ? 1 : 0, now],
    );
  }
}

/** IDs already impressed locally, for immediate client-side exclusion before sync lands. */
export async function localSeenIds(limit = 500): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ item_id: string }>(
    `SELECT item_id FROM seen_cache ORDER BY seen_at DESC LIMIT ?`,
    [limit],
  );
  return new Set(rows.map((r) => r.item_id));
}

const BATCH_SIZE = 100;

export async function flush(): Promise<{ pushed: number; failed: boolean }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    item_id: string;
    bucket: string | null;
    event: string;
    dwell_ms: number | null;
    completion: number | null;
    occurred_at: string;
  }>(`SELECT * FROM pending_events WHERE synced = 0 ORDER BY id ASC LIMIT ?`, [BATCH_SIZE]);

  if (rows.length === 0) return { pushed: 0, failed: false };

  const { error } = await supabase.from("interactions").insert(
    rows.map((r) => ({
      item_id: r.item_id,
      bucket: r.bucket,
      event: r.event,
      dwell_ms: r.dwell_ms,
      completion: r.completion,
      occurred_at: r.occurred_at,
    })),
  );

  if (error) {
    console.warn("telemetry flush failed, will retry:", error.message);
    return { pushed: 0, failed: true };
  }

  // Absorb strong-signal completions into the server-side taste vector.
  const engaged = rows.filter((r) => r.event === "complete" || r.event === "vote_up");
  for (const r of engaged) {
    await supabase.rpc("absorb_taste", {
      p_item_id: r.item_id,
      p_strength: r.event === "vote_up" ? 1.5 : 1.0,
    });
  }

  // Push local seen state up too, so a fresh install on another device (or
  // this one after a reinstall) doesn't reshow the recent past.
  const seenRows = await db.getAllAsync<{ item_id: string; hidden: number; seen_at: string }>(
    `SELECT item_id, hidden, seen_at FROM seen_cache WHERE item_id IN (${rows
      .map(() => "?")
      .join(",")})`,
    rows.map((r) => r.item_id),
  );
  if (seenRows.length > 0) {
    await supabase.from("seen").upsert(
      seenRows.map((r) => ({ item_id: r.item_id, hidden: r.hidden === 1, seen_at: r.seen_at })),
      { onConflict: "item_id" },
    );
  }

  const ids = rows.map((r) => r.id);
  await db.runAsync(
    `UPDATE pending_events SET synced = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );

  // Keep the local buffer bounded — synced rows older than a day are dead weight.
  await db.runAsync(
    `DELETE FROM pending_events WHERE synced = 1 AND occurred_at < datetime('now', '-1 day')`,
  );

  return { pushed: rows.length, failed: false };
}

let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Call once near app root. Flushes on an interval and on backgrounding. */
export function startTelemetrySync(intervalMs = 15_000) {
  if (flushTimer) return;

  const tick = () => {
    flush().catch((err) => console.warn("flush tick error", err));
  };

  flushTimer = setInterval(tick, intervalMs);

  const sub = AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") tick();
  });

  return () => {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    sub.remove();
  };
}
