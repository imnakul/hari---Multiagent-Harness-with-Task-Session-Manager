import { describe, expect, it } from "vitest";
import { parseFileViewMode } from "./fileViewMode";

describe("parseFileViewMode", () => {
  it("keeps the three known views", () => {
    expect(parseFileViewMode("live")).toBe("live");
    expect(parseFileViewMode("preview")).toBe("preview");
    expect(parseFileViewMode("source")).toBe("source");
  });

  it("treats missing or unknown values as no choice", () => {
    expect(parseFileViewMode(null)).toBeNull();
    expect(parseFileViewMode("split")).toBeNull();
  });
});
