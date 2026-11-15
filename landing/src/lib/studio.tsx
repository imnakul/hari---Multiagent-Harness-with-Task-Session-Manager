import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { wallpapers } from "../data/wallpapers";

/**
 * Glass Studio state: which wallpaper sits behind the site, how strong the
 * glass is on the app mock, and whether Haze is on. Remembered per visitor.
 */
type Studio = {
  wallpaper: string;
  setWallpaper: (id: string) => void;
  customImage: string | null;
  setCustomImage: (url: string | null) => void;
  glass: number; // 0..1
  setGlass: (v: number) => void;
  haze: boolean;
  setHaze: (v: boolean) => void;
};

const Ctx = createContext<Studio | null>(null);
const KEY = "hari-studio";

function load(): Partial<Pick<Studio, "wallpaper" | "glass" | "haze">> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const saved = useMemo(load, []);
  const valid = (id?: string) => (id && wallpapers.some((w) => w.id === id) ? id : wallpapers[0].id);
  const [wallpaper, setWallpaper] = useState(valid(saved.wallpaper));
  const [customImage, setCustomImageState] = useState<string | null>(null);
  const [glass, setGlass] = useState(typeof saved.glass === "number" ? saved.glass : 0.55);
  const [haze, setHaze] = useState(saved.haze ?? true);

  useEffect(() => {
    try {
      // A visitor's own photo is only kept for this visit.
      const id = wallpaper === "custom" ? wallpapers[0].id : wallpaper;
      localStorage.setItem(KEY, JSON.stringify({ wallpaper: id, glass, haze }));
    } catch {
      /* ignore */
    }
  }, [wallpaper, glass, haze]);

  const setCustomImage = (url: string | null) => {
    setCustomImageState((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    setWallpaper(url ? "custom" : wallpapers[0].id);
  };

  return (
    <Ctx.Provider value={{ wallpaper, setWallpaper, customImage, setCustomImage, glass, setGlass, haze, setHaze }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStudio() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudio outside StudioProvider");
  return s;
}
