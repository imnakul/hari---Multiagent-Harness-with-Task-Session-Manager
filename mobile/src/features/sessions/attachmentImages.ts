import type { AttachmentImage } from "@/features/workspace/types";

export type AttachmentImageSize = "thumb" | "full";
type Command = <T>(method: string, params?: object) => Promise<T>;

/** Enough for a few screens of thumbnails plus the image open full screen. */
const CACHE_LIMIT = 48;
const cache = new Map<string, Promise<string>>();

/**
 * Fork (Hari, L-268): a sent image as a data URI, fetched from the desktop
 * once per size and kept while it is recent, so scrolling a long chat back
 * over a message does not ask the desktop again. A failed fetch is dropped
 * from the cache so opening the message later can retry.
 */
export function loadAttachmentImage(
  command: Command,
  conversationId: string,
  messageId: string,
  attachmentId: string,
  size: AttachmentImageSize,
): Promise<string> {
  const key = `${conversationId}\n${messageId}\n${attachmentId}\n${size}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so the most recently shown images are the last evicted.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const request = command<AttachmentImage>("conversation.attachment", {
    conversationId,
    messageId,
    attachmentId,
    size,
  }).then((image) => `data:${image.mimeType};base64,${image.data}`);
  cache.set(key, request);
  request.catch(() => {
    if (cache.get(key) === request) cache.delete(key);
  });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return request;
}

/** For tests: forget every cached image. */
export function clearAttachmentImages(): void {
  cache.clear();
}
