import type { CSSProperties } from "react";
import { wallpapers } from "../data/wallpapers";
import { useStudio } from "../lib/studio";
import { useTheme } from "../lib/theme";

/** The current wallpaper as a style, for the app and phone mocks. */
export function useWallpaperBackground(): CSSProperties {
  const { wallpaper, customImage } = useStudio();
  const { theme } = useTheme();
  const base = import.meta.env.BASE_URL;
  if (wallpaper === "custom" && customImage) {
    return { backgroundImage: `url(${customImage})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  const w = wallpapers.find((x) => x.id === wallpaper) ?? wallpapers[0];
  return {
    backgroundImage: w.image ? `url(${base}${w.image})` : theme === "dark" ? w.dark : w.light,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

/**
 * The fixed wallpaper behind the whole site. Every preset stays mounted and
 * only opacity changes, so switching is a compositor-only crossfade.
 */
export function Wallpaper() {
  const { wallpaper, customImage, haze } = useStudio();
  const { theme } = useTheme();
  const base = import.meta.env.BASE_URL;

  return (
    <div className="wall" aria-hidden="true">
      {wallpapers.map((w) => (
        <div
          key={w.id}
          className="wall-layer"
          data-on={wallpaper === w.id || undefined}
          style={{
            backgroundImage: w.image ? `url(${base}${w.image})` : theme === "dark" ? w.dark : w.light,
          }}
        />
      ))}
      {customImage && (
        <div
          className="wall-layer wall-photo"
          data-on={wallpaper === "custom" || undefined}
          style={{ backgroundImage: `url(${customImage})` }}
        />
      )}
      <div className="wall-haze" data-on={haze || undefined} />
      <div className="wall-grain" />
      <div className="wall-veil" />
    </div>
  );
}
