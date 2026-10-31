import { beforeEach, describe, expect, it, vi } from "vitest";

// Node has no localStorage; each test starts from an empty one.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
});

async function fresh() {
  vi.resetModules();
  return import("./browserBookmarks");
}

describe("Browser bookmarks (L-226)", () => {
  beforeEach(() => storage.clear());

  it("adds a page on top, and removes it on a second toggle", async () => {
    const { isBookmarked, loadBookmarks, toggleBookmark } = await fresh();
    expect(toggleBookmark("https://a.example.com/", " A ")).toBe(true);
    expect(toggleBookmark("https://b.example.com/", "")).toBe(true);
    expect(loadBookmarks()).toEqual([
      { url: "https://b.example.com/", title: "" },
      { url: "https://a.example.com/", title: "A" },
    ]);
    expect(toggleBookmark("https://a.example.com/", "A")).toBe(false);
    expect(isBookmarked("https://a.example.com/")).toBe(false);
  });

  it("keeps bookmarks after a restart and skips anything but web pages", async () => {
    (await fresh()).toggleBookmark("https://a.example.com/", "A");
    expect((await fresh()).toggleBookmark("file:///C:/x.txt", "x")).toBe(false);
    storage.set(
      "monocode.browser.bookmarks",
      JSON.stringify([...JSON.parse(storage.get("monocode.browser.bookmarks")!), { url: "javascript:alert(1)" }]),
    );
    expect((await fresh()).loadBookmarks()).toEqual([{ url: "https://a.example.com/", title: "A" }]);
  });

  it("copies every tab's address once, in tab order", async () => {
    const { tabLinksText } = await fresh();
    expect(
      tabLinksText([
        { url: "https://a.example.com/" },
        { url: "" },
        { url: "", pending: "https://b.example.com/" },
        { url: "https://a.example.com/" },
      ]),
    ).toBe("https://a.example.com/\nhttps://b.example.com/");
  });
});
