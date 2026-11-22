import { describe, expect, it } from "vitest";
import { clickupVisibleFor, parseClickupConfig, parseClickupListRef } from "./clickupConfig";

describe("clickupConfig (L-381)", () => {
  it("reads a list from a link, a /v/l/ link or a bare ID (AC-C1)", () => {
    expect(parseClickupListRef("901234567")).toBe("901234567");
    expect(parseClickupListRef("https://app.clickup.com/123/v/li/901234567")).toBe("901234567");
    expect(parseClickupListRef("https://app.clickup.com/123/v/l/6-901234567-1")).toBe("901234567");
    expect(parseClickupListRef("https://example.com/v/li/901234567")).toBeNull();
    expect(parseClickupListRef("not a list")).toBeNull();
  });

  it("falls back to empty on bad stored data", () => {
    expect(parseClickupConfig("{nope")).toEqual({ projectPath: null, lists: [] });
    expect(parseClickupConfig(null).lists).toEqual([]);
  });

  it("shows ClickUp only in its linked project (AC-C2)", () => {
    const same = (a: string, b: string): boolean => a === b;
    expect(clickupVisibleFor({ projectPath: null, lists: [] }, null, same)).toBe(true);
    expect(clickupVisibleFor({ projectPath: "/a", lists: [] }, "/a", same)).toBe(true);
    expect(clickupVisibleFor({ projectPath: "/a", lists: [] }, "/b", same)).toBe(false);
    expect(clickupVisibleFor({ projectPath: "/a", lists: [] }, null, same)).toBe(false);
  });
});
