import { StyleSheet, Text, View } from "react-native";
import { lane, radius, scale, space, type } from "../theme/tokens";
import type { Lane } from "../lib/types";

export function LaneBadge({ bucketLabel: bucketKey, feedLane }: { bucketLabel: string; feedLane: Lane }) {
  const accent = lane[feedLane].accent;
  return (
    <View style={[styles.wrap, { borderColor: accent }]}>
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={[styles.label, { color: accent }]}>{bucketKey}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: space.xs,
  },
  label: {
    ...type.meta,
    fontSize: scale.xs,
  },
});
