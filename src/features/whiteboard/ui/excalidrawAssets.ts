/**
 * Excalidraw loads its fonts from `EXCALIDRAW_ASSET_PATH`, falling back to a
 * CDN the app's content policy blocks. The fonts are served from
 * `/excalidraw/fonts` by the Vite plugin in `vite.config.ts` (fork, L-194).
 * Imported before `@excalidraw/excalidraw` so the path is set first.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

if (typeof window !== "undefined" && !window.EXCALIDRAW_ASSET_PATH) {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
}

export {};
