import { describe, expect, it } from "vitest";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import { repoColors, repoColorStyle } from "./repoColors";

describe("repo colours (L-372)", () => {
  it("gives each repo a palette colour, skipping the grey one", () => {
    const colors = repoColors([
      { path: "E:/work/api", name: "api" },
      { path: "E:/work/web", name: "web" },
    ]);
    const [api, web] = [...colors.values()];
    expect(api).toBe(TAB_GROUP_COLORS[1]);
    expect(web).toBe(TAB_GROUP_COLORS[2]);
  });

  it("styles by mode", () => {
    expect(repoColorStyle("#f00", "off")).toBeUndefined();
    expect(repoColorStyle(undefined, "tint-bar")).toBeUndefined();
    expect(repoColorStyle("#f00", "tint")).toEqual({ backgroundColor: "color-mix(in srgb, #f00 12%, transparent)" });
    expect(repoColorStyle("#f00", "bar")).toEqual({ boxShadow: "inset 2px 0 0 #f00" });
    expect(Object.keys(repoColorStyle("#f00", "tint-bar") ?? {})).toEqual(["backgroundColor", "boxShadow"]);
  });
});
