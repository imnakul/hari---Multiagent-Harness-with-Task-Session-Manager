import { isImagePath, videoMimeForPath } from "../../files/model/filePreview";
import type { ShareEntry } from "./mobileShare";

/**
 * Fork (Hari, L-287, L-290): Share's helpers. The title-bar phone button
 * opens and closes the Share side panel, and both read the same "seen up to"
 * mark for the unseen dot.
 */

let panelOpen = false;
const panelListeners = new Set<() => void>();

export function readSharePanelOpen(): boolean {
  return panelOpen;
}

export function setSharePanelOpen(open: boolean): void {
  if (open === panelOpen) return;
  panelOpen = open;
  for (const listener of panelListeners) listener();
}

export function toggleSharePanel(): void {
  setSharePanelOpen(!panelOpen);
}

export function subscribeSharePanel(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

const WIDTH_KEY = "monocode.share.panelWidth";
export const SHARE_PANEL_MIN = 320;
export const SHARE_PANEL_DEFAULT = 400;

export function readSharePanelWidth(): number {
  const value = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(value) && value >= SHARE_PANEL_MIN ? value : SHARE_PANEL_DEFAULT;
}

export function saveSharePanelWidth(width: number): void {
  localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
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

export type ShareFilter = "all" | "media" | "files" | "links" | "text" | "saved";

export const SHARE_FILTERS: readonly { id: ShareFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
  { id: "links", label: "Links" },
  { id: "text", label: "Text" },
  { id: "saved", label: "Saved" },
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
    case "saved":
      return entry.saved === true;
  }
}

/**
 * Fork (L-290): one bubble: a single item, or files sent together with their
 * caption (oldest first, so the caption is last).
 */
export type ShareRow = { key: string; items: ShareEntry[]; at: number };
export type ShareDay = { key: string; label: string; rows: ShareRow[] };

/** Groups items with one `groupId` into a row at the place of the group's first item. */
export function shareRows(items: readonly ShareEntry[]): ShareRow[] {
  const rows: ShareRow[] = [];
  const groups = new Map<string, ShareRow>();
  for (const entry of [...items].sort((a, b) => a.at - b.at)) {
    const group = entry.groupId ? groups.get(entry.groupId) : undefined;
    if (group) {
      group.items.push(entry);
      continue;
    }
    const row = { key: entry.groupId ?? entry.id, items: [entry], at: entry.at };
    if (entry.groupId) groups.set(entry.groupId, row);
    rows.push(row);
  }
  return rows;
}

/** Pinned items, oldest first, for the bar at the top. */
export function pinnedShares(items: readonly ShareEntry[]): ShareEntry[] {
  return items.filter((entry) => entry.pinned).sort((a, b) => a.at - b.at);
}

/** Text long enough to fold behind Show more. */
export function isLongShareText(text: string): boolean {
  return text.length > 700 || text.split("\n").length > 12;
}

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
  for (const row of shareRows(items)) {
    const key = dayKey(row.at);
    const last = days[days.length - 1];
    if (last?.key === key) {
      last.rows.push(row);
      continue;
    }
    const label =
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : new Date(row.at).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: new Date(row.at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
            });
    days.push({ key, label, rows: [row] });
  }
  return days;
}

/** "14:05" — the time under a bubble. */
export function shareTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Fork (L-358): the day and time under a bubble, as on the phone: "Today · 14:05", "Yesterday · …", then the date. */
export function shareStamp(at: number, now = Date.now()): string {
  const key = dayKey(at);
  const day =
    key === dayKey(now)
      ? "Today"
      : key === dayKey(now - 86_400_000)
        ? "Yesterday"
        : new Date(at).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
          });
  return `${day} · ${shareTime(at)}`;
}

/** Fork (L-357): an item matches a search when its text, file name or link has every word, in any case. */
export function matchesShareSearch(entry: ShareEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [entry.text, entry.name].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Fork (L-356): the items the limit counts (pinned and saved never roll off). */
export function shareCounted(items: readonly ShareEntry[]): number {
  return items.filter((entry) => !entry.pinned && !entry.saved).length;
}

/**
 * Fork (Hari, L-384): which of Share's views is showing, and the phone
 * notification a clicked banner asks to scroll to. The panel keeps this in
 * step; the banner hook reads it so it stays quiet while Notifications is open.
 */
export type ShareViewId = "share" | "notifications" | "files" | "settings";

let shareView: ShareViewId = "share";
let shareFocusKey: string | null = null;
const viewListeners = new Set<() => void>();

export function readShareView(): ShareViewId {
  return shareView;
}

/** The notice a clicked banner points at; null once the view has used it. */
export function readShareFocusKey(): string | null {
  return shareFocusKey;
}

export function setShareView(view: ShareViewId, focusKey: string | null = null): void {
  if (view === shareView && focusKey === shareFocusKey) return;
  shareView = view;
  shareFocusKey = focusKey;
  for (const listener of viewListeners) listener();
}

export function subscribeShareView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}
