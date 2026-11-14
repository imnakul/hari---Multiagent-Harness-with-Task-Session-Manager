import * as Clipboard from "expo-clipboard";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { AppState, Linking, Platform } from "react-native";

import { makeCommandId } from "@/features/connection/nativeLink";
import { linkStreamLive, sendLinkItem } from "@/features/link/linkStream";
import type { SendAnswer } from "@/features/link/linkProtocol";
import {
  canSaveToDownloads,
  deleteSavedFiles,
  keepScreenAwake,
  phoneFiles,
  saveToDownloads,
  takeNativeShared,
} from "@/features/liveUpdates/nativeLive";

import {
  autoDownloads,
  bytesToBase64,
  formatShareSize,
  kindForText,
  metaChange,
  parseDownloadPiece,
  parseIncomingShare,
  parsePendingShares,
  parseShareMeta,
  parseUploadAnswer,
  receivedFiles,
  safeFileName,
  splitForClear,
  AUTO_DOWNLOAD_BYTES,
  MAX_SHARE_FILE_BYTES,
  MAX_SHARE_TEXT,
  SHARE_CHUNK_BYTES,
  type PhoneShareEntry,
} from "./shareModel";
import {
  markShares,
  patchShare,
  recordShare,
  replaceShares,
  setShareProgress,
  shareHistory,
  shareHistoryBytes,
} from "./shareStore";

// Fork (Hari, L-279, L-290): moving Share items between the phone and the
// computer. Text goes in the link outbox (kept until the computer takes it).
// Files move one at a time in 1 MB pieces over the usual connection:
// `share.upload` to the computer, `share.download` from it. A file that stops
// resumes where it left off; big files from the computer wait for Download.
// Pins, saves and Delete all travel as `meta` items so both sides agree.

type Command = <T>(method: string, params?: object, id?: string) => Promise<T>;
export type ShareFile = { uri: string; name: string; mimeType: string; size: number };

const SHARE_CHANNEL = "share";
/** Where files from the computer are written before Android files them in Downloads. */
const INCOMING = new Directory(Paths.cache, "hari-share-in");
/** The native side's copies of files shared to Hari. */
const SHARED_COPIES = "/hari-share/";
/** Room left free on the phone after a download. */
const SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const TOO_LARGE = "Files over 1 GB can't be sent";

const why = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

let queue: Promise<void> = Promise.resolve();
/** Files move one at a time, in the order asked. */
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((reason: unknown) => console.warn("Share: a transfer failed", reason));
}

/** Big transfers keep the screen on (the app shows "Keep Hari open"). */
async function awake<T>(size: number, task: () => Promise<T>): Promise<T> {
  const big = size > AUTO_DOWNLOAD_BYTES;
  if (big) keepScreenAwake(true);
  try {
    return await task();
  } finally {
    if (big) keepScreenAwake(false);
  }
}

let channelReady: Promise<unknown> | null = null;
/** A notification for something from the computer; a tap opens Share. */
async function notify(title: string, body: string, openUrl?: string) {
  if (Platform.OS === "android") {
    channelReady ??= Notifications.setNotificationChannelAsync(SHARE_CHANNEL, {
      name: "Shared from your computer",
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => (channelReady = null));
    await channelReady;
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: openUrl ? { share: true, openUrl } : { share: true } },
    trigger: Platform.OS === "android" ? { channelId: SHARE_CHANNEL } : null,
  }).catch((reason: unknown) => console.warn("Share: could not post the notification", reason));
}

const preview = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

const NO_FILES_ACCESS =
  "Hari can't see the phone's files yet. On the phone, open Hari → Settings → Computer and turn on All files access.";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", pdf: "application/pdf",
  txt: "text/plain", zip: "application/zip", apk: "application/vnd.android.package-archive",
};
const mimeFor = (name: string) => MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * Fork (Hari, L-297): the computer browsing this phone's files. `files.list`
 * answers with one folder; `files.send` sends the picked files to the
 * computer as one Share group. True when the item was one of these.
 */
