import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// GitHub Pages serves 404.html for unknown paths; copying index.html there
// lets /story and /updates load the SPA on a hard refresh.
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    apply: "build",
    closeBundle() {
      const out = resolve(root, "dist");
      copyFileSync(resolve(out, "index.html"), resolve(out, "404.html"));
    },
  };
}

// Set HARI_BASE=/repo-name/ when deploying to a GitHub Pages project URL.
export default defineConfig({
  base: process.env.HARI_BASE ?? "/",
  plugins: [react(), spaFallback()],
});
