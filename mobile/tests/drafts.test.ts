import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItemSync: (key: string) => saved.get(key) ?? null,
    setItem: async (key: string, value: string) => void saved.set(key, value),
    removeItem: async (key: string) => void saved.delete(key),
  },
}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: vi.fn() }));

import { sendProblem, settle, type Attachment } from "@/features/sessions/attachments";
import { readDraft, writeDraft } from "@/features/sessions/drafts";

const photo = (id: string, data = "", preparing?: boolean): Attachment => ({
  id,
  name: `${id}.jpg`,
  mimeType: "image/jpeg",
  size: 1,
  uri: `file:///${id}.jpg`,
  data,
  preparing,
});

describe("drafts (L-235)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saved.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("keeps each chat's unsent message apart", () => {
    writeDraft("session:a", { text: "half a thought", attachments: [photo("p")] });
    writeDraft("session:b", { text: "other", attachments: [] });
    expect(readDraft("session:a")).toEqual({ text: "half a thought", attachments: [photo("p")] });
    expect(readDraft("session:b").text).toBe("other");
    expect(readDraft("session:c")).toEqual({ text: "", attachments: [] });
  });

  it("saves the words, not the files, for after a restart", async () => {
    writeDraft("mono:m", { text: "keep me", attachments: [photo("p")] });
    await vi.runAllTimersAsync();
    expect(saved.get("hari.draft.mono:m")).toBe("keep me");
  });

  it("forgets a draft once it's empty, as after sending", async () => {
    writeDraft("new:p", { text: "x", attachments: [] });
    await vi.runAllTimersAsync();
    writeDraft("new:p", { text: "", attachments: [] });
    await vi.runAllTimersAsync();
    expect(saved.has("hari.draft.new:p")).toBe(false);
    expect(readDraft("new:p").text).toBe("");
  });
});

describe("attachments being prepared (L-235)", () => {
  it("puts a finished photo in its placeholder's place", () => {
    const held = [photo("a", "", true), photo("b", "BBB")];
    expect(settle(held, photo("a", "AAA"))).toEqual([photo("a", "AAA"), photo("b", "BBB")]);
  });

  it("drops a finished photo whose placeholder was removed", () => {
    expect(settle([photo("b", "BBB")], photo("a", "AAA"))).toEqual([photo("b", "BBB")]);
  });

  it("refuses a message over the link's limit", () => {
    expect(sendProblem([photo("a", "x".repeat(100))])).toBeNull();
    expect(sendProblem([photo("a", "x".repeat(25 * 1024 * 1024))])).toMatch(/too large/);
  });
});
