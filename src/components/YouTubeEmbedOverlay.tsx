import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { color } from "../theme/tokens";

/**
 * YouTube items never enter the Media3 pool — we resolve nothing about their
 * media URL, that's the entire compliance point. Instead the official IFrame
 * embed plays them. Exactly one of these exists at a time, mounted only for
 * the currently settled YouTube item, so it costs nothing while scrolled past.
 */
export function YouTubeEmbedOverlay({ videoId, autoplayMuted }: { videoId: string; autoplayMuted: boolean }) {
  const params = new URLSearchParams({
    autoplay: "1",
    playsinline: "1",
    mute: autoplayMuted ? "1" : "0",
    controls: "1",
    modestbranding: "1",
    rel: "0",
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <WebView
        source={{ uri: `https://www.youtube.com/embed/${videoId}?${params.toString()}` }}
        style={{ flex: 1, backgroundColor: color.base }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
      />
    </View>
  );
}
