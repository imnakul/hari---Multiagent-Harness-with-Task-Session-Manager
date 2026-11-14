import { readBinaryFile } from "../../../platform/tauri/fs";
import { sniffImageMime } from "../../sessions/model/attachments";
import type { Attachment, Session } from "../../sessions/model/session";

/**
 * Fork (Hari, L-268): a sent image as the phone shows it — a small tile in the
 * message bubble, or the full-screen view. Longest edge in pixels.
 */
export const ATTACHMENT_PREVIEW_EDGE = { thumb: 320, full: 1600 } as const;
export type AttachmentPreviewSize = keyof typeof ATTACHMENT_PREVIEW_EDGE;

/** What a message's files look like on the phone, before any bytes travel. */
export type MobileAttachmentRef = {
  id: string;
  name: string;
  mimeType: string;
  kind: Attachment["kind"];
};

export type MobileAttachmentImage = {
  mimeType: string;
  /** Base64, no data-URL prefix. */
  data: string;
  width: number;
  height: number;
};

/** Images at or under this many bytes and the edge travel as they are. */
const PASS_THROUGH_BYTES = 400 * 1024;

export function mobileAttachmentRefs(
  attachments: readonly Attachment[],
): MobileAttachmentRef[] {
  return attachments.map(({ id, name, mimeType, kind }) => ({
    id,
    name,
    mimeType,
    kind,
  }));
}

export function isAttachmentPreviewSize(
  value: unknown,
): value is AttachmentPreviewSize {
  return value === "thumb" || value === "full";
}

/**
 * The image a user sent in one of this session's messages, scaled down for
 * the phone. The phone names the message and the attachment by ID only; the
 * bytes come from the session's own record (inline data, or the path the
 * desktop saved), so a phone can never ask for an arbitrary file.
 *
 * @throws when the message or attachment is gone, it is not an image, or its
 *   file can no longer be read.
 */
export async function mobileAttachmentImage(
  session: Session,
  messageId: string,
  attachmentId: string,
  size: AttachmentPreviewSize,
  shrink: typeof shrinkImage = shrinkImage,
): Promise<MobileAttachmentImage> {
  const message = session.blocks.find(
    (block) => block.id === messageId && block.role === "user",
  );
  const attachment = message?.attachments?.find(
    (item) => item.id === attachmentId,
  );
  if (!attachment) throw new Error("This attachment is no longer available");
  if (attachment.kind !== "image")
    throw new Error("Only images can be previewed on the phone");
  const bytes = await attachmentBytes(attachment);
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) throw new Error("This attachment is not an image");
  return shrink(bytes, mimeType, ATTACHMENT_PREVIEW_EDGE[size]);
}

async function attachmentBytes(attachment: Attachment): Promise<Uint8Array> {
  if (attachment.data) {
    try {
      return Uint8Array.from(atob(attachment.data), (char) =>
        char.charCodeAt(0),
      );
    } catch {
      throw new Error("This attachment could not be read");
    }
  }
  if (!attachment.path) throw new Error("This attachment was not saved");
  try {
    return await readBinaryFile(attachment.path);
  } catch {
    throw new Error("This attachment's file was moved or deleted");
  }
}

/**
 * Scales an image so its longest edge is at most `maxEdge`, as JPEG. A small
 * image within the edge is returned unchanged, keeping PNG transparency and
 * GIF frames. Uses the WebView's decoder, so only formats it reads work.
 */
export async function shrinkImage(
  bytes: Uint8Array,
  mimeType: string,
  maxEdge: number,
): Promise<MobileAttachmentImage> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
  );
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    if (scale === 1 && bytes.byteLength <= PASS_THROUGH_BYTES) {
      return { mimeType, data: toBase64(bytes), width, height };
    }
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(outWidth, outHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Desktop could not resize this image");
    // JPEG has no transparency: paint it over white, as a chat bubble would.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, outWidth, outHeight);
    context.drawImage(bitmap, 0, 0, outWidth, outHeight);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.82,
    });
    return {
      mimeType: "image/jpeg",
      data: toBase64(new Uint8Array(await blob.arrayBuffer())),
      width: outWidth,
      height: outHeight,
    };
  } finally {
    bitmap.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
