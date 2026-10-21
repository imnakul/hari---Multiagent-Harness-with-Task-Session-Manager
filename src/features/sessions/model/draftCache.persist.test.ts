import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SAVED_DRAFT_CHARS,
  MAX_SAVED_DRAFTS,
  mergeSavedDrafts,
  parseSavedDrafts,
  SAVED_DRAFT_MAX_AGE_MS,
} from "./draftCache";

const KEY = "monocode.composerDrafts.v1";
const NOW = 1_800_000_000_000;

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saved composer drafts (L-160)", () => {
  it("restores a typed draft after a reload", async () => {
    vi.useFakeTimers();
    const first = await import("./draftCache");
    first.setComposerDraft("s1", "unsent prompt");
    expect(store.has(KEY)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(store.has(KEY)).toBe(true);

    vi.resetModules();
    const reloaded = await import("./draftCache");
    expect(reloaded.getComposerDraft("s1")).toBe("unsent prompt");
  });

  it("forgets a draft once it is sent or cleared", async () => {
    const cache = await import("./draftCache");
    cache.setComposerDraft("s1", "one");
    cache.setComposerDraft("s2", "two");
    cache.flushSavedDrafts();
    cache.setComposerDraft("s1", "");
    cache.clearComposerDraft("s2");
    cache.flushSavedDrafts();

    vi.resetModules();
    const reloaded = await import("./draftCache");
    expect(reloaded.getComposerDraft("s1")).toBeUndefined();
    expect(reloaded.getComposerDraft("s2")).toBeUndefined();
  });

  it("keeps another window's drafts when saving", async () => {
    const cache = await import("./draftCache");
    // Another window saved a draft after this one loaded.
    store.set(KEY, JSON.stringify({ other: { text: "theirs", savedAt: Date.now() } }));
    cache.setComposerDraft("mine", "ours");
    cache.flushSavedDrafts();
    const saved = JSON.parse(store.get(KEY) ?? "{}") as Record<string, { text: string }>;
    expect(saved.other?.text).toBe("theirs");
    expect(saved.mine?.text).toBe("ours");
  });

  it("starts empty when storage holds junk", async () => {
    store.set(KEY, "{not json");
    const cache = await import("./draftCache");
    expect(cache.getComposerDraft("s1")).toBeUndefined();
  });
});

describe("parseSavedDrafts / mergeSavedDrafts (L-160)", () => {
  it("drops malformed, empty, oversized and expired entries", () => {
    const parsed = parseSavedDrafts(
      {
        ok: { text: "keep", savedAt: NOW },
        empty: { text: "", savedAt: NOW },
        wrong: { text: 5, savedAt: NOW },
        noTime: { text: "x" },
        huge: { text: "a".repeat(MAX_SAVED_DRAFT_CHARS + 1), savedAt: NOW },
        old: { text: "stale", savedAt: NOW - SAVED_DRAFT_MAX_AGE_MS - 1 },
        nothing: null,
      },
      NOW,
    );
    expect([...parsed.keys()]).toEqual(["ok"]);
    expect(parseSavedDrafts(["a"], NOW).size).toBe(0);
    expect(parseSavedDrafts("text", NOW).size).toBe(0);
  });

  it("keeps the most recently edited drafts up to the cap", () => {
    const stored = new Map(
      Array.from({ length: MAX_SAVED_DRAFTS }, (_, i) => [
        `old${i}`,
        { text: "x", savedAt: NOW - 1000 + i },
      ]),
    );
    const merged = mergeSavedDrafts(stored, new Map([["new", "fresh"]]), NOW);
    const ids = Object.keys(merged);
    expect(ids).toHaveLength(MAX_SAVED_DRAFTS);
    expect(ids[0]).toBe("new");
    expect(ids).not.toContain("old0");
  });

  it("removes a draft that grew past the size limit", () => {
    const stored = new Map([["s1", { text: "short", savedAt: NOW }]]);
    const merged = mergeSavedDrafts(
      stored,
      new Map([["s1", "a".repeat(MAX_SAVED_DRAFT_CHARS + 1)]]),
      NOW,
    );
    expect(merged.s1).toBeUndefined();
  });
});
