import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { color, scale, space, type } from "../../src/theme/tokens";
import { LaneBadge } from "../../src/components/LaneBadge";
import { BlockRenderer } from "../../src/components/cards/BlockRenderer";
import { logEvent } from "../../src/lib/db";
import { rewardFor, updateBandit } from "../../src/lib/bandit";
import { supabase } from "../../src/lib/supabase";
import type { FeedItem } from "../../src/lib/types";

interface RawItemRow {
  id: string;
  kind: FeedItem["kind"];
  title: string;
  author: string | null;
  permalink: string;
  published_at: string;
  bucket: string | null;
  is_nsfw: boolean;
  media_url: string | null;
  media_kind: FeedItem["media_kind"];
  duration_s: number | null;
  poster_url: string | null;
  body: FeedItem["body"];
  excerpt: string | null;
  score: number;
  topic_buckets: { lane: "learn" | "play" } | null;
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<FeedItem | null>(null);
  const openedAt = useState(() => Date.now())[0];

  useEffect(() => {
    if (!id) return;
    supabase
      .from("items")
      .select(
        "id, kind, title, author, permalink, published_at, bucket, is_nsfw, " +
          "media_url, media_kind, duration_s, poster_url, body, excerpt, score, " +
          "topic_buckets(lane)",
      )
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        // No generated Database types are wired up (see BUILD.md), so the
        // joined select's inferred type collapses to a generic error shape
        // at the type level even though the runtime payload is correct.
        // Everything past this line is checked normally against FeedItem.
        const row = data as unknown as RawItemRow;
        const built: FeedItem = {
          id: row.id,
          kind: row.kind,
          title: row.title,
          author: row.author,
          permalink: row.permalink,
          published_at: row.published_at,
          bucket: row.bucket,
          lane: row.topic_buckets?.lane ?? "learn",
          is_nsfw: row.is_nsfw,
          media_url: row.media_url,
          media_kind: row.media_kind,
          duration_s: row.duration_s,
          poster_url: row.poster_url,
          body: row.body,
          excerpt: row.excerpt,
          score: row.score,
        };
        setItem(built);
      });
  }, [id]);

  useEffect(() => {
    return () => {
      if (!item) return;
      const dwellMs = Date.now() - openedAt;
      // A completed read is anything past a couple screens of dwell — good
      // enough proxy without instrumenting scroll depth for the reader.
      const completion = Math.min(dwellMs / 20_000, 1);
      logEvent(item.id, "dwell", { bucket: item.bucket, dwellMs, completion });
      if (item.bucket) {
        const reward = rewardFor(completion > 0.6 ? "complete" : "skip", completion);
        if (reward != null) updateBandit(item.bucket, reward).catch(() => {});
      }
    };
  }, [item, openedAt]);

  if (!item) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollBody}>
        {item.poster_url && (
          <Image source={{ uri: item.poster_url }} style={styles.hero} contentFit="cover" />
        )}

        <View style={styles.header}>
          <LaneBadge bucketLabel={item.bucket ?? ""} feedLane={item.lane} />
          <Text style={styles.title}>{item.title}</Text>
          <View style={styles.metaRow}>
            {item.author && <Text style={styles.meta}>{item.author}</Text>}
            <Text style={styles.meta}>{new Date(item.published_at).toLocaleDateString()}</Text>
          </View>
        </View>

        {item.body && item.body.length > 0 ? (
          <View style={styles.body}>
            <BlockRenderer blocks={item.body} />
          </View>
        ) : (
          item.excerpt && (
            <View style={styles.body}>
              <Text style={styles.fallbackExcerpt}>{item.excerpt}</Text>
            </View>
          )
        )}

        <Pressable style={styles.sourceLink} onPress={() => Linking.openURL(item.permalink)}>
          <Text style={styles.sourceLinkText}>VIEW ORIGINAL SOURCE {"\u2192"}</Text>
        </Pressable>
      </ScrollView>

      <Pressable style={styles.closeButton} onPress={() => router.back()} hitSlop={12}>
        <Text style={styles.closeGlyph}>{"\u2715"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.base },
  scrollBody: { paddingBottom: space.xxl },
  hero: { width: "100%", aspectRatio: 16 / 9, backgroundColor: color.surfaceRaised },
  header: { padding: space.lg },
  title: {
    ...type.display,
    fontSize: scale.xl,
    color: color.text,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  metaRow: { flexDirection: "row", gap: space.md },
  meta: { ...type.meta, fontSize: scale.xs, color: color.textFaint },
  body: { paddingHorizontal: space.lg },
  fallbackExcerpt: {
    ...type.body,
    fontSize: scale.base,
    lineHeight: scale.base * 1.55,
    color: color.textDim,
  },
  sourceLink: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  sourceLinkText: { ...type.meta, fontSize: scale.xs, color: color.learn },
  closeButton: {
    position: "absolute",
    top: space.xxl,
    right: space.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(11,13,16,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeGlyph: { color: color.text, fontSize: scale.base },
});
