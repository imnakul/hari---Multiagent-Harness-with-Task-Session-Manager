import { useSyncExternalStore } from "react";

/**
 * How eagerly chat replies preview their web links (L-119). `hover` fetches a
 * page only once its link is hovered; `always` also shows cards under a
 * finished reply, fetched as they scroll into view.
 */
export type LinkPreviewMode = "off" | "hover" | "always";

export const LINK_PREVIEW_MODE_KEY = "monocode.linkPreviewMode";
export const LINK_PREVIEW_MODE_DEFAULT: LinkPreviewMode = "hover";
const CHANGE_EVENT = "monocode:linkpreviewmodechange";

function isMode(value: unknown): value is LinkPreviewMode {
  return value === "off" || value === "hover" || value === "always";
}

// Holds a choice only while storage failed to keep it, so the control still
// changes for this window when localStorage is unavailable.
let unsaved: LinkPreviewMode | null = null;

function readStored(): LinkPreviewMode | null {
  try {
    const value = localStorage.getItem(LINK_PREVIEW_MODE_KEY);
    return isMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadLinkPreviewMode(): LinkPreviewMode {
  return unsaved ?? readStored() ?? LINK_PREVIEW_MODE_DEFAULT;
}

export function saveLinkPreviewMode(mode: LinkPreviewMode): void {
  try {
    localStorage.setItem(LINK_PREVIEW_MODE_KEY, mode);
  } catch {
    /* unavailable storage */
  }
  unsaved = readStored() === mode ? null : mode;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LinkPreviewMode>(CHANGE_EVENT, { detail: mode }));
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Other windows write the same localStorage; `storage` reports their saves.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LINK_PREVIEW_MODE_KEY && event.key !== null) return;
    unsaved = null;
    onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLinkPreviewMode(): LinkPreviewMode {
  return useSyncExternalStore(subscribe, loadLinkPreviewMode, loadLinkPreviewMode);
}