async function answerFilesRequest(payload: unknown, command: Command): Promise<boolean> {
  if (typeof payload !== "object" || payload === null) return false;
  const item = payload as Record<string, unknown>;
  if (item.type === "files.list") {
    const requestId = typeof item.requestId === "string" ? item.requestId : "";
    if (!requestId) return true;
    const answer = (body: object) =>
      command("share.filesResult", { requestId, ...body }).catch((reason: unknown) =>
        console.warn("Share: could not answer the file list", reason),
      );
    if (!phoneFiles || !phoneFiles.allowed()) {
      await answer({ error: NO_FILES_ACCESS });
      return true;
    }
    try {
      const path = typeof item.path === "string" ? item.path : "";
      const offset = typeof item.offset === "number" ? item.offset : 0;
      const result = JSON.parse(phoneFiles.list(path, offset)) as Record<string, unknown>;
      if (typeof result.error === "string") await answer({ error: result.error });
      else await answer({ result });
    } catch (reason) {
      await answer({ error: why(reason) });
    }
    return true;
  }
  if (item.type === "files.send") {
    if (!phoneFiles || !phoneFiles.allowed() || !Array.isArray(item.paths)) return true;
    const files: ShareFile[] = [];
    for (const path of item.paths.slice(0, 50)) {
      if (typeof path !== "string") continue;
      try {
        const info = JSON.parse(phoneFiles.describe(path)) as { uri?: string; name?: string; size?: number };
        if (!info.uri || !info.name) continue;
        files.push({ uri: info.uri, name: info.name, size: info.size ?? 0, mimeType: mimeFor(info.name) });
      } catch (reason) {
        console.warn("Share: could not read a phone file", reason);
      }
    }
    if (files.length) sendShareGroup(files, "", command);
    return true;
  }
  return false;
}

/** A `share` item from the computer. Small files are fetched after, one at a time. */
export async function receiveShare(payload: unknown, command: Command): Promise<void> {
  if (await answerFilesRequest(payload, command)) return;
  const meta = parseShareMeta(payload);
  if (meta) {
    if (meta.action === "clear") clearLocal();
    else markShares(meta.ids, metaChange(meta.action));
    return;
  }
  const share = parseIncomingShare(payload);
  if (!share) return;
  if (share.type === "file") {
    if (shareHistory().some((entry) => entry.id === share.fileId)) return;
    const auto = autoDownloads(share.size);
    recordShare({
      id: share.fileId,
      direction: "in",
      kind: "file",
      name: share.name,
      size: share.size,
      mimeType: share.mimeType,
      fileId: share.fileId,
      at: Date.now(),
      status: auto ? "queued" : "offered",
      ...(share.groupId ? { groupId: share.groupId } : {}),
    });
    if (auto) enqueue(() => download(share.fileId, command));
    else await notify("File from your computer", `${share.name} · ${formatShareSize(share.size)} · tap Download in Share`);
    return;
  }
  const id = share.entryId ?? makeCommandId();
  if (shareHistory().some((entry) => entry.id === id)) return;
  const kind = share.type === "clipboard" ? "clipboard" : kindForText(share.text);
  if (kind === "clipboard") await Clipboard.setStringAsync(share.text);
  recordShare({
    id,
    direction: "in",
    kind,
    text: share.text,
    at: Date.now(),
    status: "done",
    ...(share.groupId ? { groupId: share.groupId } : {}),
  });
  if (share.open) {
    // Opening a page from the background isn't allowed: the notification opens it when tapped.
    if (AppState.currentState === "active") {
      const opened = await Linking.openURL(share.text).then(
        () => true,
        (reason: unknown) => {
          console.warn("Share: could not open the link", reason);
          return false;
        },
      );
      if (opened) return;
    }
    await notify("Open this link", preview(share.text), share.text);
    return;
  }
  // A caption under files: the files' own notice says enough.
  if (share.groupId) return;
  await notify(
    kind === "clipboard" ? "Copied from your computer" : kind === "link" ? "Link from your computer" : "Text from your computer",
    preview(share.text),
  );
}

/** Fetches (or fetches again, or resumes) a file the computer offered. */
export function fetchShareFile(id: string, command: Command) {
  patchShare(id, { status: "queued" });
  enqueue(() => download(id, command));
}

