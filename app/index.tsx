import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { chrome, color, scale, space, type } from "../src/theme/tokens";
import { VideoCard } from "../src/components/cards/VideoCard";
import { ArticleCard } from "../src/components/cards/ArticleCard";
import { SocialCard } from "../src/components/cards/SocialCard";
import { YouTubeEmbedOverlay } from "../src/components/YouTubeEmbedOverlay";
import { Media3FeedView, media3Feed, useMedia3FeedLifecycle } from "media3-feed";
import { fetchPrefs, fetchQueuePageWithRetry } from "../src/lib/queue";
import { logEvent } from "../src/lib/db";
import { rewardFor, updateBandit } from "../src/lib/bandit";
import type { FeedItem, Prefs } from "../src/lib/types";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<FeedItem>);

export default function FeedScreen() {
  const { height } = useWindowDimensions();
  const router = useRouter();
  useMedia3FeedLifecycle();

  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [settledIndex, setSettledIndex] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "empty" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [endOfFeed, setEndOfFeed] = useState(false);

  const scrollY = useSharedValue(0);
  const settledIndexSV = useSharedValue(0);
  const overlayKind = useRef<FeedItem["kind"] | "youtube_embed" | null>(null);

  const impressionStart = useRef<number>(Date.now());
  const seenIdsThisSession = useRef<Set<string>>(new Set());

  // ---- initial load ---------------------------------------------------
  const loadFeed = useCallback(async () => {
    setLoadStatus("loading");
    setLoadError(null);
    setEndOfFeed(false);
    try {
      const p = await fetchPrefs();
      setPrefs(p);
      const page = await fetchQueuePageWithRetry(p);
      setItems(page.items);
      setLoadStatus(page.items.length > 0 ? "ready" : "empty");
    } catch (err) {
      // Most likely causes: app.json still has placeholder Supabase
      // values, RLS policies aren't applied, or there's no network.
      console.error("feed load failed:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
      setLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- native queue sync: only real video items enter the Media3 pool -
  const videoItems = useMemo(
    () => items.filter((i) => i.kind === "video" && i.media_kind !== "youtube_embed" && i.media_url),
    [items],
  );

  const videoIndexFor = useCallback(
    (globalIndex: number) => {
      let count = 0;
      for (let i = 0; i <= globalIndex; i++) {
        const it = items[i];
        if (it && it.kind === "video" && it.media_kind !== "youtube_embed" && it.media_url) {
          if (i === globalIndex) return count;
          count++;
        }
      }
      return -1;
    },
    [items],
  );

  useEffect(() => {
    if (!prefs || videoItems.length === 0) return;
    media3Feed.setQueue(
      videoItems.map((v) => ({
        id: v.id,
        uri: v.media_url as string,
        isHls: v.media_kind === "hls",
      })),
      Math.max(videoIndexFor(settledIndex), 0),
      prefs.decoder_slots,
    );
    // Only re-sync when the *set* of video items changes, not on every settle
    // (settle() itself is a separate, cheaper native call).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoItems, prefs]);

  // ---- app background/foreground: release decoders, don't leak them ---
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        media3Feed.suspendAll().catch(() => {});
      } else if (state === "active") {
        media3Feed.resumeActive().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // ---- telemetry: close out the previous item's dwell before settling -
  const commitDwell = useCallback(async (item: FeedItem | undefined, completion?: number) => {
    if (!item) return;

    let c = completion;
    if (c == null && item.kind === "video" && item.media_kind !== "youtube_embed") {
      try {
        const p = await media3Feed.activeProgress();
        if (p.durationMs > 0) c = Math.min(Math.max(p.positionMs / p.durationMs, 0), 1);
      } catch {
        // ignore
      }
    }

    const dwellMs = Date.now() - impressionStart.current;
    await logEvent(item.id, "dwell", { bucket: item.bucket, dwellMs, completion: c });

    const event = c != null && c > 0.9 ? "complete" : "skip";
    await logEvent(item.id, event, { bucket: item.bucket, dwellMs, completion: c });

    if (item.bucket) {
      const reward = rewardFor(event, c);
      if (reward != null) updateBandit(item.bucket, reward).catch(() => {});
    }
  }, []);

  const settleAt = useCallback(
    (index: number) => {
      const prev = items[settledIndex];
      const next = items[index];
      if (!next) return;

      commitDwell(prev).catch(() => {});
      impressionStart.current = Date.now();

      if (!seenIdsThisSession.current.has(next.id)) {
        seenIdsThisSession.current.add(next.id);
        logEvent(next.id, "impression", { bucket: next.bucket }).catch(() => {});
      }

      setSettledIndex(index);
      settledIndexSV.value = index;

      if (next.kind === "video" && next.media_kind !== "youtube_embed" && next.media_url) {
        overlayKind.current = "video";
        media3Feed.settle(next.id).catch(() => {});
      } else if (next.kind === "video" && next.media_kind === "youtube_embed") {
        overlayKind.current = "youtube_embed";
        media3Feed.pauseActive().catch(() => {});
      } else {
        overlayKind.current = next.kind;
        media3Feed.pauseActive().catch(() => {});
      }

      // Approaching the end of the loaded page — fetch more before the user
      // can outrun the list.
      if (index >= items.length - 5 && !loadingMore && !endOfFeed && prefs) {
        setLoadingMore(true);
        fetchQueuePageWithRetry(prefs, new Set(items.map((i) => i.id)))
          .then((page) => {
            setEndOfFeed(page.items.length === 0);
            if (page.items.length > 0) {
              setEndOfFeed(false);
              setItems((cur) => [...cur, ...page.items]);
            }
          })
          .finally(() => setLoadingMore(false));
      }
    },
    [items, settledIndex, commitDwell, loadingMore, endOfFeed, prefs, settledIndexSV],
  );

  // Settle on the very first item once data lands.
  useEffect(() => {
    if (items.length > 0 && settledIndex === 0 && overlayKind.current === null) {
      settleAt(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleSettleFromOffset = useCallback(
    (y: number) => {
      const idx = Math.round(y / height);
      if (idx !== settledIndex) settleAt(idx);
    },
    [height, settledIndex, settleAt],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: settledIndexSV.value * height - scrollY.value }],
  }));

  const settledItem = items[settledIndex];
  const showMedia3Overlay = settledItem?.kind === "video" && settledItem.media_kind !== "youtube_embed";
  const showYouTubeOverlay = settledItem?.kind === "video" && settledItem.media_kind === "youtube_embed";

  const openReader = useCallback(
    (item: FeedItem) => {
      logEvent(item.id, "open_reader", { bucket: item.bucket }).catch(() => {});
      router.push({ pathname: "/reader/[id]", params: { id: item.id } });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FeedItem>) => {
      switch (item.kind) {
        case "video":
          return (
            <View style={{ height }}>
              <VideoCard item={item} isYouTube={item.media_kind === "youtube_embed"} />
            </View>
          );
        case "article":
          return (
            <View style={{ height }}>
              <ArticleCard item={item} onOpen={() => openReader(item)} />
            </View>
          );
        case "social":
          return (
            <View style={{ height }}>
              <SocialCard item={item} onOpen={() => openReader(item)} />
            </View>
          );
      }
    },
    [height, openReader],
  );

  // getItemType keeps FlashList's recycling pools separate per card type —
  // without this a video-styled cell can get recycled into an article slot
  // and you pay a layout/surface cost mid-swipe.
  const getItemType = useCallback((item: FeedItem) => item.kind, []);

  if (loadStatus === "loading" || !prefs) {
    return (
      <View style={styles.centerRoot}>
        <ActivityIndicator color={color.learn} />
      </View>
    );
  }

  if (loadStatus === "error") {
    return (
      <View style={styles.centerRoot}>
        <Text style={styles.stateTitle}>Couldn't load the feed</Text>
        <Text style={styles.stateBody}>{loadError}</Text>
        <Text style={styles.stateHint}>
          Check app.json's supabaseUrl/supabaseAnonKey aren't still placeholders, and that migrations
          (including 0003_rls.sql) have been pushed.
        </Text>
        <Pressable style={styles.retryButton} onPress={loadFeed}>
          <Text style={styles.retryText}>RETRY</Text>
        </Pressable>
      </View>
    );
  }

  if (loadStatus === "empty") {
    return (
      <View style={styles.centerRoot}>
        <Text style={styles.stateTitle}>No items yet</Text>
        <Text style={styles.stateBody}>
          {prefs.nsfw_mode
            ? "NSFW mode is on, but no NSFW sources are configured — add one in Settings."
            : "Ingestion hasn't populated any items yet. Trigger the ingest Edge Function once, then retry."}
        </Text>
        <Pressable style={styles.retryButton} onPress={loadFeed}>
          <Text style={styles.retryText}>RETRY</Text>
        </Pressable>
      </View>
    );
  }

  const chromeTokens = chrome(prefs.nsfw_mode);

  return (
    <View style={[styles.root, { backgroundColor: chromeTokens.base }]}>
      <AnimatedFlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        getItemType={getItemType}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => handleSettleFromOffset(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => handleSettleFromOffset(e.nativeEvent.contentOffset.y)}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.feedFooter}>
              <ActivityIndicator color={color.learn} />
              <Text style={styles.footerText}>Loading more from the feed…</Text>
            </View>
          ) : endOfFeed ? (
            <View style={styles.feedFooter}>
              <Text style={styles.footerText}>You’re caught up. New items will appear here soon.</Text>
            </View>
          ) : null
        }
      />

      <Animated.View style={[StyleSheet.absoluteFill, { height }, overlayStyle]} pointerEvents="box-none">
        {showMedia3Overlay && <Media3FeedView style={StyleSheet.absoluteFill} pointerEvents="none" />}
        {showYouTubeOverlay && settledItem?.media_url && (
          <YouTubeEmbedOverlay videoId={settledItem.media_url} autoplayMuted={prefs.autoplay_muted} />
        )}
      </Animated.View>

      <Pressable
        style={[styles.settingsButton, prefs.nsfw_mode && { borderColor: color.nsfw }]}
        onPress={() => router.push("/settings")}
        hitSlop={12}
      >
        {prefs.nsfw_mode && <Text style={styles.nsfwTag}>NSFW</Text>}
        <Text style={styles.settingsGlyph}>{"\u2261"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.base },
  centerRoot: {
    flex: 1,
    backgroundColor: color.base,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    gap: space.md,
  },
  stateTitle: {
    ...type.display,
    fontSize: scale.lg,
    color: color.text,
    textAlign: "center",
  },
  stateBody: {
    ...type.body,
    fontSize: scale.base,
    color: color.textDim,
    textAlign: "center",
    lineHeight: scale.base * 1.4,
  },
  stateHint: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textFaint,
    textAlign: "center",
    lineHeight: scale.xs * 1.5,
  },
  retryButton: {
    marginTop: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.learn,
    borderRadius: 999,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  retryText: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.learn,
  },
  settingsButton: {
    position: "absolute",
    top: space.xxl,
    right: space.lg,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(11,13,16,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    borderRadius: 999,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  feedFooter: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
    gap: space.sm,
  },
  footerText: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textFaint,
    textAlign: "center",
  },
  nsfwTag: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.nsfw,
  },
  settingsGlyph: {
    fontSize: scale.md,
    color: color.text,
  },
});
