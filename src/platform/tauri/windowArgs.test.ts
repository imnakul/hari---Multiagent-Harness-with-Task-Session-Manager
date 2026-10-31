import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Fork guard (L-218). A Browser page is a second webview inside the main window,
// and Tauri then stops treating that window as a `WebviewWindow`: any command
// that takes one fails ("current webview is not a WebviewWindow"), and
// `get_webview_window` / `webview_windows()` skip it. Commands reachable from a
// workspace window take `tauri::Window` or `Webview`, and lookups of workspace
// windows use `get_window` / `windows()`. See AGENTS.md "Tauri windows".

const root = fileURLToPath(new URL("../../../src-tauri/src", import.meta.url));

// macOS-only modules: not built or checked on this Windows fork.
const macOnly = new Set(["macos.rs", "macos_background.rs", "mono_chat.rs", "trackpad_zoom.rs"]);

// Commands only the quick composer and its Git popup call. Those are windows of
// their own and never hold a Browser page.
const composerCommands = new Set([
  "quick_composer_fit",
  "quick_composer_submit",
  "quick_composer_capture",
  "quick_composer_release_capture",
  "quick_composer_dismiss",
  "quick_git_open",
  "quick_git_state",
  "quick_git_fit",
  "quick_git_complete",
]);

function rustFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return rustFiles(path);
    return name.endsWith(".rs") && !macOnly.has(name) ? [path] : [];
  });
}

const files = rustFiles(root).map((path) => ({
  name: relative(root, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

describe("Tauri window arguments (L-218)", () => {
  it("finds the Rust sources", () => {
    expect(files.some((file) => file.name === "control.rs")).toBe(true);
  });

  it("no workspace command takes a WebviewWindow", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of file.text.matchAll(/#\[tauri::command\][^{]*?fn\s+(\w+)\s*(?:<[^>]*>)?\(([^{]*)\{/g)) {
        const [, name, signature] = match;
        if (/\bWebviewWindow\b/.test(signature!) && !composerCommands.has(name!)) {
          offenders.push(`${file.name}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("looks up workspace windows with get_window or windows()", () => {
    const offenders: string[] = [];
    let mainLookups = 0;
    for (const file of files) {
      file.text.split(/\r?\n/).forEach((line, index) => {
        if (!/get_webview_window\(|webview_windows\(\)/.test(line)) return;
        // The composer panels, and macOS code turning a checked `Window` back
        // into its webview window, are fine.
        if (/QUICK_COMPOSER(_GIT)?_LABEL/.test(line)) return;
        if (/\.get_webview_window\((window|page)\.label\(\)\)/.test(line)) return;
        // Startup in lib.rs, before any Browser page exists.
        if (file.name === "lib.rs" && line.includes('app.get_webview_window("main")')) {
          mainLookups += 1;
          return;
        }
        offenders.push(`${file.name}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
    expect(mainLookups).toBeLessThanOrEqual(3);
  });
});
