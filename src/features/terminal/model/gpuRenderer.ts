import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
import {
  loadGpuTerminalRendering,
  subscribeGpuTerminalRendering,
} from "../../settings/model/settings";

/**
 * Chromium keeps roughly 16 live WebGL contexts per page and silently drops
 * the oldest past that, so GPU terminals stay well below it (fork, L-99).
 */
export const MAX_GPU_TERMINALS = 8;

let activeContexts = 0;
let addonModule: Promise<typeof import("@xterm/addon-webgl")> | null = null;

function loadAddonModule(): Promise<typeof import("@xterm/addon-webgl")> {
  addonModule ??= import("@xterm/addon-webgl");
  return addonModule;
}

/** Live GPU renderers, exposed for tests and diagnostics. */
export function activeGpuTerminalCount(): number {
  return activeContexts;
}

/**
 * Draws `term` with the WebGL renderer while the Experimentation setting is on
 * and `host` has a visible size; otherwise xterm's default DOM renderer is
 * used. Hidden terminals release their context so open ones get the GPU.
 *
 * A failed load or a lost GPU context falls back to the DOM renderer and does
 * not retry until the setting is toggled again, so a broken driver cannot
 * flicker between renderers.
 *
 * Call after `term.open()`; the returned cleanup must run before
 * `term.dispose()`.
 */
export function attachGpuRenderer(
  term: Terminal,
  host: HTMLElement,
): () => void {
  let addon: WebglAddon | null = null;
  let loading = false;
  let failed = false;
  let closed = false;

  const release = (): void => {
    if (!addon) return;
    const current = addon;
    addon = null;
    activeContexts -= 1;
    try {
      current.dispose();
    } catch {
      // The context may already be gone after a loss; nothing left to free.
    }
  };

  const wanted = (): boolean =>
    !closed &&
    !failed &&
    loadGpuTerminalRendering() &&
    host.clientWidth > 0 &&
    host.clientHeight > 0;

  const sync = (): void => {
    if (!wanted()) {
      release();
      return;
    }
    if (addon || loading || activeContexts >= MAX_GPU_TERMINALS) return;
    loading = true;
    void loadAddonModule()
      .then(({ WebglAddon: Addon }) => {
        loading = false;
        if (addon || !wanted() || activeContexts >= MAX_GPU_TERMINALS) return;
        const next = new Addon();
        try {
          term.loadAddon(next);
        } catch {
          // No WebGL2 in this webview: stay on the DOM renderer.
          failed = true;
          next.dispose();
          return;
        }
        addon = next;
        activeContexts += 1;
        next.onContextLoss(() => {
          failed = true;
          release();
        });
      })
      .catch(() => {
        loading = false;
        failed = true;
      });
  };

  const onSettingChange = (): void => {
    failed = false;
    sync();
  };

  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
  observer?.observe(host);
  const unsubscribe = subscribeGpuTerminalRendering(onSettingChange);
  sync();

  return () => {
    closed = true;
    observer?.disconnect();
    unsubscribe();
    release();
  };
}
