import { describe, expect, it } from "vitest";

import {
  fillShareHistory,
  shouldFillShareHistory,
  parseComputerHistory,
  parseShareMeta,
  withExtension,
  addShareEntry,
  base64ToBytes,
  bytesToBase64,
  formatShareSize,
  nextShareFollow,
  sharePinsOnResize,
  sharePinsToEnd,
  SHARE_AT_END,
  kindForText,
  MAX_SHARE_HISTORY,
  matchesShareSearch,
  setShareHistoryLimit,
  shareCounted,
  parseDownloadPiece,
  parseIncomingShare,
  parsePendingShares,
  parseShareHistory,
  parseUploadAnswer,
  safeFileName,
  settleInterrupted,
  shareCaption,
  shareDay,
  shareStamp,
  shareState,
  shareThumbnail,
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

  it("keeps a file the phone asked for as auto (L-349), and nothing else as auto", () => {
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: 3, auto: true })).toMatchObject({ auto: true });
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: 3, auto: "yes" })).not.toHaveProperty("auto");
  });

  it("drops the wrong shapes", () => {
    expect(parseIncomingShare({ type: "text", text: "  " })).toBeNull();
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: -1 })).toBeNull();
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: 2 * 1024 * 1024 * 1024 })).toBeNull();
    expect(parseIncomingShare({ type: "file", fileId: "f1", name: "a", size: 200 * 1024 * 1024 })).not.toBeNull();
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

  it("keeps the Share bubble's ids and its Undo (L-321)", () => {
    expect(
      parsePendingShares([
        { type: "clipboard", text: "copied", id: "0b6c-4f1e" },
        { type: "file", uri: "file:///cache/hari-share/2/b.png", name: "b.png", mimeType: "image/png", size: 7, id: "a1" },
        { type: "text", text: "bad id", id: "no spaces allowed" },
        { type: "undo", ids: ["0b6c-4f1e", "not valid!"] },
        { type: "undo", ids: [] },
      ]),
    ).toEqual([
      { type: "clipboard", text: "copied", id: "0b6c-4f1e" },
      { type: "file", uri: "file:///cache/hari-share/2/b.png", name: "b.png", mimeType: "image/png", size: 7, id: "a1" },
      { type: "text", text: "bad id" },
      { type: "undo", ids: ["0b6c-4f1e"] },
    ]);
  });
});

describe("shareThumbnail (L-288)", () => {
  const picture: PhoneShareEntry = {
    id: "p",
    direction: "in",
    kind: "file",
    name: "Screenshot.png",
    mimeType: "image/png",
    uri: "content://media/1",
    at: 1,
    status: "done",
  };
  it("draws a received picture from where it was saved", () => {
    expect(shareThumbnail(picture)).toBe("content://media/1");
  });
  it("draws a sent picture from its copy", () => {
    expect(shareThumbnail({ ...picture, direction: "out", status: "queued", uri: "file:///c/p.png" })).toBe("file:///c/p.png");
  });
  it("skips a picture not saved yet, other files and texts", () => {
    expect(shareThumbnail({ ...picture, status: "moving" })).toBeNull();
    expect(shareThumbnail({ ...picture, mimeType: "application/pdf" })).toBeNull();
    expect(shareThumbnail({ ...picture, uri: undefined })).toBeNull();
    expect(shareThumbnail({ id: "t", direction: "in", kind: "text", text: "hi", at: 1, status: "done" })).toBeNull();
  });
});

