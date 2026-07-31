import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, scale, space, type } from "../../theme/tokens";
import { LaneBadge } from "../LaneBadge";
import type { FeedItem } from "../../lib/types";

export function SocialCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <Pressable style={styles.root} onPress={onOpen}>
      <View style={styles.header}>
        <LaneBadge bucketKey={item.bucket ?? ""} feedLane={item.lane} />
        {item.author && <Text style={styles.author}>{item.author}</Text>}
      </View>

      <Text style={styles.title} numberOfLines={5}>
        {item.title}
      </Text>

      {item.poster_url && (
        <Image source={{ uri: item.poster_url }} style={styles.image} contentFit="cover" />
      )}

      {item.excerpt && (
        <Text style={styles.excerpt} numberOfLines={5}>
          {item.excerpt}
        </Text>
      )}

      <View style={styles.footer}>
        <Text style={styles.stat}>{"\u2b06"} {item.score ?? 0}</Text>
        <Text style={styles.readMore}>OPEN THREAD {"\u2192"}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.surface,
    padding: space.lg,
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.md,
  },
  author: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textFaint,
  },
  title: {
    ...type.display,
    fontSize: scale.lg,
    color: color.text,
    marginBottom: space.md,
  },
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: color.surfaceRaised,
    marginBottom: space.md,
  },
  excerpt: {
    ...type.body,
    fontSize: scale.base,
    lineHeight: scale.base * 1.5,
    color: color.textDim,
    marginBottom: space.lg,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stat: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.play,
  },
  readMore: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.learn,
  },
});
