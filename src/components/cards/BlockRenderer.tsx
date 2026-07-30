import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { color, scale, space, type } from "../../theme/tokens";
import type { Block } from "../../lib/types";

/**
 * The extraction pipeline hands us a typed token tree, never HTML. This is
 * the only renderer for it, used both by the clamped in-feed preview and the
 * full reader screen. WebViews never enter the recycled list — each one is a
 * separate renderer process and its attach cost breaks the scroll's frame
 * budget the moment one mounts mid-swipe.
 */
export function BlockRenderer({ blocks, dim }: { blocks: Block[]; dim?: boolean }) {
  return (
    <View>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} dim={dim} />
      ))}
    </View>
  );
}

function BlockView({ block, dim }: { block: Block; dim?: boolean }) {
  const textColor = dim ? color.textDim : color.text;

  switch (block.t) {
    case "h":
      return (
        <Text
          style={[
            styles.heading,
            block.level === 2 ? { fontSize: scale.lg } : { fontSize: scale.md },
            { color: color.text },
          ]}
        >
          {block.text}
        </Text>
      );
    case "p":
      return <Text style={[styles.p, { color: textColor }]}>{block.text}</Text>;
    case "quote":
      return (
        <View style={styles.quoteWrap}>
          <View style={styles.quoteBar} />
          <Text style={[styles.quote, { color: textColor }]}>{block.text}</Text>
        </View>
      );
    case "code":
      return (
        <View style={styles.codeBlock}>
          <Text style={styles.code}>{block.text}</Text>
        </View>
      );
    case "li":
      return (
        <View style={styles.liRow}>
          <Text style={styles.liBullet}>{block.ordered ? "\u2022" : "\u2013"}</Text>
          <Text style={[styles.p, { color: textColor, flex: 1 }]}>{block.text}</Text>
        </View>
      );
    case "img":
      return (
        <Image
          source={{ uri: block.url }}
          style={styles.image}
          contentFit="cover"
          accessibilityLabel={block.alt}
        />
      );
    case "hr":
      return <View style={styles.hr} />;
  }
}

const styles = StyleSheet.create({
  heading: {
    ...type.display,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  p: {
    ...type.body,
    fontSize: scale.base,
    lineHeight: scale.base * 1.55,
    marginBottom: space.md,
  },
  quoteWrap: {
    flexDirection: "row",
    marginBottom: space.md,
  },
  quoteBar: {
    width: 3,
    backgroundColor: color.learn,
    marginRight: space.sm,
    borderRadius: 2,
  },
  quote: {
    ...type.body,
    fontStyle: "italic",
    fontSize: scale.base,
    lineHeight: scale.base * 1.5,
    flex: 1,
  },
  codeBlock: {
    backgroundColor: color.surfaceRaised,
    borderRadius: 8,
    padding: space.md,
    marginBottom: space.md,
  },
  code: {
    fontFamily: "SpaceMono_400Regular",
    fontSize: scale.sm,
    color: color.learn,
    lineHeight: scale.sm * 1.5,
  },
  liRow: {
    flexDirection: "row",
    marginBottom: space.xs,
    paddingLeft: space.xs,
  },
  liBullet: {
    ...type.body,
    color: color.textDim,
    marginRight: space.sm,
  },
  image: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    marginBottom: space.md,
    backgroundColor: color.surfaceRaised,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
    marginVertical: space.lg,
  },
});
