import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import type { Plugin } from "vite";

// Whiteboard (fork, L-194): Excalidraw loads its fonts from
// `window.EXCALIDRAW_ASSET_PATH` or a CDN the app's CSP blocks, so serve them
// from `/excalidraw/fonts/` in dev and copy them into the build. The CJK
// Xiaolai set (13 MB) is left out.
function excalidrawFonts(): Plugin {
  const source = join("node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
  const skip = (path: string) => /[\\/]Xiaolai([\\/]|$)/.test(path);
  let outDir = "dist";
  return {
    name: "monocode-excalidraw-fonts",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use("/excalidraw/fonts", (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const file = normalize(join(source, relative));
        if (!file.startsWith(normalize(source)) || skip(file) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", "font/woff2");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(source)) return;
      cpSync(source, join(outDir, "excalidraw", "fonts"), {
        recursive: true,
        filter: (path) => !skip(path),
      });
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    plugins: [react(), tailwindcss(), excalidrawFonts()],
    worker: { format: "es" },
    resolve: {
      alias: [
        ...(mode.startsWith("benchmark")
          ? [
              {
                find: /^@tauri-apps\/api\/core$/,
                replacement: new URL(
                  "./tests/browser/tauriFixture.ts",
                  import.meta.url,
                ).pathname,
              },
            ]
          : []),
        ...(mode === "benchmark-profile"
          ? [{ find: "react-dom/client", replacement: "react-dom/profiling" }]
          : []),
      ],
    },
    clearScreen: false,
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
          monoChat: "mono-chat.html",
          ...(mode.startsWith("benchmark")
            ? { workspaceBenchmark: "tests/browser/workspace-performance.html" }
            : {}),
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**"],
      },
    },
  };
});
