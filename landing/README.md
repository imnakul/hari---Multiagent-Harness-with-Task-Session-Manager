# Hari landing page

Vite + React. Three pages: `/` (home), `/updates` (What's new) and `/story`.

```bash
cd landing
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + build to dist/
```

## Adding screenshots and videos

Put files in `public/media/` and reference them without a leading slash, for example `media/focus-mode.webp`.
Every slot without media shows a designed placeholder, so the page always looks finished.

| Where | File | What to set |
| --- | --- | --- |
| Hero window | `src/pages/Home.tsx` | `HERO_MEDIA` (replaces the drawn window) |
| Feature chapters | `src/data/chapters.ts` | `slots[].media` |
| What's new | `src/data/updates.ts` | `media` on an entry |

```ts
media: { type: "image", src: "media/focus-mode.webp", alt: "Focus mode with six chats" }
media: { type: "video", src: "media/zen.mp4", poster: "media/zen.webp", alt: "Zen mode docking" }
```

- Desktop shots are 16:10 by default; phone shots are 9:19.5. Override with `aspect` on a slot.
- Videos autoplay muted and looped, only while on screen. Keep them short (under ~8 MB) and always add a `poster`.
- Prefer `.webp` for images and H.264 `.mp4` for video.

## Shipping an update

Add an entry to the **top** of `src/data/updates.ts` with a `date` (`yyyy-mm-dd`), title, summary, optional
highlights, areas and media. The home page shows the newest three and the hero pill shows the newest one.
Update the numbers in `src/data/site.ts` (`features`, `commits`, `days`) and add new items to
`src/data/catalog.ts` with `isNew: true`.

## Wallpapers

`src/data/wallpapers.ts` holds the drawn wallpapers behind the site. To add a real image:
`{ id: "lotus", name: "Lotus", image: "media/wallpapers/lotus.jpg", swatch: "#2a8f9a" }`.

## Download links

Set the installer and APK URLs in `src/data/site.ts` → `downloads`. They currently point at the repo's latest release.

## Deploying to GitHub Pages

`npm run build` also writes `dist/404.html`, so `/story` and `/updates` work on a hard refresh. For a project
URL such as `https://user.github.io/repo/`, build with `HARI_BASE=/repo/ npm run build`.

## Design notes

- Type: Geist (UI), Instrument Serif italic (one accent word per heading), Geist Mono (labels). Self-hosted.
- Colour comes from the logo: peacock teal, feather blue, flute gold. Tokens are in `src/styles/tokens.css`.
- Materials: `.glass` blurs what is behind it and is reserved for large surfaces; `.frost` is tint, grain and an edge
  with no live blur, for repeated items.
- Motion follows Emil Kowalski's rules: custom ease-out curves, only transform/opacity/clip-path, press feedback at
  `scale(0.97)`, hover gated to fine pointers, nothing animates on repeated actions, and everything respects
  Reduce motion.
