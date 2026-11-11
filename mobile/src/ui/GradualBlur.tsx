import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { memo, use, type RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { BackdropEdge, BackdropReading, useBackdrop } from "@/features/wallpaper/Backdrop";

import { useLook, useScheme, withAlpha } from "./theme";

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
}: {
  edge: "top" | "bottom";
  height: number;
  /** Background the blur fades into, as `#rrggbb`. */
  color: string;
  steps?: number;
  intensity?: number;
  /**
   * Unused on Android, which draws a solid band (L-235); kept so callers
   * don't change.
   */
  blurTarget?: RefObject<View | null>;
}) {
  const fromTop = edge === "top";
  const tint = withAlpha(color, 0.5);
  const scheme = useScheme();
  // Over a wallpaper (glass on), the band lets a little of it through.
  const glassy = useLook().glass !== null;
  // Fork (L-245): the wallpaper itself, where there is one to draw.
  const backdrop = useBackdrop(use(BackdropReading) ?? false);

  if (Platform.OS === "android") {
    // Fork (Hari, L-235): a solid band that fades out, not a blur. Android's
    // blur copied a target with no background of its own, so light mode drew
    // dark grey bars; without a target it was see-through. Solid is reliable
    // and cheaper to draw while scrolling.
    const fade = Math.min(36, height / 2);
    if (glassy && backdrop) {
      // Fork (L-245): over a wallpaper, the band is the wallpaper, so it
      // shows edge to edge with no strip of page colour.
      return (
        <View
          pointerEvents="none"
          style={[styles.container, { height }, fromTop ? styles.top : styles.bottom]}
        >
          <BackdropEdge layer={backdrop} edge={edge} height={height} fade={fade} />
        </View>
      );
    }
    const band = glassy ? withAlpha(color, 0.85) : color;
    return (
      <View
        pointerEvents="none"
        style={[styles.container, { height }, fromTop ? styles.top : styles.bottom]}
      >
        <View
          style={[
            styles.androidBand,
            fromTop ? { top: 0, bottom: fade } : { bottom: 0, top: fade },
            { backgroundColor: band },
          ]}
        />
        <LinearGradient
          colors={fromTop ? [band, withAlpha(color, 0)] : [withAlpha(color, 0), band]}
          style={[styles.androidBand, fromTop ? { bottom: 0, height: fade } : { top: 0, height: fade }]}
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
  androidBand: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
