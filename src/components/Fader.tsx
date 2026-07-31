import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { color, radius, scale, space, type } from "../theme/tokens";

const TRACK_HEIGHT = 180;
const CAP_HEIGHT = 28;

/**
 * The signature element. This is a mixing-desk channel fader, not a
 * Material slider skinned dark — the travel is vertical, the cap is a real
 * rectangular handle, and the track has tick marks like actual studio
 * hardware. It exists because "control the algorithm" should feel like
 * operating equipment, not filling out a settings form.
 */
export function Fader({
  label,
  value,
  accent,
  onChange,
  onCommit,
}: {
  label: string;
  value: number; // 0..1
  accent: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const travel = TRACK_HEIGHT - CAP_HEIGHT;
  const y = useSharedValue((1 - value) * travel);

  const emit = useCallback(
    (v: number) => onChange(Math.min(Math.max(v, 0), 1)),
    [onChange],
  );
  const commit = useCallback(
    (v: number) => onCommit(Math.min(Math.max(v, 0), 1)),
    [onCommit],
  );

  const pan = Gesture.Pan()
    .onBegin(() => {
      runOnJS(Haptics.selectionAsync)();
    })
    .onChange((e) => {
      const next = Math.min(Math.max(y.value + e.changeY, 0), travel);
      y.value = next;
      runOnJS(emit)(1 - next / travel);
    })
    .onEnd(() => {
      runOnJS(commit)(1 - y.value / travel);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    });

  const capStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    height: travel - y.value + CAP_HEIGHT / 2,
  }));

  return (
    <View style={styles.column}>
      <Text style={styles.pct}>{Math.round(value * 100)}</Text>
      <GestureDetector gesture={pan}>
        <View style={styles.track}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.tick, { top: (travel / 4) * i + CAP_HEIGHT / 2 }]} />
          ))}
          <Animated.View style={[styles.fill, fillStyle, { backgroundColor: accent }]} />
          <Animated.View style={[styles.cap, capStyle, { borderColor: accent }]}>
            <View style={[styles.capLine, { backgroundColor: accent }]} />
          </Animated.View>
        </View>
      </GestureDetector>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: "center",
    width: 64,
  },
  pct: {
    ...type.body,
    fontSize: scale.sm,
    color: color.textDim,
    marginBottom: space.sm,
    fontVariant: ["tabular-nums"],
  },
  track: {
    width: 36,
    height: TRACK_HEIGHT,
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.sm,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  tick: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.hairline,
  },
  fill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.28,
  },
  cap: {
    position: "absolute",
    left: -6,
    right: -6,
    height: CAP_HEIGHT,
    backgroundColor: color.surface,
    borderWidth: 2,
    borderRadius: radius.sm,
    justifyContent: "center",
  },
  capLine: {
    height: 2,
    marginHorizontal: 8,
  },
  label: {
    ...type.meta,
    fontSize: scale.xs,
    color: color.textDim,
    textAlign: "center",
    marginTop: space.sm,
    height: 28,
  },
});
