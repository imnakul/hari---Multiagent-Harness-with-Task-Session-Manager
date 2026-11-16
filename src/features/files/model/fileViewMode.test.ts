import { describe, expect, it } from "vitest";
import { parseFileViewMode } from "./fileViewMode";

describe("parseFileViewMode", () => {
  it("keeps the two known views", () => {
    expect(parseFileViewMode("preview")).toBe("preview");
    expect(parseFileViewMode("source")).toBe("source");
  });

  it("opens a saved Live choice in Preview", () => {
    expect(parseFileViewMode("live")).toBe("preview");
  });

  it("treats missing or unknown values as no choice", () => {
    expect(parseFileViewMode(null)).toBeNull();
    expect(parseFileViewMode("split")).toBeNull();
  });
});
