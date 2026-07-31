import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, scale, space, type } from "../../theme/tokens";
import { LaneBadge } from "../LaneBadge";
import type { FeedItem } from "../../lib/types";

/**
 * Same full-viewport slot shape as VideoCard on purpose — the feed's snap
 * model stays uniform across modalities, which is what keeps the gesture
 * handling simple. Full body lives behind the tap, on the reader screen,
 * outside the recycler.
 */
export function ArticleCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <Pressable style={styles.root} onPress={onOpen}>
      {item.poster_url && (
        <Image source={{ uri: item.poster_url }} style={styles.hero} contentFit="cover" />
      )}

      <View style={styles.body}>
        <LaneBadge bucketKey={item.bucket ?? ""} feedLane={item.lane} />
        <Text style={styles.title} numberOfLines={4}>
          {item.title}
        </Text>
        {item.excerpt && (
          <Text style={styles.excerpt} numberOfLines={6}>
            {item.excerpt}
          </Text>
        )}
        <View style={styles.metaRow}>
          {item.author && <Text style={styles.meta}>{item.author}</Text>}
          <Text style={styles.readMore}>READ \u2192</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface, justifyContent: "flex-end" },
  hero: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "42%",
    backgroundColor: color.surfaceRaised,
  },
  body: {
    padding: space.lg,
    paddingBottom: space.xl,
  },
  title: {
    ...type.display,
    fontSize: scale.xl,
    color: color.text,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  excerpt: {
    ...type.body,
    fontSize: scale.base,
    lineHeight: scale.base * 1.5,
    color: color.textDim,
    marginBottom: space.lg,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textFaint,
  },
  readMore: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.learn,
  },
});
