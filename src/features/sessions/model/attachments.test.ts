import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentPathText,
  attachmentsFromFiles,
  filesFromClipboard,
  loadAttachmentPreviewUrl,
  loadProjectImagePreviewUrl,
  mergeAttachments,
  persistableAttachment,
  promptBlocks,
  sniffImageMime,
} from "./attachments";
import type { Attachment } from "./session";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

function file(name: string, type: string, body = "x") {
  return new File([body], name, { type });
}

function item(next: File): {
  kind: string;
  type: string;
  getAsFile: () => File | null;
} {
  return {
    kind: "file",
    type: next.type,
    getAsFile: () => next,
  };
}

function attachment(
  partial: Partial<Attachment> & Pick<Attachment, "id" | "name">,
): Attachment {
  return {
    mimeType: "image/png",
    kind: "image",
    size: 4,
    ...partial,
  };
}

describe("text notes", () => {
  const note = attachment({
    id: "n1",
    name: "Console: TypeError",
    mimeType: "text/plain",
    kind: "file",
    text: ["Browser console error:", "TypeError: x"].join("\n"),
  });

  it("keeps the note text when saved and sends it as text, not a path", () => {
    expect(persistableAttachment(note).text).toBe(note.text);
    expect(attachmentPathText(note)).toBe(note.text);
    expect(promptBlocks("fix it", [note]).at(-1)).toEqual({
      type: "text",
      text: note.text,
    });
  });
});

describe("mergeAttachments", () => {
  it("keeps previously attached images when adding more", () => {
    const first = attachment({ id: "a", name: "one.png" });
    const second = attachment({ id: "b", name: "two.png" });
    expect(mergeAttachments([first], [second]).map((file) => file.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips the same path twice", () => {
    const first = attachment({
      id: "a",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    const again = attachment({
      id: "b",
      name: "shot.png",
      path: "/tmp/shot.png",
    });
    expect(mergeAttachments([first], [again])).toEqual([first]);
  });
});

describe("filesFromClipboard", () => {
  it("returns every file item when the files list is truncated", () => {
    const a = file("a.png", "image/png", "a");
    const b = file("b.png", "image/png", "b");
    expect(
      filesFromClipboard({
        files: [a],
        items: [item(a), item(b)],
      }),
    ).toEqual([a, b]);
  });

  it("drops the unnamed tiff twin of a png screenshot", () => {
    const png = file("image.png", "image/png");
    const tiff = file("image.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png]);
  });

  it("keeps a real named tiff next to a png", () => {
    const png = file("diagram.png", "image/png");
    const tiff = file("scan.tiff", "image/tiff");
    expect(
      filesFromClipboard({
        files: [png, tiff],
        items: [item(png), item(tiff)],
      }),
    ).toEqual([png, tiff]);
  });
});

describe("sniffImageMime", () => {
  it("identifies common image formats by magic bytes", () => {
    expect(
      sniffImageMime(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(
      sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    ).toBe("image/gif");
    expect(sniffImageMime(new Uint8Array([0x42, 0x4d, 0x36]))).toBe(
      "image/bmp",
    );
    expect(
      sniffImageMime(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
      ),
    ).toBe("image/webp");
  });

  it("rejects text, truncated headers, and empty input", () => {
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(
      sniffImageMime(new TextEncoder().encode("<html><h1>not an image")),
    ).toBeNull();
  });
});

describe("project Markdown image previews", () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  beforeEach(() => {
    mockInvoke.mockReset();
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (() => `blob:project-${Math.random()}`) as typeof URL.createObjectURL,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("validates containment before cache lookup and never uses the attachment cache", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "read_binary_file") return Promise.resolve(png.buffer);
      if (command === "canonicalize_project_image_path")
        return Promise.reject(new Error("outside project"));
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });
    expect(await loadAttachmentPreviewUrl("/outside/shared.png")).toMatch(
      /^blob:/,
    );
    expect(await loadProjectImagePreviewUrl("/outside/shared.png", "/repo")).toBe(
      null,
    );
    expect(mockInvoke).toHaveBeenCalledWith("canonicalize_project_image_path", {
      path: "/outside/shared.png",
      cwd: "/repo",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "read_project_image_file",
      expect.anything(),
    );
  });

  it("scopes cached bytes by canonical project and revalidates on cache hits", async () => {
    const canonicalCalls: string[] = [];
    const reads: string[] = [];
    mockInvoke.mockImplementation((command: string, args: { cwd?: string }) => {
      if (command === "canonicalize_project_image_path") {
        canonicalCalls.push(args.cwd ?? "");
        return Promise.resolve({
          root: args.cwd === "/repo" ? "/repo" : "/repo/sub",
          path: "/repo/sub/image.png",
        });
      }
      if (command === "read_project_image_file") {
        reads.push(args.cwd ?? "");
        return Promise.resolve(png.buffer);
      }
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });

    const outer = await loadProjectImagePreviewUrl("/repo/sub/image.png", "/repo");
    const outerAgain = await loadProjectImagePreviewUrl(
      "/repo/sub/image.png",
      "/repo",
    );
    const nested = await loadProjectImagePreviewUrl(
      "/repo/sub/image.png",
      "/repo/sub",
    );

    expect(outer).toMatch(/^blob:/);
    expect(outerAgain).toBe(outer);
    expect(nested).toMatch(/^blob:/);
    expect(nested).not.toBe(outer);
    expect(canonicalCalls).toEqual(["/repo", "/repo", "/repo/sub"]);
    expect(reads).toEqual(["/repo", "/repo/sub"]);
  });
});

class FakeReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File): void {
    void file.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString("base64");
      this.result = `data:${file.type || "application/octet-stream"};base64,${base64}`;
      this.onload?.();
    });
  }
}

describe("attachmentsFromFiles", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.stubGlobal("FileReader", FakeReader);
    return () => {
      vi.unstubAllGlobals();
    };
  });

  it("persists pasted images to disk so previews survive reload", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "write_attachment") {
        return Promise.resolve("/tmp/monocode-attachments/1-image.png");
      }
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "image.png",
      { type: "image/png" },
    );
    const [attached] = await attachmentsFromFiles([png]);
    expect(attached?.kind).toBe("image");
    expect(attached?.data).toBeTruthy();
    expect(attached?.path).toBe("/tmp/monocode-attachments/1-image.png");
    expect(mockInvoke).toHaveBeenCalledWith(
      "write_attachment",
      expect.objectContaining({ name: "image.png" }),
    );
  });

  it("keeps inline data when persisting the copy fails", async () => {
    mockInvoke.mockRejectedValue(new Error("temp unwritable"));
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "image.png",
      { type: "image/png" },
    );
    const [attached] = await attachmentsFromFiles([png]);
    expect(attached?.data).toBeTruthy();
    expect(attached?.path).toBeUndefined();
  });
});
