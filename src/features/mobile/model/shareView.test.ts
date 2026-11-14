import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShareEntry } from "./mobileShare";
import {
  isShareMedia,
  markShareSeen,
  matchesShareFilter,
  readShareSeen,
  shareDays,
  subscribeShareSeen,
} from "./shareView";

const base: ShareEntry = { id: "t", direction: "in", kind: "text", text: "Hi", at: 0, status: "done" };
const file = (name: string, path?: string): ShareEntry => ({
  ...base,
  id: name,
  kind: "file",
  text: undefined,
  name,
  path,
});

describe("Share view (L-287)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells pictures and videos from other files", () => {
    expect(isShareMedia(file("photo.JPG"))).toBe(true);
    expect(isShareMedia(file("clip.mp4", "C:\\Downloads\\Hari\\clip.mp4"))).toBe(true);
    expect(isShareMedia(file("report.pdf"))).toBe(false);
    expect(isShareMedia({ ...base, text: "photo.png" })).toBe(false);
  });

  it("filters by kind", () => {
    const link: ShareEntry = { ...base, kind: "link", text: "https://example.com" };
    const clip: ShareEntry = { ...base, kind: "clipboard" };
    expect(matchesShareFilter(file("a.png"), "media")).toBe(true);
    expect(matchesShareFilter(file("a.png"), "files")).toBe(false);
    expect(matchesShareFilter(file("a.zip"), "files")).toBe(true);
    expect(matchesShareFilter(link, "links")).toBe(true);
    expect(matchesShareFilter(link, "text")).toBe(false);
    expect(matchesShareFilter(clip, "text")).toBe(true);
    expect(matchesShareFilter(clip, "all")).toBe(true);
  });

  it("groups newest-first history into days, oldest first", () => {
    const now = new Date(2026, 10, 14, 21, 0).getTime();
    const today = new Date(2026, 10, 14, 9, 0).getTime();
    const yesterday = new Date(2026, 10, 13, 18, 0).getTime();
    const older = new Date(2026, 10, 2, 8, 0).getTime();
    const days = shareDays(
      [
        { ...base, id: "c", at: today + 60_000 },
        { ...base, id: "b", at: today },
        { ...base, id: "y", at: yesterday },
        { ...base, id: "o", at: older },
      ],
      now,
    );
    expect(days.map((day) => day.items.map((entry) => entry.id))).toEqual([["o"], ["y"], ["b", "c"]]);
    expect(days[1]?.label).toBe("Yesterday");
    expect(days[2]?.label).toBe("Today");
  });

  it("only moves the seen mark forward and tells listeners", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const listener = vi.fn();
    const stop = subscribeShareSeen(listener);
    markShareSeen(50);
    markShareSeen(20);
    expect(readShareSeen()).toBe(50);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});
