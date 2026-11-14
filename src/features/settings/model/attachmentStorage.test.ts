import { describe, expect, it } from "vitest";
import {
  attachmentDisplayName,
  deleteConfirmation,
  filterByDate,
  groupStorage,
  isDateFiltered,
  isImageAttachment,
  parseDateInput,
  storageTotals,
  toDateInput,
  withoutDeleted,
  type AttachmentStorageScan,
  type StorageDateRange,
  type StoredAttachment,
} from "./attachmentStorage";

const file = (overrides: Partial<StoredAttachment> & { path: string }): StoredAttachment => ({
  name: overrides.path.split("/").pop() ?? "",
  size: 10,
  modifiedMs: 1,
  store: "pasted",
  sessionIds: [],
  ...overrides,
});

const scan: AttachmentStorageScan = {
  pastedRoot: "/tmp/monocode-attachments",
  interactiveRoot: "/data/interactive-attachments",
  files: [
    file({ path: "/t/1-1-a.png", modifiedMs: 5, sessionIds: ["s1"] }),
    file({ path: "/t/1-2-b.png", modifiedMs: 9, sessionIds: ["s2"], size: 30 }),
    file({ path: "/t/1-3-shared.png", modifiedMs: 3, sessionIds: ["s1", "s3"] }),
    file({ path: "/i/u/c.png", modifiedMs: 7, store: "interactive", sessionIds: ["s3"], size: 100 }),
    file({ path: "/t/1-4-loose.png", modifiedMs: 8 }),
  ],
  sessions: [
    { id: "s1", title: "Fix login", cwd: "E:\\repo\\web", harness: "claude", updatedAt: 10, archived: false },
    { id: "s2", title: "Docs", cwd: "E:/repo/docs", harness: "codex", updatedAt: 20, archived: true },
    { id: "s3", title: "Login tests", cwd: "e:/repo/web", harness: "claude", updatedAt: 30, archived: false },
  ],
};

describe("groupStorage (L-273)", () => {
  it("groups by chat, files a shared file once under the newest chat, unlinked last", () => {
    const groups = groupStorage(scan, "chat");
    expect(groups.map((group) => [group.key, group.files.map((f) => f.path)])).toEqual([
      ["s2", ["/t/1-2-b.png"]],
      ["s3", ["/i/u/c.png", "/t/1-3-shared.png"]],
      ["s1", ["/t/1-1-a.png"]],
      ["unlinked", ["/t/1-4-loose.png"]],
    ]);
    expect(groups[0]).toMatchObject({ subtitle: "docs · Archived", bytes: 30 });
    expect(groups[1]!.sharedCount).toBe(1);
  });

  it("groups by project with one key per folder, whatever the slashes or case", () => {
    const groups = groupStorage(scan, "project");
    expect(groups.map((group) => [group.title, group.files.length])).toEqual([
      ["docs", 1],
      ["web", 3],
      ["Not linked to a chat", 1],
    ]);
  });

  it("puts everything in one group for All, and nothing when empty", () => {
    expect(groupStorage(scan, "all")[0]!.files.map((f) => f.modifiedMs)).toEqual([9, 8, 7, 5, 3]);
    expect(groupStorage({ ...scan, files: [] }, "chat")).toEqual([]);
  });
});

describe("storage helpers (L-273)", () => {
  it("totals pasted files and Claude copies apart", () => {
    expect(storageTotals(scan.files)).toEqual({ count: 5, bytes: 160, pastedBytes: 60, interactiveBytes: 100 });
  });

  it("names files the way the user knows them", () => {
    expect(attachmentDisplayName({ name: "4242-1731000000000-Screenshot 1.png", store: "pasted" })).toBe("Screenshot 1.png");
    expect(attachmentDisplayName({ name: "0b1c.png", store: "interactive" })).toBe("Claude copy (.png)");
    expect(isImageAttachment({ name: "a.JPG" })).toBe(true);
    expect(isImageAttachment({ name: "a.pdf" })).toBe(false);
  });

  it("drops deleted files and chats left without files", () => {
    const next = withoutDeleted(scan, ["/t/1-2-b.png"]);
    expect(next.files).toHaveLength(4);
    expect(next.sessions.map((session) => session.id)).toEqual(["s1", "s3"]);
  });

  it("warns that chats lose their images and when another chat shares one", () => {
    expect(deleteConfirmation([scan.files[2]!], "from Fix login")).toBe(
      "Delete this file from Fix login?\nThese images disappear from the chats that show them.\n1 is also shown in another chat.\nThis cannot be undone.",
    );
    expect(deleteConfirmation([scan.files[4]!, scan.files[3]!], "not linked to a chat")).toBe(
      "Delete 2 files not linked to a chat?\nThis cannot be undone.",
    );
  });
});

describe("date filter (L-273)", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  const now = at(2026, 11, 14, 10);
  const dated: AttachmentStorageScan = {
    ...scan,
    files: [
      file({ path: "/t/today", modifiedMs: at(2026, 11, 14, 0) }),
      file({ path: "/t/six-days", modifiedMs: at(2026, 11, 8, 1) }),
      file({ path: "/t/seven-days", modifiedMs: at(2026, 11, 7, 23) }),
      file({ path: "/t/old", modifiedMs: at(2026, 10, 1) }),
    ],
  };
  const paths = (preset: StorageDateRange["preset"], from = "", to = "") =>
    filterByDate(dated, { preset, from, to }, now).files.map((f) => f.path);

  it("keeps whole local days for the presets", () => {
    expect(paths("all")).toHaveLength(4);
    expect(paths("today")).toEqual(["/t/today"]);
    expect(paths("last-7")).toEqual(["/t/today", "/t/six-days"]);
    expect(paths("last-30")).toEqual(["/t/today", "/t/six-days", "/t/seven-days"]);
    expect(paths("older-30")).toEqual(["/t/old"]);
  });

  it("filters one day, a from-to range, open ends and a backwards range", () => {
    expect(paths("custom", "2026-11-08", "2026-11-08")).toEqual(["/t/six-days"]);
    expect(paths("custom", "2026-11-07", "2026-11-14")).toEqual(["/t/today", "/t/six-days", "/t/seven-days"]);
    expect(paths("custom", "2026-11-14", "2026-11-07")).toEqual(["/t/today", "/t/six-days", "/t/seven-days"]);
    expect(paths("custom", "", "2026-11-07")).toEqual(["/t/seven-days", "/t/old"]);
    expect(paths("custom", "2026-11-08", "")).toEqual(["/t/today", "/t/six-days"]);
    expect(paths("custom", "", "")).toHaveLength(4);
    expect(isDateFiltered({ preset: "custom", from: "", to: "" })).toBe(false);
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(toDateInput(now)).toBe("2026-11-14");
  });
});
