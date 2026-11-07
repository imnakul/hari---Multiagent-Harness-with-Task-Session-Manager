import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { memo, type RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useScheme, withAlpha } from "./theme";

/**
 * Blur that fades out away from a screen edge, so content scrolling under a
 * floating header or footer softens instead of being clipped. Stacks several
 * masked blur layers, each reaching a little less far, so blur and tint build
 * up toward the edge.
 * Stacks by render order: render it after the content and before the chrome.
 * Memoized, as its props are plain values and its layers costly to rebuild.
 */
export const GradualBlur = memo(function GradualBlur({
  edge,
  height,
  color,
  // Each layer is an offscreen pass for the GPU; 6 made every slide between
  // screens miss frames at 120Hz (Instruments: 51–65 passes a frame).
  steps = 3,
  intensity = 8,
  blurTarget,
}: {
  edge: "top" | "bottom";
  height: number;
  /** Background the blur fades into, as `#rrggbb`. */
  color: string;
  steps?: number;
  intensity?: number;
  /**
   * Fork (Hari, L-235): the content to blur, on Android. Android's BlurView
   * only blurs a target it is given (as LiquidView's glass does); without one
   * it draws a see-through tint, which left titles unreadable over messages.
   */
  blurTarget?: RefObject<View | null>;
}) {
  const fromTop = edge === "top";
  const tint = withAlpha(color, 0.5);
  const scheme = useScheme();

  if (Platform.OS === "android" && blurTarget) {
    // One real blur over the edge's frame, then a tint that fades out, so the
    // blur's own edge disappears into it. Masking a real blur doesn't draw on
    // Android, so this replaces the masked layers.
    const fade = Math.min(36, height / 2);
    const veil = withAlpha(color, 0.6);
    return (
      <View
        pointerEvents="none"
        style={[styles.container, { height }, fromTop ? styles.top : styles.bottom]}
      >
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={24}
          tint={scheme}
          style={[
            styles.androidBlur,
            fromTop ? { top: 0, bottom: fade } : { bottom: 0, top: fade },
            { backgroundColor: veil },
          ]}
        />
        <LinearGradient
          colors={fromTop ? [veil, "transparent"] : ["transparent", veil]}
          style={[styles.androidBlur, fromTop ? { bottom: 0, height: fade } : { top: 0, height: fade }]}
        />
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { height }, fromTop ? styles.top : styles.bottom]}
    >
      {Array.from({ length: steps }, (_, i) => {
        // Each layer starts at the edge and reaches `cutoff` of the height.
        const cutoff = 1 - i / steps;
        return (
          <MaskedView
            key={i}
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={
                  fromTop
                    ? ["black", "rgba(0, 0, 0, 0.8)", "transparent"]
                    : ["transparent", "rgba(0, 0, 0, 0.8)", "black"]
                }
                locations={fromTop ? [0, cutoff * 0.5, cutoff] : [1 - cutoff, 1 - cutoff * 0.5, 1]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView
              intensity={intensity}
              tint={scheme}
              style={[StyleSheet.absoluteFill, { backgroundColor: tint }]}
            />
          </MaskedView>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
  androidBlur: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
