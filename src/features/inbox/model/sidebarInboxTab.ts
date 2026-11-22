import { useSyncExternalStore } from "react";

/** Fork (L-380): whether the classic sidebar shows an Inbox tab. Off until switched on in Settings. */
export const SIDEBAR_INBOX_TAB_KEY = "monocode.inbox.sidebarTab.v1";
const CHANGE_EVENT = "monocode:sidebar-inbox-tab-change";

export function loadSidebarInboxTab(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_INBOX_TAB_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarInboxTab(on: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_INBOX_TAB_KEY, on ? "1" : "0");
  } catch {
    // Storage is unavailable: the switch simply doesn't stick.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSidebarInboxTab(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === SIDEBAR_INBOX_TAB_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarInboxTab(): boolean {
  return useSyncExternalStore(subscribeSidebarInboxTab, loadSidebarInboxTab, () => false);
}
