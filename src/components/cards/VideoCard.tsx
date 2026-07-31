import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { color, scale, space, type } from "../../theme/tokens";
import { LaneBadge } from "../LaneBadge";
import type { FeedItem } from "../../lib/types";

function formatDuration(s: number | null): string | null {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

/**
 * Deliberately playerless. In a paged feed only one item is ever visible, so
 * only one live decoder+surface needs to exist for the whole screen — that
 * lives in a single overlay view positioned by the feed screen, never here.
 * This card is what's on screen for every frame except the ones where video
 * is actually playing under it.
 */
export function VideoCard({ item, isYouTube }: { item: FeedItem; isYouTube: boolean }) {
  const duration = formatDuration(item.duration_s);

  return (
    <View style={styles.root}>
      {item.poster_url ? (
        <Image source={{ uri: item.poster_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color.surfaceRaised }]} />
      )}

      <View style={styles.scrim} />

      <View style={styles.top}>
        <LaneBadge bucketKey={item.bucket ?? ""} feedLane={item.lane} />
        {isYouTube && <Text style={styles.embedTag}>YOUTUBE</Text>}
      </View>

      <View style={styles.bottom}>
        {item.author && <Text style={styles.author}>{item.author}</Text>}
        <Text style={styles.title} numberOfLines={3}>
          {item.title}
        </Text>
        {duration && <Text style={styles.duration}>{duration}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.base },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
    backgroundColor: "rgba(11,13,16,0.75)",
  },
  top: {
    position: "absolute",
    top: space.xl,
    left: space.lg,
    right: space.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  embedTag: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textFaint,
  },
  bottom: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    bottom: space.xl,
  },
  author: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textDim,
    marginBottom: space.xs,
  },
  title: {
    ...type.display,
    fontSize: scale.lg,
    color: color.text,
    marginBottom: space.xs,
  },
  duration: {
    ...type.body,
    fontSize: scale.sm,
    color: color.textDim,
  },
});
