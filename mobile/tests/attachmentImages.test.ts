import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAttachmentImages,
  loadAttachmentImage,
} from "@/features/sessions/attachmentImages";

beforeEach(() => clearAttachmentImages());

function desktop(reply: () => Promise<unknown>) {
  const command = vi.fn((_method: string, _params?: object) => reply());
  // The desktop's reply is untyped JSON; the real `command` asserts T the same way.
  const typed = <T,>(method: string, params?: object) => command(method, params) as Promise<T>;
  return Object.assign(typed, { spy: command });
}

describe("loadAttachmentImage (Hari, L-268)", () => {
  it("asks the desktop for one message's image by ID and size", async () => {
    const command = desktop(async () => ({ mimeType: "image/jpeg", data: "QUJD", width: 2, height: 1 }));
    await expect(loadAttachmentImage(command, "s1", "u1", "a1", "thumb")).resolves.toBe(
      "data:image/jpeg;base64,QUJD",
    );
    expect(command.spy).toHaveBeenCalledWith("conversation.attachment", {
      conversationId: "s1",
      messageId: "u1",
      attachmentId: "a1",
      size: "thumb",
    });
  });

  it("fetches each size once while it is cached", async () => {
    const command = desktop(async () => ({ mimeType: "image/png", data: "eA==", width: 1, height: 1 }));
    await loadAttachmentImage(command, "s1", "u1", "a1", "thumb");
    await loadAttachmentImage(command, "s1", "u1", "a1", "thumb");
    await loadAttachmentImage(command, "s1", "u1", "a1", "full");
    expect(command.spy).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failed fetch", async () => {
    const command = desktop(() => Promise.reject(new Error("Desktop window did not answer")));
    await expect(loadAttachmentImage(command, "s1", "u1", "a1", "thumb")).rejects.toThrow(
      "did not answer",
    );
    await expect(loadAttachmentImage(command, "s1", "u1", "a1", "thumb")).rejects.toThrow();
    expect(command.spy).toHaveBeenCalledTimes(2);
  });
});
