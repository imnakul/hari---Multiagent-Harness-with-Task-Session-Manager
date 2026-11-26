import { describe, expect, it, vi } from "vitest";
import {
  FILE_TOO_BIG,
  MAX_TASK_FILE_BYTES,
  TOO_MANY_FILES,
  addPendingFiles,
  failedCount,
  toPendingFile,
  uploadAll,
  type ClickupPendingFile,
} from "./clickupUpload";

function file(id: string, patch: Partial<ClickupPendingFile> = {}): ClickupPendingFile {
  return { id, name: `${id}.png`, mimeType: "image/png", size: 10, path: `/tmp/${id}.png`, status: "pending", ...patch };
}

describe("addPendingFiles (L-395)", () => {
  it("keeps files up to 10 and reports the limit", () => {
    const current = Array.from({ length: 9 }, (_, i) => file(`a${i}`));
    const result = addPendingFiles(current, [file("x"), file("y")]);
    expect(result.files).toHaveLength(10);
    expect(result.error).toBe(TOO_MANY_FILES);
  });

  it("skips a file over 25 MB and keeps the rest", () => {
    const result = addPendingFiles([], [file("big", { size: MAX_TASK_FILE_BYTES + 1 }), file("ok")]);
    expect(result.files.map((f) => f.id)).toEqual(["ok"]);
    expect(result.error).toBe(FILE_TOO_BIG);
  });

  it("accepts exactly 25 MB with no error", () => {
    const result = addPendingFiles([], [file("edge", { size: MAX_TASK_FILE_BYTES })]);
    expect(result.files).toHaveLength(1);
    expect(result.error).toBeNull();
  });
});

describe("toPendingFile (L-395)", () => {
  it("prefers the path and drops data so Rust gets exactly one source", () => {
    const pending = toPendingFile({ id: "1", name: "a", mimeType: "", size: 1, path: "/a", data: "AAA" });
    expect(pending).toMatchObject({ path: "/a", mimeType: "application/octet-stream", status: "pending" });
    expect(pending?.data).toBeUndefined();
  });

  it("returns null when there is nothing to read", () => {
    expect(toPendingFile({ id: "1", name: "a", mimeType: "x", size: 1 })).toBeNull();
  });
});

describe("uploadAll (L-395)", () => {
  it("uploads in order and does not stop on a failure", async () => {
    const order: string[] = [];
    const upload = vi.fn(async (_task: string, f: { name: string }) => {
      order.push(f.name);
      if (f.name === "b.png") throw new Error("boom");
    });
    const result = await uploadAll("T1", [file("a"), file("b"), file("c")], upload);
    expect(order).toEqual(["a.png", "b.png", "c.png"]);
    expect(result.map((f) => f.status)).toEqual(["done", "failed", "done"]);
    expect(failedCount(result)).toBe(1);
  });

  it("retries only the failed files, to the same task", async () => {
    const upload = vi.fn().mockResolvedValue({});
    const result = await uploadAll("T1", [file("a", { status: "done" }), file("b", { status: "failed" })], upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe("T1");
    expect(result.map((f) => f.status)).toEqual(["done", "done"]);
  });

  it("reports progress as position of total among the files to upload", async () => {
    const seen: string[] = [];
    await uploadAll("T1", [file("a"), file("b")], async () => ({}), (p, t) => seen.push(`${p}/${t}`));
    expect(seen).toEqual(["1/2", "2/2"]);
  });

  it("stops when told to", async () => {
    const upload = vi.fn().mockResolvedValue({});
    let calls = 0;
    await uploadAll("T1", [file("a"), file("b")], upload, undefined, () => calls++ < 1);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
