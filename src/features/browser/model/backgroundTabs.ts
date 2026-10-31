import { useSyncExternalStore } from "react";
import { isWebUrl, showMonoBrowser } from "./browserRequest";
import { backgroundTab, browserShowing, selectTab } from "./browserTabs";

/**
 * Fork (L-224): links opened in a background tab of MonoCode's Browser,
 * whatever Settings → Web links says. The shown Browser loads them out of
 * sight; with no Browser on screen, a notice offers to show the newest one.
 */

export type BackgroundNotice = { tab: number; count: number };

const NOTICE_MS = 6000;

let notice: BackgroundNotice | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setNotice(next: BackgroundNotice | null) {
  notice = next;
  clearTimeout(timer);
  if (next) timer = setTimeout(() => setNotice(null), NOTICE_MS);
  for (const listener of listeners) listener();
}

export function openInBackgroundTab(url: string): void {
  if (!isWebUrl(url)) return;
  const tab = backgroundTab(url);
  if (browserShowing()) return;
  setNotice({ tab, count: (notice?.count ?? 0) + 1 });
}

export function showBackgroundTab(tab: number): void {
  setNotice(null);
  selectTab(tab);
  showMonoBrowser();
}

export function dismissBackgroundNotice(): void {
  setNotice(null);
}

/** Keeps the notice up while the pointer is on it. */
export function holdBackgroundNotice(hold: boolean): void {
  clearTimeout(timer);
  if (!hold && notice) timer = setTimeout(() => setNotice(null), NOTICE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function backgroundNotice(): BackgroundNotice | null {
  return notice;
}

export function useBackgroundNotice(): BackgroundNotice | null {
  return useSyncExternalStore(subscribe, backgroundNotice, () => null);
}