const partFile = (id: string, name: string) => new File(INCOMING, `${id}-${name}`);

async function download(id: string, command: Command) {
  const entry = shareHistory().find((candidate) => candidate.id === id);
  if (!entry?.fileId || entry.status === "done" || entry.status === "offered") return;
  const name = safeFileName(entry.name ?? "file");
  const mimeType = entry.mimeType ?? "application/octet-stream";
  const target = partFile(id, name);
  try {
    INCOMING.create({ idempotent: true, intermediates: true });
    // A partial file from a stopped download: carry on from its end.
    let offset = target.exists ? (target.size ?? 0) : 0;
    let size = entry.size ?? 0;
    if (offset > size) {
      target.delete();
      offset = 0;
    }
    if (!target.exists) target.create();
    const needed = size - offset + (canSaveToDownloads ? size : 0) + SPACE_MARGIN_BYTES;
    const free = Paths.availableDiskSpace;
    if (Number.isFinite(free) && free > 0 && free < needed)
      throw new Error(`Not enough space on the phone: ${formatShareSize(free)} free, needs ${formatShareSize(needed)}`);
    await awake(size, async () => {
      const handle = target.open(FileMode.Append);
      try {
        setShareProgress(id, size ? offset / size : 0);
        do {
          const piece = parseDownloadPiece(
            await command<unknown>("share.download", { fileId: entry.fileId, offset }),
          );
          if (piece.size !== size && offset > 0) throw new Error("The file changed on the computer; try again");
          size = piece.size;
          if (size > MAX_SHARE_FILE_BYTES) throw new Error(TOO_LARGE);
          if (!piece.data.length && offset < size) throw new Error("The file changed on the computer; try again");
          handle.writeBytes(piece.data);
          offset += piece.data.length;
          setShareProgress(id, size ? offset / size : 1);
        } while (offset < size);
      } finally {
        handle.close();
      }
    });
    const uri =
      Platform.OS === "android" && canSaveToDownloads
        ? await saveToDownloads(target.uri, name, mimeType)
        : target.uri;
    patchShare(id, { status: "done", uri, name });
    if ((entry.size ?? 0) > AUTO_DOWNLOAD_BYTES || !entry.groupId)
      await notify("File from your computer", `${name} · in Downloads/Hari`);
  } catch (reason) {
    const message = why(reason);
    // A changed file can't resume; anything else keeps its part for Try again.
    if (message.includes("changed") && target.exists) target.delete();
    patchShare(id, { status: "failed", error: message });
  }
}

/** Puts text in the outbox; its id is the message's id on both sides. */
function queueText(entryId: string, kind: "text" | "link" | "clipboard", text: string, extra: object = {}) {
  return sendLinkItem("share", { type: kind, text, entryId, ...extra });
}

/**
 * Sends text, a link or the clipboard to the computer. Recorded as failed
 * (to try again) when there's no link yet.
 */
export function sendShareText(text: string, clipboard: boolean, groupId?: string) {
  const body = text.slice(0, MAX_SHARE_TEXT);
  if (!body.trim()) return;
  const kind = clipboard ? "clipboard" : kindForText(body);
  const at = Date.now();
  const id = makeCommandId();
  const group = groupId ? { groupId } : {};
  try {
    const outboxId = queueText(id, kind, body, group);
    recordShare({ id, direction: "out", kind, text: body, outboxId, at, status: "queued", ...group });
  } catch (reason) {
    recordShare({ id, direction: "out", kind, text: body, at, status: "failed", error: why(reason), ...group });
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
  const id = makeCommandId();
  const outboxId = queueText(id, "link", link, { open: true });
  recordShare({ id, direction: "out", kind: "link", text: link, outboxId, at: Date.now(), status: "queued" });
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
export function sendShareFile(file: ShareFile, command: Command, groupId?: string) {
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
    ...(groupId ? { groupId } : {}),
    ...(tooLarge ? { status: "failed", error: TOO_LARGE } : { status: "queued" }),
  });
  if (!tooLarge) enqueue(() => upload(id, command));
}

