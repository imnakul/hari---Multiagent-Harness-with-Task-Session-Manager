import * as Clipboard from "expo-clipboard";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { makeCommandId } from "@/features/connection/nativeLink";
import { linkStreamLive, sendLinkItem } from "@/features/link/linkStream";
import type { SendAnswer } from "@/features/link/linkProtocol";
import {
  canSaveToDownloads,
  saveToDownloads,
  takeNativeShared,
} from "@/features/liveUpdates/nativeLive";

import {
  bytesToBase64,
  kindForText,
  parseDownloadPiece,
  parseIncomingShare,
  parsePendingShares,
  parseUploadAnswer,
  safeFileName,
  MAX_SHARE_FILE_BYTES,
  MAX_SHARE_TEXT,
  SHARE_CHUNK_BYTES,
  type PhoneShareEntry,
} from "./shareModel";
import { patchShare, recordShare, setShareProgress, shareHistory } from "./shareStore";

// Fork (Hari, L-279): moving Share items between the phone and the computer.
// Text goes in the link outbox (kept until the computer takes it). Files move
// one at a time in 1 MB pieces over the usual connection: `share.upload` to
// the computer, `share.download` from it; a file that stops can be tried again.

type Command = <T>(method: string, params?: object, id?: string) => Promise<T>;

const SHARE_CHANNEL = "share";
/** Where files from the computer are written before Android files them in Downloads. */
const INCOMING = new Directory(Paths.cache, "hari-share-in");
/** The native side's copies of files shared to Hari. */
const SHARED_COPIES = "/hari-share/";

const why = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

let queue: Promise<void> = Promise.resolve();
/** Files move one at a time, in the order asked. */
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((reason: unknown) => console.warn("Share: a transfer failed", reason));
}

let channelReady: Promise<unknown> | null = null;
/** A notification for something from the computer; a tap opens Share. */
async function notify(title: string, body: string) {
  if (Platform.OS === "android") {
    channelReady ??= Notifications.setNotificationChannelAsync(SHARE_CHANNEL, {
      name: "Shared from your computer",
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => (channelReady = null));
    await channelReady;
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { share: true } },
    trigger: Platform.OS === "android" ? { channelId: SHARE_CHANNEL } : null,
  }).catch((reason: unknown) => console.warn("Share: could not post the notification", reason));
}

const preview = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** A `share` item from the computer. Files are fetched after, one at a time. */
export async function receiveShare(payload: unknown, command: Command): Promise<void> {
  const share = parseIncomingShare(payload);
  if (!share) return;
  if (share.type === "file") {
    if (shareHistory().some((entry) => entry.id === share.fileId)) return;
    recordShare({
      id: share.fileId,
      direction: "in",
      kind: "file",
      name: share.name,
      size: share.size,
      mimeType: share.mimeType,
      fileId: share.fileId,
      at: Date.now(),
      status: "queued",
    });
    enqueue(() => download(share.fileId, command));
    return;
  }
  const kind = share.type === "clipboard" ? "clipboard" : kindForText(share.text);
  if (kind === "clipboard") await Clipboard.setStringAsync(share.text);
  recordShare({
    id: makeCommandId(),
    direction: "in",
    kind,
    text: share.text,
    at: Date.now(),
    status: "done",
  });
  await notify(
    kind === "clipboard" ? "Copied from your computer" : kind === "link" ? "Link from your computer" : "Text from your computer",
    preview(share.text),
  );
}

/** Fetches (or fetches again) a file the computer offered. */
export function fetchShareFile(id: string, command: Command) {
  patchShare(id, { status: "queued" });
  enqueue(() => download(id, command));
}

async function download(id: string, command: Command) {
  const entry = shareHistory().find((candidate) => candidate.id === id);
  if (!entry?.fileId || entry.status === "done") return;
  const name = safeFileName(entry.name ?? "file");
  const mimeType = entry.mimeType ?? "application/octet-stream";
  let target: File | null = null;
  try {
    INCOMING.create({ idempotent: true, intermediates: true });
    target = new File(INCOMING, `${id}-${name}`);
    if (target.exists) target.delete();
    target.create();
    const handle = target.open(FileMode.Truncate);
    try {
      let offset = 0;
      let size = entry.size ?? 0;
      setShareProgress(id, 0);
      do {
        const piece = parseDownloadPiece(
          await command<unknown>("share.download", { fileId: entry.fileId, offset }),
        );
        size = piece.size;
        if (size > MAX_SHARE_FILE_BYTES) throw new Error("Files over 100 MB can't be sent");
        if (!piece.data.length && offset < size) throw new Error("The file changed on the computer");
        handle.writeBytes(piece.data);
        offset += piece.data.length;
        setShareProgress(id, size ? offset / size : 1);
      } while (offset < size);
    } finally {
      handle.close();
    }
    const uri =
      Platform.OS === "android" && canSaveToDownloads
        ? await saveToDownloads(target.uri, name, mimeType)
        : target.uri;
    patchShare(id, { status: "done", uri, name });
    await notify("File from your computer", `${name} · in Downloads/Hari`);
  } catch (reason) {
    if (target?.exists) target.delete();
    patchShare(id, { status: "failed", error: why(reason) });
  }
}

/**
 * Sends text, a link or the clipboard to the computer. Recorded as failed
 * (to try again) when there's no link yet.
 */
