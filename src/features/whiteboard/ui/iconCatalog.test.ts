import { describe, expect, it } from "vitest";
import {
  catalogFromModule,
  iconLabel,
  iconSvg,
  loadIconCatalog,
  searchIcons,
  svgDataUrl,
  type CatalogIcon,
} from "./iconCatalog";

const glyph = [["path", { d: "M1 1L2 2", stroke: "currentColor", strokeWidth: "2", key: "0" }]] as const;

describe("iconCatalog", () => {
  it("turns export names into readable labels", () => {
    expect(iconLabel("ArrowUpRight01Icon")).toBe("Arrow up right 01");
    expect(iconLabel("Home01Icon")).toBe("Home 01");
    expect(iconLabel("AiChat02Icon")).toBe("Ai chat 02");
  });

  it("keeps one entry per glyph and skips non-icon exports", () => {
    const icons = catalogFromModule({
      Home01Icon: glyph,
      Home01: glyph,
      Home01FreeIcons: glyph,
      ZapIcon: [["path", { d: "M0 0" }]],
      default: {},
      VERSION: "1",
      EmptyIcon: [],
    });
    expect(icons.map((icon) => icon.name)).toEqual(["Home01Icon", "ZapIcon"]);
  });

  it("matches every search word and honours the limit", () => {
    const icons: CatalogIcon[] = ["ArrowUp01Icon", "ArrowDown01Icon", "UserIcon"].map((name) => ({
      name,
      label: iconLabel(name),
      nodes: glyph,
    }));
    expect(searchIcons(icons, "arrow up").map((icon) => icon.name)).toEqual(["ArrowUp01Icon"]);
    expect(searchIcons(icons, "  ")).toHaveLength(3);
    expect(searchIcons(icons, "arrow", 1)).toHaveLength(1);
    expect(searchIcons(icons, "nothing")).toEqual([]);
  });

  it("draws a one-colour SVG and escapes attributes", () => {
    const svg = iconSvg({ name: "X", label: "X", nodes: [["path", { d: 'M0 0"<', stroke: "currentColor", strokeWidth: "2", key: "0" }]] }, "#123456", 64, 1.5);
    expect(svg).toContain('width="64"');
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('d="M0 0&quot;&lt;"');
    expect(svg).not.toContain("key=");
    expect(svgDataUrl(svg).startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("loads the free Hugeicons set without duplicates", async () => {
    const icons = await loadIconCatalog();
    expect(icons.length).toBeGreaterThan(1000);
    expect(new Set(icons.map((icon) => icon.nodes)).size).toBe(icons.length);
  });
});
