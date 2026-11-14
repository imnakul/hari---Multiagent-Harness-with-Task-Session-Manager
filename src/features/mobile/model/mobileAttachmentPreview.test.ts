import { describe, expect, it, vi } from "vitest";
import type { Attachment, Session } from "../../sessions/model/session";

vi.mock("../../../platform/tauri/fs", () => ({
  readBinaryFile: vi.fn(),
}));

import { readBinaryFile } from "../../../platform/tauri/fs";
import {
  ATTACHMENT_PREVIEW_EDGE,
  mobileAttachmentImage,
  mobileAttachmentRefs,
} from "./mobileAttachmentPreview";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const pngBase64 = btoa(String.fromCharCode(...PNG));

function image(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "a1",
    name: "screen.png",
    mimeType: "image/png",
    kind: "image",
    size: PNG.length,
    data: pngBase64,
    ...overrides,
  };
}

function session(attachments: Attachment[]): Session {
  // The lookup reads only `blocks`; the rest of a session is irrelevant here.
  return {
    blocks: [
      { id: "u1", role: "user", text: "See this", attachments },
      { id: "r1", role: "assistant", text: "Got it" },
    ],
  } as unknown as Session;
}

const shrink = vi.fn(
  async (bytes: Uint8Array, mimeType: string, maxEdge: number) => ({
    mimeType,
    data: `${bytes.length}@${maxEdge}`,
    width: 1,
    height: 1,
  }),
);

describe("mobileAttachmentImage (Hari, L-268)", () => {
  it("sends only the fields the phone needs to list a message's files", () => {
    expect(
      mobileAttachmentRefs([image({ path: "C:/secret/screen.png" })]),
    ).toEqual([
      { id: "a1", name: "screen.png", mimeType: "image/png", kind: "image" },
    ]);
  });

  it("scales a sent image from its inline data to the asked size", async () => {
    const result = await mobileAttachmentImage(
      session([image()]),
      "u1",
      "a1",
      "full",
      shrink,
    );
    expect(result.data).toBe(`${PNG.length}@${ATTACHMENT_PREVIEW_EDGE.full}`);
    expect(shrink).toHaveBeenLastCalledWith(
      expect.any(Uint8Array),
      "image/png",
      ATTACHMENT_PREVIEW_EDGE.full,
    );
  });

  it("reads a reloaded image from the path the desktop saved", async () => {
    vi.mocked(readBinaryFile).mockResolvedValueOnce(Uint8Array.from(PNG));
    await mobileAttachmentImage(
      session([image({ data: undefined, path: "C:/saved/screen.png" })]),
      "u1",
      "a1",
      "thumb",
      shrink,
    );
    expect(readBinaryFile).toHaveBeenCalledWith("C:/saved/screen.png");
  });

  it("refuses anything that is not a sent image", async () => {
    const chat = session([
      image(),
      image({ id: "doc", kind: "file", mimeType: "application/pdf" }),
      image({ id: "fake", data: btoa("<svg></svg>") }),
    ]);
    await expect(
      mobileAttachmentImage(chat, "r1", "a1", "thumb", shrink),
    ).rejects.toThrow("no longer available");
    await expect(
      mobileAttachmentImage(chat, "u1", "missing", "thumb", shrink),
    ).rejects.toThrow("no longer available");
    await expect(
      mobileAttachmentImage(chat, "u1", "doc", "thumb", shrink),
    ).rejects.toThrow("Only images");
    await expect(
      mobileAttachmentImage(chat, "u1", "fake", "thumb", shrink),
    ).rejects.toThrow("not an image");
  });

  it("says when a saved image's file is gone", async () => {
    vi.mocked(readBinaryFile).mockRejectedValueOnce(new Error("ENOENT"));
    await expect(
      mobileAttachmentImage(
        session([image({ data: undefined, path: "C:/gone.png" })]),
        "u1",
        "a1",
        "thumb",
        shrink,
      ),
    ).rejects.toThrow("moved or deleted");
  });
});
