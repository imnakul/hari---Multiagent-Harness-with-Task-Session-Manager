// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

import {
  cleanSessionLabel,
  getSessionMetadata,
  hasSessionMetadata,
  parseSessionMetadata,
  parseSessionMetadataRows,
  resetSessionMetadataStoreForTests,
  saveSessionMetadata,
  SESSION_LABEL_MAX,
  SESSION_NOTES_MAX,
  sessionMetadataError,
  sessionMetadataSnapshot,
  subscribeSessionMetadata,
} from "./sessionMetadata";

const ROW = {
  sessionId: "s1",
  label: "Auth spike",
  notes: "- [ ] cookie",
  updatedAt: 3,
};

afterEach(() => {
  resetSessionMetadataStoreForTests();
  invoke.mockReset();
});

describe("session metadata parsing (L-181)", () => {
  it("keeps valid rows and drops broken ones", () => {
    expect(parseSessionMetadata(ROW)).toEqual(ROW);
    expect(parseSessionMetadata({ ...ROW, sessionId: "" })).toBeNull();
    expect(parseSessionMetadata({ ...ROW, updatedAt: "3" })).toBeNull();
    expect(parseSessionMetadata(null)).toBeNull();
    expect(parseSessionMetadataRows([ROW, { nope: true }, 4])).toEqual([ROW]);
    expect(parseSessionMetadataRows("rows")).toEqual([]);
  });
});

describe("session metadata validation (L-181)", () => {
  it("keeps the label on one line", () => {
    expect(cleanSessionLabel("  Auth\r\n spike\t")).toBe("Auth spike");
  });

  it("counts label characters, not UTF-16 units, and notes in bytes", () => {
    expect(sessionMetadataError("😀".repeat(SESSION_LABEL_MAX), "")).toBeNull();
    expect(sessionMetadataError("x".repeat(SESSION_LABEL_MAX + 1), "")).toMatch(
      /longer than/,
    );
    expect(sessionMetadataError("", "x".repeat(SESSION_NOTES_MAX))).toBeNull();
    expect(
      sessionMetadataError("", "é".repeat(SESSION_NOTES_MAX / 2 + 1)),
    ).toMatch(/too long/);
  });

  it("treats whitespace-only metadata as none", () => {
    expect(hasSessionMetadata(null)).toBe(false);
    expect(hasSessionMetadata({ label: " ", notes: "\n" })).toBe(false);
    expect(hasSessionMetadata({ label: "", notes: "x" })).toBe(true);
  });
});

describe("session metadata store (L-181)", () => {
  it("loads on the first subscriber and notifies on changes", async () => {
    invoke.mockResolvedValueOnce([ROW]);
    let calls = 0;
    const unsubscribe = subscribeSessionMetadata(() => calls++);
    await vi.waitFor(() => expect(getSessionMetadata("s1")).toEqual(ROW));
    expect(invoke).toHaveBeenCalledWith("session_metadata_list");
    expect(calls).toBe(1);
    unsubscribe();
  });

  it("updates the map after a save, and drops the row when cleared", async () => {
    invoke.mockResolvedValueOnce({ ...ROW, label: "New" });
    const before = sessionMetadataSnapshot();
    await saveSessionMetadata("s1", "New", ROW.notes);
    expect(invoke).toHaveBeenCalledWith("session_metadata_upsert", {
      metadata: { sessionId: "s1", label: "New", notes: ROW.notes },
    });
    expect(getSessionMetadata("s1")?.label).toBe("New");
    expect(sessionMetadataSnapshot()).not.toBe(before);

    invoke.mockResolvedValueOnce(null);
    await saveSessionMetadata("s1", "", "");
    expect(getSessionMetadata("s1")).toBeNull();
  });

  it("keeps the map when a save fails", async () => {
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveSessionMetadata("s1", "x", "")).rejects.toThrow(
      "disk full",
    );
    expect(getSessionMetadata("s1")).toBeNull();
  });
});
