import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";

import { accentColor, hueOf, useColors, useLook, useScheme, withAlpha } from "@/ui/theme";

import { drawPreset, drawnPreset } from "./presets";
import { photoUri, READING_DIM, useWallpaper, type WallpaperSource } from "./wallpaper";

/** The accent's hue in dark, as the accent glow is drawn in. */
function useAccentHue(): number {
  return hueOf(accentColor(useLook().accent, "dark"));
}

/**
 * The wallpaper's file URI: a photo's at once, a preset's once drawn (the
 * first time, a frame after the screen shows). Null without a wallpaper.
 */
export function useWallpaperUri(source: WallpaperSource): string | null {
  const accentHue = useAccentHue();
  const id = source.kind === "preset" ? source.id : null;
  const key = id ? `${id}.${accentHue}` : null;
  const ready = id ? drawnPreset(id, accentHue) : null;
  // A preset drawn here, held in state so the screen shows it once ready.
  const [drawn, setDrawn] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    if (!id || !key || ready) return;
    const frame = requestAnimationFrame(() => setDrawn({ key, uri: drawPreset(id, accentHue) }));
    return () => cancelAnimationFrame(frame);
  }, [id, key, ready, accentHue]);
  if (source.kind === "photo") return photoUri(source.file);
  return ready ?? (drawn && drawn.key === key ? drawn.uri : null);
}

/**
 * Fork (Hari, L-245): whether the screen below dims its wallpaper for reading
 * (a conversation's). Set per screen by the root stack, so an edge fade drawn
 * over that screen dims its copy of the wallpaper to match.
 */
export const BackdropReading = createContext<boolean | undefined>(undefined);

type BackdropLayer = { uri: string; dim: number; blur: number };

/** The wallpaper as a screen draws it; null without one, or before a preset is drawn. */
export function useBackdrop(reading: boolean): BackdropLayer | null {
  const wallpaper = useWallpaper();
  const uri = useWallpaperUri(wallpaper.source);
  const scheme = useScheme();
  if (!uri) return null;
  const dim = Math.min(
    0.95,
    (scheme === "dark" ? wallpaper.dimDark : wallpaper.dimLight) + (reading ? READING_DIM : 0),
  );
  return { uri, dim, blur: wallpaper.blur };
}

function BackdropImage({ layer }: { layer: BackdropLayer }) {
  const colors = useColors();
  return (
    <>
      <Image
        source={{ uri: layer.uri }}
        contentFit="cover"
        blurRadius={layer.blur}
        cachePolicy="memory-disk"
        transition={0}
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(colors.background, layer.dim) }]} />
    </>
  );
}

/**
 * Fork (Hari, L-245): the wallpaper behind a screen, softened and dimmed in
 * the page's colour; nothing without one. One image per screen, blurred once
 * and cached by the image view, with no live blur, so it costs as little as
 * a photo does as screens slide over each other. `reading` dims it further,
 * behind a conversation's messages.
 */
export function Backdrop({ reading = false }: { reading?: boolean }) {
  const layer = useBackdrop(reading);
  if (!layer) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BackdropImage layer={layer} />
    </View>
  );
}

/**
 * The screen's wallpaper again, over content scrolling under a header or
 * composer: solid from the edge, fading out over `fade`. Drawn at the full
 * app's size from that edge, so it lines up with the Backdrop beneath and
 * the band can't be told from the page; content just fades away under it.
 */
export function BackdropEdge({
  layer,
  edge,
  height,
  fade,
}: {
  layer: BackdropLayer;
  edge: "top" | "bottom";
  height: number;
  fade: number;
}) {
  const frame = useSafeAreaFrame();
  const fromTop = edge === "top";
  const solid = height > 0 ? Math.max(0, (height - fade) / height) : 0;
  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={
        <LinearGradient
          colors={fromTop ? ["black", "black", "transparent"] : ["transparent", "black", "black"]}
          locations={fromTop ? [0, solid, 1] : [0, 1 - solid, 1]}
          style={StyleSheet.absoluteFill}
        />
      }
    >
      <View style={[styles.full, { height: frame.height }, fromTop ? styles.top : styles.bottom]}>
        <BackdropImage layer={layer} />
      </View>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  full: { position: "absolute", left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
