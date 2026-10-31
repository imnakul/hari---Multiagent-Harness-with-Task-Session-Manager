import { useSyncExternalStore } from "react";
import { isWebUrl } from "./browserRequest";

/**
 * Fork (L-226): Browser bookmarks, saved on this computer, newest first, and
 * the text for Copy all tab links.
 */

export type Bookmark = { url: string; title: string };

const BOOKMARKS_KEY = "monocode.browser.bookmarks";
const MAX_BOOKMARKS = 500;

function read(): Bookmark[] {
  try {
    const list = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? "[]") as unknown;
    return Array.isArray(list)
      ? list
          .filter((item): item is Bookmark => typeof item?.url === "string" && isWebUrl(item.url))
          .map((item) => ({ url: item.url, title: typeof item.title === "string" ? item.title : "" }))
      : [];
  } catch {
    return [];
  }
}

let bookmarks: Bookmark[] | null = null;
const listeners = new Set<() => void>();

export function loadBookmarks(): Bookmark[] {
  bookmarks ??= read();
  return bookmarks;
}

function save(next: Bookmark[]) {
  bookmarks = next.slice(0, MAX_BOOKMARKS);
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    // private mode / quota
  }
  for (const listener of listeners) listener();
}

export function isBookmarked(url: string): boolean {
  return loadBookmarks().some((item) => item.url === url);
}

/** Adds the page, or removes it when it is already bookmarked. Returns whether it is now saved. */
export function toggleBookmark(url: string, title: string): boolean {
  if (!isWebUrl(url)) return false;
  if (isBookmarked(url)) {
    removeBookmark(url);
    return false;
  }
  save([{ url, title: title.trim() }, ...loadBookmarks()]);
  return true;
}

export function removeBookmark(url: string) {
  save(loadBookmarks().filter((item) => item.url !== url));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBookmarks(): Bookmark[] {
  return useSyncExternalStore(subscribe, loadBookmarks, () => []);
}

/** Every tab's address, one per line, in tab order; blank tabs and repeats left out. */
export function tabLinksText(tabs: { url: string; pending?: string | null }[]): string {
  const urls = tabs.map((tab) => tab.url || tab.pending || "").filter(isWebUrl);
  return [...new Set(urls)].join("\n");
}
