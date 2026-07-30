import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono";
import * as SplashScreen from "expo-splash-screen";
import { color } from "../src/theme/tokens";
import { startTelemetrySync } from "../src/lib/db";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_800ExtraBold,
    SpaceMono_400Regular,
  });

  useEffect(() => {
    const stop = startTelemetrySync();
    return stop;
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.base }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.base },
          animation: "slide_from_bottom",
        }}
      />
    </GestureHandlerRootView>
  );
}
