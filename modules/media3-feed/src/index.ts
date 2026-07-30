import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export interface FeedItemSpec {
  id: string;
  uri: string;
  isHls: boolean;
}

interface NativeModule {
  decoderBudget(): number;
  setQueue(items: FeedItemSpec[], currentIndex: number, slotHint: number): Promise<void>;
  settle(itemId: string): Promise<void>;
  pauseActive(): Promise<void>;
  seekActiveTo(positionMs: number): Promise<void>;
  activeProgress(): Promise<{ positionMs: number; durationMs: number }>;
  suspendAll(): Promise<void>;
  resumeActive(): Promise<void>;
  release(): Promise<void>;
}

const Native = requireNativeModule<NativeModule>("Media3Feed");

export interface Media3FeedViewProps extends ViewProps {
  onFirstFrame?: (e: { nativeEvent: { itemId: string } }) => void;
  onBuffering?: (e: { nativeEvent: { itemId: string; isBuffering: boolean } }) => void;
  onPlaybackError?: (e: { nativeEvent: { itemId: string; message: string } }) => void;
  onCompleted?: (e: { nativeEvent: { itemId: string } }) => void;
}

/**
 * The single persistent video surface for the feed screen. Mount exactly one,
 * absolutely positioned over the FlashList, translated by a Reanimated
 * worklet to track the settled row. Never key/remount this on item change —
 * that reintroduces the SurfaceView attach cost this whole module exists to
 * avoid.
 */
export const Media3FeedView: ComponentType<Media3FeedViewProps> =
  requireNativeViewManager("Media3Feed");

/**
 * Imperative control surface, mirroring the paged-feed lifecycle:
 *   setQueue on scroll settle -> settle(activeId) once the pool is warm ->
 *   suspend/resume around app background/foreground -> release on unmount.
 */
export const media3Feed = {
  decoderBudget: () => Native.decoderBudget(),
  setQueue: (items: FeedItemSpec[], currentIndex: number, slotHint = 3) =>
    Native.setQueue(items, currentIndex, slotHint),
  settle: (itemId: string) => Native.settle(itemId),
  pauseActive: () => Native.pauseActive(),
  seekActiveTo: (positionMs: number) => Native.seekActiveTo(positionMs),
  activeProgress: () => Native.activeProgress(),
  suspendAll: () => Native.suspendAll(),
  resumeActive: () => Native.resumeActive(),
  release: () => Native.release(),
};

/** Releases the native controller when the feed screen unmounts. */
export function useMedia3FeedLifecycle() {
  const released = useRef(false);
  useEffect(() => {
    released.current = false;
    return () => {
      if (released.current) return;
      released.current = true;
      media3Feed.release().catch(() => {});
    };
  }, []);
}
