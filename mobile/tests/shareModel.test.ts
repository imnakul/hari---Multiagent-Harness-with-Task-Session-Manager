import { describe, expect, it } from "vitest";

import {
  addShareEntry,
  base64ToBytes,
  bytesToBase64,
  formatShareSize,
  kindForText,
  MAX_SHARE_HISTORY,
  parseDownloadPiece,
  parseIncomingShare,
  parsePendingShares,
  parseShareHistory,
  parseUploadAnswer,
  safeFileName,
  settleInterrupted,
  shareCaption,
  updateShareEntry,
  type PhoneShareEntry,
} from "@/features/share/shareModel";

const entry = (id: string, change: Partial<PhoneShareEntry> = {}): PhoneShareEntry => ({
  id,
  direction: "out",
  kind: "text",
  text: "hello",
  at: 1,
  status: "done",
  ...change,
});

describe("base64", () => {
  it("round-trips every length and matches Node's encoding", () => {
    for (let length = 0; length < 20; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      expect([...base64ToBytes(encoded)]).toEqual([...bytes]);
    }
  });

  it("round-trips more than one internal block", () => {
    const bytes = Uint8Array.from({ length: 3 * 4096 * 2 + 5 }, (_, index) => index % 251);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("refuses text that isn't base64", () => {
    expect(() => base64ToBytes("abc")).toThrow();
    expect(() => base64ToBytes("ab!d")).toThrow();
  });
});

describe("kindForText", () => {
  it("calls a single web address a link", () => {
    expect(kindForText("  https://example.com/a?b=1 ")).toBe("link");
    expect(kindForText("see https://example.com")).toBe("text");
    expect(kindForText("ftp://example.com")).toBe("text");
  });
});

describe("parseIncomingShare", () => {
  it("reads texts and file offers", () => {
    expect(parseIncomingShare({ type: "clipboard", text: "x" })).toEqual({ type: "clipboard", text: "x" });
    expect(
      parseIncomingShare({ type: "file", fileId: "f1", name: "../a:b.txt", mimeType: "text/plain", size: 3 }),
    ).toEqual({ type: "file", fileId: "f1", name: "a_b.txt", mimeType: "text/plain", size: 3 });
  });

  it("drops the wrong shapes", () => {
    expect(parseIncomingShare({ type: "text", text: "  " })).toBeNull();
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: -1 })).toBeNull();
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: 200 * 1024 * 1024 })).toBeNull();
    expect(parseIncomingShare({ type: "other", text: "x" })).toBeNull();
    expect(parseIncomingShare(null)).toBeNull();
  });

  it("falls back to a generic type for a bad MIME type", () => {
    expect(parseIncomingShare({ type: "file", fileId: "f", name: "a", mimeType: "bad", size: 1 })).toMatchObject({
      mimeType: "application/octet-stream",
    });
  });
});

describe("history", () => {
  it("keeps valid entries only", () => {
    const parsed = parseShareHistory([
      entry("a"),
      { ...entry("b"), status: "lost" },
      { ...entry("c"), kind: "file", text: undefined },
      { ...entry("d"), kind: "file", name: "x.pdf", size: 4, progress: 2 },
      "junk",
    ]);
    expect(parsed.map((item) => item.id)).toEqual(["a", "d"]);
    expect(parsed[1]?.progress).toBeUndefined();
    expect(parseShareHistory({})).toEqual([]);
  });

  it("adds newest first, replaces the same id, and keeps the last 100", () => {
    let history: PhoneShareEntry[] = [];
    for (let index = 0; index < MAX_SHARE_HISTORY + 5; index += 1) history = addShareEntry(history, entry(`e${index}`));
    expect(history).toHaveLength(MAX_SHARE_HISTORY);
    expect(history[0]?.id).toBe(`e${MAX_SHARE_HISTORY + 4}`);
    history = addShareEntry(history, entry("e50", { text: "again" }));
    expect(history.filter((item) => item.id === "e50")).toHaveLength(1);
    expect(history[0]?.text).toBe("again");
  });

  it("clears progress and errors that no longer apply", () => {
    const moving = updateShareEntry([entry("a")], "a", { status: "moving", progress: 0.5 });
    expect(moving[0]?.progress).toBe(0.5);
    const failed = updateShareEntry(moving, "a", { status: "failed", error: "no" });
    expect(failed[0]).toMatchObject({ status: "failed", error: "no" });
    expect(failed[0]?.progress).toBeUndefined();
    expect(updateShareEntry(failed, "a", { status: "queued" })[0]?.error).toBeUndefined();
  });

  it("marks transfers a restart stopped as failed", () => {
    const settled = settleInterrupted([entry("a", { status: "moving", progress: 0.3 }), entry("b")]);
    expect(settled[0]).toMatchObject({ status: "failed", error: "Stopped when Hari closed" });
    expect(settled[1]?.status).toBe("done");
  });
});

describe("shareCaption", () => {
  it("says what, which way and how far", () => {
    expect(shareCaption(entry("a", { kind: "clipboard", direction: "in" }))).toBe("Clipboard from your computer");
    expect(shareCaption(entry("a", { kind: "file", status: "moving", progress: 0.426 }))).toBe(
      "File to your computer · 43%",
    );
    expect(shareCaption(entry("a", { kind: "link", status: "queued" }))).toBe("Link to your computer · waiting");
    expect(shareCaption(entry("a", { status: "failed" }))).toBe("Text to your computer · failed");
  });
});

describe("safeFileName and formatShareSize", () => {
  it("strips folders and characters Windows refuses", () => {
    expect(safeFileName("C:\\Users\\me\\re*port?.pdf")).toBe("re_port_.pdf");
    expect(safeFileName("..hidden")).toBe("hidden");
    expect(safeFileName("///")).toBe("file");
    expect(safeFileName("a".repeat(300))).toHaveLength(150);
  });

  it("formats sizes", () => {
    expect(formatShareSize(820)).toBe("820 B");
    expect(formatShareSize(14 * 1024)).toBe("14 KB");
    expect(formatShareSize(3.25 * 1024 * 1024)).toBe("3.3 MB");
    expect(formatShareSize(42 * 1024 * 1024)).toBe("42 MB");
  });
});

describe("answers from the computer", () => {
  it("reads download pieces and upload answers", () => {
    expect(parseDownloadPiece({ data: "AQID", size: 3 })).toEqual({ data: Uint8Array.from([1, 2, 3]), size: 3 });
    expect(() => parseDownloadPiece({ data: 1, size: 3 })).toThrow();
    expect(parseUploadAnswer({ received: 10, done: false })).toEqual({ received: 10, done: false });
    expect(() => parseUploadAnswer({ received: "10", done: false })).toThrow();
  });
});

describe("parsePendingShares", () => {
  it("reads what the share sheet and the tile left", () => {
    expect(
      parsePendingShares([
        { type: "clipboard", text: "copied" },
        { type: "text", text: " " },
        { type: "file", uri: "file:///cache/hari-share/1/a.png", name: "a.png", mimeType: "image/png", size: 5 },
        { type: "file", uri: "", size: 5 },
        { type: "nope" },
      ]),
    ).toEqual([
      { type: "clipboard", text: "copied" },
      { type: "file", uri: "file:///cache/hari-share/1/a.png", name: "a.png", mimeType: "image/png", size: 5 },
    ]);
    expect(parsePendingShares("x")).toEqual([]);
  });
});
