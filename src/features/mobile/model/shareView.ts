import { isImagePath, videoMimeForPath } from "../../files/model/filePreview";
import type { ShareEntry } from "./mobileShare";

/**
 * Fork (Hari, L-287): the Share view's helpers. The title-bar phone button
 * asks App to open the view, and both read the same "seen up to" mark for
 * the unseen dot.
 */

const viewListeners = new Set<() => void>();

export function requestShareView(): void {
  for (const listener of viewListeners) listener();
}

export function subscribeShareView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** Newest arrival the user has seen in Share, for the title-bar dot. */
const SEEN_KEY = "monocode.share.seenAt";
const seenListeners = new Set<() => void>();

export function readShareSeen(): number {
  const value = Number(localStorage.getItem(SEEN_KEY) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Moves the mark forward only; an older time is ignored. */
export function markShareSeen(at: number): void {
  if (at <= readShareSeen()) return;
  localStorage.setItem(SEEN_KEY, String(at));
  for (const listener of seenListeners) listener();
}

export function subscribeShareSeen(listener: () => void): () => void {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
}

export type ShareFilter = "all" | "media" | "files" | "links" | "text";

export const SHARE_FILTERS: readonly { id: ShareFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
  { id: "links", label: "Links" },
  { id: "text", label: "Text" },
];

/** A picture or video the view can show inline (by its saved path, else its name). */
export function isShareMedia(entry: ShareEntry): boolean {
  if (entry.kind !== "file") return false;
  const name = entry.path ?? entry.name ?? "";
  return isImagePath(name) || videoMimeForPath(name) !== null;
}

export function matchesShareFilter(entry: ShareEntry, filter: ShareFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "media":
      return isShareMedia(entry);
    case "files":
      return entry.kind === "file" && !isShareMedia(entry);
    case "links":
      return entry.kind === "link";
    case "text":
      return entry.kind === "text" || entry.kind === "clipboard";
  }
}

export type ShareDay = { key: string; label: string; items: ShareEntry[] };

const dayKey = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/**
 * The history (newest first, as the computer keeps it) as days for a chat
 * timeline: oldest day first, oldest item first within a day.
 */
export function shareDays(items: readonly ShareEntry[], now = Date.now()): ShareDay[] {
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  const days: ShareDay[] = [];
  for (const entry of [...items].sort((a, b) => a.at - b.at)) {
    const key = dayKey(entry.at);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.items.push(entry);
      continue;
    }
    const label =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : new Date(entry.at).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: new Date(entry.at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
            });
    days.push({ key, label, items: [entry] });
  }
  return days;
}

/** "14:05" — the time under a bubble. */
export function shareTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
