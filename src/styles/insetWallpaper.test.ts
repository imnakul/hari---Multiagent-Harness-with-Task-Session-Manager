import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// happy-dom rewrites import.meta.url, so resolve from the vitest root instead.
const CSS = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): { body: string; index: number } {
  const index = CSS.indexOf(`${selector} {`);
  expect(index, selector).toBeGreaterThanOrEqual(0);
  const start = CSS.indexOf("{", index);
  return { body: CSS.slice(start + 1, CSS.indexOf("}", start)), index };
}

describe("inset layout over a Windows wallpaper (L-126)", () => {
  it("tints the card only by Glass strength, after the upstream panel fills", () => {
    const card = ruleBody("html.is-windows.has-app-wallpaper .inset-card");
    expect(card.body).toContain("var(--window-glass-tint-opacity)");
    expect(card.body).toContain("var(--inset-panel)");
    // Equal specificity, so it must come later to win.
    expect(card.index).toBeGreaterThan(
      CSS.indexOf("html.has-native-glass:not(.theme-light) .inset-card {"),
    );
    expect(card.index).toBeGreaterThan(CSS.indexOf(".inset-card {"));
  });

  it("paints the wallpaper's opaque base in the workspace theme's shell colour", () => {
    const base = ruleBody("html.is-windows.has-app-wallpaper.layout-inset .app-shell::before");
    expect(base.body).toContain("var(--inset-surface)");
  });
});
