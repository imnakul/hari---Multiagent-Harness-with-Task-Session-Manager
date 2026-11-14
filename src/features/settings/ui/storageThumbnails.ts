/**
 * Fork (L-289): small copies of saved images for Settings → Storage. Tiles
 * used to draw each full-size screenshot into a 104px square, so scrolling
 * decoded and scaled megapixel images on the main thread. Each picture is now
 * decoded once off the main thread (`createImageBitmap`), cropped to a square
 * and kept as a small WebP; tiles draw that. A few at a time, so a fast
 * scroll doesn't queue hundreds of decodes at once.
 */

/** Twice the tile's width, for sharp tiles on high-density screens. */
const THUMB_PX = 224;
const AT_ONCE = 4;

const thumbs = new Map<string, Promise<string | null>>();
let running = 0;
const waiting: (() => void)[] = [];

async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function shrink(fullUrl: string): Promise<string | null> {
  const blob = await (await fetch(fullUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) return null;
    const size = Math.min(THUMB_PX, side);
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    // Centre square crop, like the tile's object-cover did.
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const small = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    return URL.createObjectURL(small);
  } finally {
    bitmap.close();
  }
}

/**
 * A small square copy of the image at `path` (already loaded as `fullUrl`),
 * cached for the session. Falls back to `fullUrl` when the WebView can't make
 * one, so a tile always shows the picture.
 */
export function storageThumbnail(path: string, fullUrl: string): Promise<string> {
  let made = thumbs.get(path);
  if (!made) {
    made =
      typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function"
        ? turn(() => shrink(fullUrl)).catch(() => null)
        : Promise.resolve(null);
    thumbs.set(path, made);
  }
  return made.then((url) => url ?? fullUrl);
}

/** Frees the small copies of deleted files. */
export function forgetStorageThumbnails(paths: readonly string[]): void {
  for (const path of paths) {
    const made = thumbs.get(path);
    if (!made) continue;
    thumbs.delete(path);
    void made.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
}
