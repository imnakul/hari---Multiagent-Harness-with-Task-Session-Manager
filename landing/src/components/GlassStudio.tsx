import { useId, useRef, type ChangeEvent, type CSSProperties } from "react";
import { ImagePlus } from "lucide-react";
import { wallpapers } from "../data/wallpapers";
import { useStudio } from "../lib/studio";
import { useTheme } from "../lib/theme";

/**
 * The controls under the hero window. Picking a wallpaper changes the
 * background of the entire site, which is the point Hari started from.
 */
export function GlassStudio() {
  const { wallpaper, setWallpaper, customImage, setCustomImage, glass, setGlass, haze, setHaze } = useStudio();
  const { theme } = useTheme();
  const file = useRef<HTMLInputElement>(null);
  const sliderId = useId();

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith("image/")) setCustomImage(URL.createObjectURL(f));
    e.target.value = "";
  };

  return (
    <div className="studio glass" role="group" aria-label="Try the glass">
      <div className="studio-group">
        <span className="studio-label">Wallpaper</span>
        <div className="studio-swatches" role="radiogroup" aria-label="Wallpaper">
          {wallpapers.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={wallpaper === w.id}
              className="swatch"
              title={w.name}
              aria-label={w.name}
              onClick={() => setWallpaper(w.id)}
              style={{ "--sw": w.image ? w.swatch : theme === "dark" ? w.dark : w.light } as CSSProperties}
            />
          ))}
          {customImage && (
            <button
              type="button"
              role="radio"
              aria-checked={wallpaper === "custom"}
              className="swatch"
              title="Your photo"
              aria-label="Your photo"
              onClick={() => setWallpaper("custom")}
              style={{ "--sw": `url(${customImage}) center / cover` } as CSSProperties}
            />
          )}
          <button type="button" className="swatch swatch-add" title="Use your own photo" aria-label="Use your own photo" onClick={() => file.current?.click()}>
            <ImagePlus size={14} strokeWidth={1.8} />
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={onFile} />
        </div>
      </div>

      <div className="studio-sep" />

      <div className="studio-group studio-slider">
        <label className="studio-label" htmlFor={sliderId}>
          Glass
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={glass}
          onChange={(e) => setGlass(Number(e.target.value))}
          style={{ "--v": glass } as CSSProperties}
        />
      </div>

      <div className="studio-sep" />

      <label className="studio-group studio-toggle">
        <span className="studio-label">Haze</span>
        <input type="checkbox" role="switch" checked={haze} onChange={(e) => setHaze(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
      </label>
    </div>
  );
}