describe("shareDay (L-288)", () => {
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  it("names today and yesterday", () => {
    expect(shareDay(new Date(2026, 10, 14, 0, 1).getTime(), now)).toBe("Today");
    expect(shareDay(new Date(2026, 10, 13, 23, 59).getTime(), now)).toBe("Yesterday");
  });
  it("dates anything older", () => {
    expect(shareDay(new Date(2026, 10, 1).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
});

describe("filling in from the computer (L-317)", () => {
  const reply = {
    entries: [
      { id: "t1", direction: "out", kind: "text", at: 3, text: "hi", pinned: true },
      { id: "f1", direction: "in", kind: "file", at: 2, name: "a.jpg", size: 5, offered: true },
      { id: "f2", direction: "in", kind: "file", at: 1, name: "b.pdf", offered: false },
      { id: "f3", direction: "out", kind: "file", at: 0, name: "c.png" },
      { id: "bad", direction: "in", kind: "file", at: 0 },
    ],
  };

  it("maps the computer's history to entries here", () => {
    const entries = parseComputerHistory(reply);
    expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
      ["t1", "done"],
      ["f1", "offered"],
      ["f2", "failed"],
      ["f3", "done"],
    ]);
    expect(entries[0].pinned).toBe(true);
    expect(entries[1].fileId).toBe("f1");
    expect(entries[2].error).toBe("No longer on the computer");
    expect(entries[3].fileId).toBeUndefined();
    expect(parseComputerHistory(null)).toEqual([]);
  });

  it("adds only what is missing and was not removed here", () => {
    const computer = parseComputerHistory(reply);
    const local = [{ id: "t1", direction: "out" as const, kind: "text" as const, at: 3, status: "done" as const, text: "mine" }];
    const filled = fillShareHistory(local, computer, new Set(["f2"]));
    expect(filled.map((entry) => entry.id)).toEqual(["t1", "f1", "f3"]);
    expect(filled[0].text).toBe("mine");
    const same = fillShareHistory(filled, computer, new Set(["f2"]));
    expect(same).toBe(filled);
  });

  it("fills in once per pairing, or when the phone has no history (L-323)", () => {
    expect(shouldFillShareHistory(false, null, "pc:1")).toBe(true);
    expect(shouldFillShareHistory(false, "pc:1", "pc:1")).toBe(false);
    expect(shouldFillShareHistory(true, "pc:1", "pc:1")).toBe(true);
    expect(shouldFillShareHistory(false, "pc:1", "pc:2")).toBe(true);
  });

  it("reads a remove from the other device", () => {
    expect(parseShareMeta({ type: "meta", action: "remove", ids: ["a", 3] })).toEqual({
      type: "meta",
      action: "remove",
      ids: ["a"],
    });
  });
});

describe("withExtension (L-317)", () => {
  it("adds an ending from the type when there is none", () => {
    expect(withExtension("image_8623", "image/jpeg")).toBe("image_8623.jpg");
    expect(withExtension("clip", "video/mp4; codecs=avc1")).toBe("clip.mp4");
    expect(withExtension("photo.png", "image/jpeg")).toBe("photo.png");
    expect(withExtension("blob", "application/octet-stream")).toBe("blob");
  });
});

describe("message stamp and state (L-326)", () => {
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  it("puts the day before the time", () => {
    expect(shareStamp(new Date(2026, 10, 14, 9, 5).getTime(), now)).toMatch(/^Today · .*9.*05/);
    expect(shareStamp(new Date(2026, 10, 13, 22, 0).getTime(), now)).toMatch(/^Yesterday · /);
    expect(shareStamp(new Date(2026, 10, 1, 8, 0).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
  it("says only how a message is moving, not which way", () => {
    expect(shareState(entry("a", { status: "moving", progress: 0.426 }))).toBe("43%");
    expect(shareState(entry("a", { status: "queued" }))).toBe("Waiting");
    expect(shareState(entry("a", { status: "failed" }))).toBe("Failed");
    expect(shareState(entry("a", { status: "offered", direction: "in" }))).toBe("Tap to download");
    expect(shareState(entry("a", { status: "done" }))).toBe("");
  });
});

describe("Share search and limit (L-356, L-357)", () => {
  it("matches every word across a message's texts and file names", () => {
    const items = [entry("a", { kind: "file", name: "Report.pdf", text: undefined }), entry("b", { text: "Q3 numbers" })];
    expect(matchesShareSearch(items, "report q3")).toBe(true);
    expect(matchesShareSearch(items, "invoice")).toBe(false);
    expect(matchesShareSearch(items, " ")).toBe(true);
  });

  it("keeps the chosen limit and counts only what rolls off", () => {
    expect(setShareHistoryLimit(42)).toBe(false);
    expect(setShareHistoryLimit(250)).toBe(true);
    let history: PhoneShareEntry[] = [];
    for (let index = 0; index < 260; index += 1) history = addShareEntry(history, entry(`e${index}`));
    expect(history).toHaveLength(250);
    expect(shareCounted([...history.slice(0, 2), entry("p", { pinned: true })])).toBe(2);
    setShareHistoryLimit(MAX_SHARE_HISTORY);
  });
});

describe("nextShareFollow (L-409)", () => {
  const atRest = { following: true, dragging: false };

  it("stops following the end as soon as a drag starts, even inside the end zone", () => {
    const dragged = nextShareFollow(atRest, { type: "drag" });
    const nudged = nextShareFollow(dragged, { type: "scroll", below: 10 });
    expect(sharePinsToEnd(nudged)).toBe(false);
  });

  it("follows again only when the list rests at its end", () => {
    const dragged = nextShareFollow(atRest, { type: "drag" });
    expect(sharePinsToEnd(nextShareFollow(dragged, { type: "settle", below: 400 }))).toBe(false);
    expect(sharePinsToEnd(nextShareFollow(dragged, { type: "settle", below: 20 }))).toBe(true);
  });

  it("tracks the position from scrolls while no finger is down", () => {
    const up = nextShareFollow(atRest, { type: "scroll", below: 400 });
    expect(sharePinsToEnd(up)).toBe(false);
    expect(sharePinsToEnd(nextShareFollow(up, { type: "scroll", below: SHARE_AT_END - 1 }))).toBe(true);
  });

  it("follows after sending, from anywhere", () => {
    const up = nextShareFollow(atRest, { type: "settle", below: 900 });
    expect(sharePinsToEnd(nextShareFollow(up, { type: "sent" }))).toBe(true);
  });
});

describe("sharePinsOnResize (L-411)", () => {
  const following = { following: true, dragging: false };
  it("moves to the end only within the hold after opening or a new message", () => {
    expect(sharePinsOnResize(following, 1_000, 2_500)).toBe(true);
    expect(sharePinsOnResize(following, 2_500, 2_500)).toBe(false);
  });
  it("leaves a scrolled chat alone when a card loads later, even if drag events never came", () => {
    expect(sharePinsOnResize(following, 60_000, 2_500)).toBe(false);
  });
  it("never moves while scrolled back or dragging", () => {
    expect(sharePinsOnResize({ following: false, dragging: false }, 1_000, 2_500)).toBe(false);
    expect(sharePinsOnResize({ following: true, dragging: true }, 1_000, 2_500)).toBe(false);
  });
});