export function sendShareText(text: string, clipboard: boolean) {
  const body = text.slice(0, MAX_SHARE_TEXT);
  if (!body.trim()) return;
  const kind = clipboard ? "clipboard" : kindForText(body);
  const at = Date.now();
  try {
    const outboxId = sendLinkItem("share", { type: kind, text: body });
    recordShare({ id: outboxId, direction: "out", kind, text: body, outboxId, at, status: "queued" });
  } catch (reason) {
    recordShare({ id: makeCommandId(), direction: "out", kind, text: body, at, status: "failed", error: why(reason) });
  }
}

/**
 * Fork (Hari, L-286): asks the computer to open a link in its default
 * browser, as a Share link that says so. Only while connected: an open that
 * waited in the outbox would surprise the computer's user hours later.
 * Recorded in Share like any link sent.
 * @throws when the computer isn't connected, or the text isn't a web link.
 */
export function openOnComputer(url: string) {
  const link = url.trim();
  if (kindForText(link) !== "link") throw new Error("Only web links open on the computer.");
  if (!linkStreamLive()) throw new Error("Your computer isn’t connected right now.");
  const outboxId = sendLinkItem("share", { type: "link", text: link, open: true });
  recordShare({ id: outboxId, direction: "out", kind: "link", text: link, outboxId, at: Date.now(), status: "queued" });
}

/** The computer took or refused texts the phone sent. */
export function settleSentShares(answer: SendAnswer) {
  const history = shareHistory();
  const sent = (id: string) => history.find((entry) => entry.outboxId === id && entry.status === "queued");
  for (const id of answer.accepted) {
    const entry = sent(id);
    if (entry) patchShare(entry.id, { status: "done" });
  }
  for (const { id, error } of answer.rejected) {
    const entry = sent(id);
    if (entry) patchShare(entry.id, { status: "failed", error });
  }
}

/** Sends a file to the computer's Downloads\Hari. */
export function sendShareFile(
  file: { uri: string; name: string; mimeType: string; size: number },
  command: Command,
) {
  const id = makeCommandId();
  const tooLarge = file.size > MAX_SHARE_FILE_BYTES;
  recordShare({
    id,
    direction: "out",
    kind: "file",
    name: safeFileName(file.name),
    size: file.size,
    mimeType: file.mimeType,
    uri: file.uri,
    at: Date.now(),
    ...(tooLarge
      ? { status: "failed", error: "Files over 100 MB can't be sent" }
      : { status: "queued" }),
  });
  if (!tooLarge) enqueue(() => upload(id, command));
}

/** Tries a failed share again: text goes back in the outbox, a file moves again. */
export function retryShare(entry: PhoneShareEntry, command: Command) {
  if (entry.kind !== "file") {
    if (entry.text === undefined) return;
    const kind = entry.kind === "clipboard" ? "clipboard" : kindForText(entry.text);
    try {
      const outboxId = sendLinkItem("share", { type: kind, text: entry.text });
      patchShare(entry.id, { status: "queued", outboxId });
    } catch (reason) {
      patchShare(entry.id, { status: "failed", error: why(reason) });
    }
    return;
  }
  if (entry.direction === "in") {
    fetchShareFile(entry.id, command);
    return;
  }
  patchShare(entry.id, { status: "queued" });
  enqueue(() => upload(entry.id, command));
}

async function upload(id: string, command: Command) {
  const entry = shareHistory().find((candidate) => candidate.id === id);
  if (!entry?.uri || entry.status === "done") return;
  const source = new File(entry.uri);
  try {
    if (!source.exists) throw new Error("The file is no longer on the phone");
    const size = source.size;
    if (size > MAX_SHARE_FILE_BYTES) throw new Error("Files over 100 MB can't be sent");
    const handle = source.open(FileMode.ReadOnly);
    try {
      let offset = 0;
      setShareProgress(id, 0);
      for (;;) {
        const bytes = handle.readBytes(Math.min(SHARE_CHUNK_BYTES, size - offset));
        if (!bytes.length && offset < size) throw new Error("The file changed while sending");
        const answer = parseUploadAnswer(
          await command<unknown>("share.upload", {
            fileId: id,
            name: entry.name ?? "file",
            mimeType: entry.mimeType ?? "application/octet-stream",
            size,
            offset,
            data: bytesToBase64(bytes),
          }),
        );
        if (answer.done) break;
        if (answer.received !== offset + bytes.length) throw new Error("Upload out of step; try again");
        offset = answer.received;
        setShareProgress(id, size ? offset / size : 1);
      }
    } finally {
      handle.close();
    }
    patchShare(id, { status: "done", size });
    // The share sheet's copy isn't needed any more; picked files are the user's own.
    if (entry.uri.includes(SHARED_COPIES)) {
      try {
        source.parentDirectory.delete();
      } catch {
        // Android clears the cache by itself.
      }
    }
  } catch (reason) {
    const message = why(reason);
    patchShare(id, {
      status: "failed",
      error: message.includes("Unsupported mobile operation") ? "Update MonoCode on your computer" : message,
    });
  }
}

/** Sends what the share sheet and the Quick Settings tile left for Hari. */
export function sendPendingShares(command: Command) {
  const raw = takeNativeShared();
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  for (const item of parsePendingShares(parsed)) {
    if (item.type === "file") sendShareFile(item, command);
    else sendShareText(item.text, item.type === "clipboard");
  }
}
