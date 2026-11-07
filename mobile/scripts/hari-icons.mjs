// Fork (Hari, L-235): builds the phone app's icon set from public/monocode.png.
// The background is "frosted glass": the icon's own colours, blurred and
// enlarged, seen through a milky pane with a light top edge and fine grain.
// Run from mobile/: node scripts/hari-icons.mjs
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Jimp = require("jimp-compact");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "public", "monocode.png");
const out = (name) => join(root, "assets", "images", name);
const SIZE = 1024;

/** The glass: a cool-to-warm wash, the icon's colours blurred under a milky pane. */
async function glass(icon) {
  const small = 256;
  const base = new Jimp(small, small, 0xffffffff);
  // A soft wash from peacock teal (top left) to flute gold (bottom right).
  base.scan(0, 0, small, small, function (x, y, idx) {
    const t = (x + y) / (2 * small);
    this.bitmap.data[idx] = Math.round(196 + (246 - 196) * t);
    this.bitmap.data[idx + 1] = Math.round(232 + (228 - 232) * t);
    this.bitmap.data[idx + 2] = Math.round(240 + (196 - 240) * t);
    this.bitmap.data[idx + 3] = 255;
  });
  // The icon itself, large and blurred, so its colours glow through the glass.
  const glow = icon.clone().resize(small * 1.25, small * 1.25);
  base.composite(glow, -small * 0.08, -small * 0.12, { opacitySource: 1 });
  base.blur(18);
  // The milky pane.
  const pane = new Jimp(small, small, 0xffffff6e);
  base.composite(pane, 0, 0);
  const full = base.resize(SIZE, SIZE, Jimp.RESIZE_BICUBIC);
  // A light top edge, fading down, and fine grain so it reads as frosted.
  full.scan(0, 0, SIZE, SIZE, function (x, y, idx) {
    const edge = Math.max(0, 1 - y / (SIZE * 0.42)) * 34;
    const grain = (Math.random() - 0.5) * 9;
    for (let c = 0; c < 3; c++) {
      const v = this.bitmap.data[idx + c] + edge + grain;
      this.bitmap.data[idx + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  });
  return full;
}

/** The icon with a soft shadow under it, `size` wide, on a transparent square. */
function iconLayer(icon, size, canvas = SIZE) {
  const layer = new Jimp(canvas, canvas, 0x00000000);
  const art = icon.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
  const shadow = art.clone();
  shadow.scan(0, 0, size, size, function (_x, _y, idx) {
    this.bitmap.data[idx] = 10;
    this.bitmap.data[idx + 1] = 40;
    this.bitmap.data[idx + 2] = 60;
    this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * 0.28);
  });
  shadow.blur(Math.round(size / 40));
  const at = (canvas - size) / 2;
  layer.composite(shadow, at, at + size * 0.025);
  layer.composite(art, at, at);
  return layer;
}

const icon = await Jimp.read(source);
const background = await glass(icon);

// Full icon (Android legacy and the in-app/web icon): rounded glass tile.
const full = background.clone().composite(iconLayer(icon, Math.round(SIZE * 0.74)), 0, 0);
await full.writeAsync(out("hari-icon.png"));

// Adaptive icon: Android crops to a circle or squircle inside the middle 66%.
await background.clone().writeAsync(out("hari-android-background.png"));
await iconLayer(icon, Math.round(SIZE * 0.6)).writeAsync(out("hari-android-foreground.png"));

// Monochrome (themed icons): the silhouette in white.
const mono = icon.clone().resize(Math.round(SIZE * 0.6), Math.round(SIZE * 0.6));
mono.scan(0, 0, mono.bitmap.width, mono.bitmap.height, function (_x, _y, idx) {
  this.bitmap.data[idx] = 255;
  this.bitmap.data[idx + 1] = 255;
  this.bitmap.data[idx + 2] = 255;
});
const monoLayer = new Jimp(SIZE, SIZE, 0x00000000);
monoLayer.composite(mono, (SIZE - mono.bitmap.width) / 2, (SIZE - mono.bitmap.height) / 2);
await monoLayer.writeAsync(out("hari-android-monochrome.png"));

// Splash: the icon alone; the splash screen supplies the background.
await icon.clone().resize(SIZE, SIZE, Jimp.RESIZE_BICUBIC).writeAsync(out("hari-splash.png"));

// Preview of the rounded tile, for review only (not shipped).
const preview = full.clone().resize(512, 512);
const r = 112;
preview.scan(0, 0, 512, 512, function (x, y, idx) {
  const dx = Math.max(r - x, 0, x - (511 - r));
  const dy = Math.max(r - y, 0, y - (511 - r));
  if (dx * dx + dy * dy > r * r) this.bitmap.data[idx + 3] = 0;
});
await preview.writeAsync(join(root, "..", "target", "hari-icon-preview.png"));
console.log("Hari icons written");
