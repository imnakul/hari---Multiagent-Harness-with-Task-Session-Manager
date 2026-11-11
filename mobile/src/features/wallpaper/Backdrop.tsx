import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

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
 * Fork (Hari, L-245): the wallpaper behind a screen, softened and dimmed in
 * the page's colour; nothing without one. One image per screen, blurred once
 * and cached by the image view, with no live blur, so it costs as little as
 * a photo does as screens slide over each other. `reading` dims it further,
 * behind a conversation's messages.
 */
export function Backdrop({ reading = false }: { reading?: boolean }) {
  const wallpaper = useWallpaper();
  const uri = useWallpaperUri(wallpaper.source);
  const colors = useColors();
  const scheme = useScheme();
  if (!uri) return null;
  const dim = Math.min(
    0.95,
    (scheme === "dark" ? wallpaper.dimDark : wallpaper.dimLight) + (reading ? READING_DIM : 0),
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri }}
        contentFit="cover"
        blurRadius={wallpaper.blur}
        cachePolicy="memory-disk"
        transition={0}
        style={StyleSheet.absoluteFill}
        accessible={false}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(colors.background, dim) }]} />
    </View>
  );
}
