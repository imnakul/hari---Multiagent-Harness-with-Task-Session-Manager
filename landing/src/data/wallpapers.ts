/**
 * Wallpapers behind the whole site. Drawn ones are pure CSS; to use a real
 * image add `{ id, name, image: "media/wallpapers/your.jpg", swatch: "#hex" }`.
 */
export type Wallpaper = {
  id: string;
  name: string;
  /** Small colour for the picker dot when the wallpaper is an image. */
  swatch?: string;
  image?: string;
  light?: string;
  dark?: string;
};

const blobs = (base: string, a: string, b: string, c: string, d: string) =>
  [
    `radial-gradient(58% 52% at 14% 18%, ${a} 0%, transparent 62%)`,
    `radial-gradient(48% 46% at 86% 14%, ${b} 0%, transparent 64%)`,
    `radial-gradient(44% 42% at 74% 88%, ${c} 0%, transparent 62%)`,
    `radial-gradient(62% 58% at 16% 96%, ${d} 0%, transparent 66%)`,
    `linear-gradient(160deg, ${base}, ${base})`,
  ].join(", ");

export const wallpapers: Wallpaper[] = [
  {
    id: "peacock",
    name: "Peacock",
    light: blobs("#e6f0ee", "#6cc4cb", "#9db3f0", "#f0cf7e", "#a9dcd4"),
    dark: blobs("#031114", "#0d6a74", "#1a398a", "#9e711b", "#08485a"),
  },
  {
    id: "dusk",
    name: "Vrindavan dusk",
    light: blobs("#f5ebe4", "#efacc4", "#b4bcf2", "#f4c98a", "#eac2dc"),
    dark: blobs("#0c0915", "#6a2a5a", "#202c72", "#b4701f", "#3c1a48"),
  },
  {
    id: "yamuna",
    name: "Yamuna",
    light: blobs("#e8f0f8", "#93c2f0", "#99dbe8", "#c4cdf4", "#b6d4f4"),
    dark: blobs("#040a16", "#0b3c70", "#0e7d9a", "#14275a", "#06304e"),
  },
  {
    id: "monsoon",
    name: "Monsoon",
    light: blobs("#eaefe8", "#acd6b4", "#bfcfe0", "#dcdea8", "#c0deca"),
    dark: blobs("#070f0d", "#1d4a39", "#22354c", "#5b6f36", "#123a33"),
  },
];