/**
 * Fork (L-290): files picked together (and the typed text as their caption)
 * go as one group: one message on both sides. One file and no text is a
 * plain file.
 */
export function sendShareGroup(files: ShareFile[], caption: string, command: Command) {
  const text = caption.trim();
  const groupId = files.length > 1 || (files.length > 0 && text) ? makeCommandId() : undefined;
  for (const file of files) sendShareFile(file, command, groupId);
  if (text) sendShareText(caption, false, groupId);
}

/** Tries a failed share again: text goes back in the outbox, a file moves again (resuming). */
export function retryShare(entry: PhoneShareEntry, command: Command) {
  if (entry.kind !== "file") {
    if (entry.text === undefined) return;
    const kind = entry.kind === "clipboard" ? "clipboard" : kindForText(entry.text);
    try {
      const outboxId = queueText(entry.id, kind, entry.text, entry.groupId ? { groupId: entry.groupId } : {});
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

/** How much of this file the computer already has (0 from a MonoCode before resume). */
async function uploaded(id: string, size: number, command: Command): Promise<{ received: number; done: boolean }> {
  try {
    const answer = parseUploadAnswer(await command<unknown>("share.uploadStatus", { fileId: id, size }));
    return answer.received <= size ? answer : { received: 0, done: false };
  } catch {
    return { received: 0, done: false };
  }
}

async function upload(id: string, command: Command) {
  const entry = shareHistory().find((candidate) => candidate.id === id);
  if (!entry?.uri || entry.status === "done") return;
  const source = new File(entry.uri);
  try {
    if (!source.exists) throw new Error("The file is no longer on the phone");
    const size = source.size ?? 0;
    if (size > MAX_SHARE_FILE_BYTES) throw new Error(TOO_LARGE);
    const start = await uploaded(id, size, command);
    if (!start.done) {
      await awake(size, async () => {
        const handle = source.open(FileMode.ReadOnly);
        try {
          let offset = start.received;
          if (offset > 0) handle.offset = offset;
          setShareProgress(id, size ? offset / size : 0);
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
                ...(entry.groupId ? { groupId: entry.groupId } : {}),
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
      });
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

/** Fork (L-290): tells the computer about a pin, save or Delete all (waits in the outbox when offline). */
function sendMeta(payload: object) {
  try {
    sendLinkItem("share", { type: "meta", ...payload });
  } catch (reason) {
    console.warn("Share: could not tell the computer", reason);
  }
}

/** Fork (L-290): pins or unpins messages here and on the computer. */
export function pinShares(ids: string[], pinned: boolean) {
  markShares(ids, { pinned });
  sendMeta({ action: pinned ? "pin" : "unpin", ids });
}

/** Fork (L-290): saves or unsaves messages here and on the computer. */
export function saveShares(ids: string[], saved: boolean) {
  markShares(ids, { saved });
  sendMeta({ action: saved ? "save" : "unsave", ids });
}

/** Deletes everything but pinned and saved messages on this phone, with the files it received. */
function clearLocal(): number {
  const { keep, gone } = splitForClear(shareHistory());
  const files = receivedFiles(gone);
  deleteSavedFiles(files.flatMap((entry) => (entry.uri ? [entry.uri] : [])));
  try {
    if (INCOMING.exists) INCOMING.delete();
  } catch {
    // Android clears the cache by itself.
  }
  replaceShares(keep);
  return files.reduce((total, entry) => total + (entry.size ?? 0), 0);
}

/** Fork (L-290): Delete all on both devices (pinned and saved stay); bytes freed here. */
export function clearAllShares(): number {
  const freed = clearLocal();
  sendMeta({ action: "clear" });
  return freed;
}

/** Fork (L-290): what Share takes on this phone: its history and the files it received. */
export function shareStorage(): { historyBytes: number; filesBytes: number; files: number } {
  const files = receivedFiles(shareHistory());
  return {
    historyBytes: shareHistoryBytes(),
    filesBytes: files.reduce((total, entry) => total + (entry.size ?? 0), 0),
    files: files.length,
  };
}
