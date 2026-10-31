import { useSyncExternalStore } from "react";

/**
 * Where web links clicked in a terminal open (fork, L-207): MonoCode's own
 * Browser, or the system's default browser.
 */
export type TerminalLinkTarget = "monocode" | "default";

export const TERMINAL_LINK_TARGET_KEY = "monocode.terminalLinkTarget";
export const TERMINAL_LINK_TARGET_DEFAULT: TerminalLinkTarget = "monocode";
const CHANGE_EVENT = "monocode:terminallinktargetchange";

function isTarget(value: unknown): value is TerminalLinkTarget {
  return value === "monocode" || value === "default";
}

// Holds a choice only while storage failed to keep it.
let unsaved: TerminalLinkTarget | null = null;

function readStored(): TerminalLinkTarget | null {
  try {
    const value = localStorage.getItem(TERMINAL_LINK_TARGET_KEY);
    return isTarget(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadTerminalLinkTarget(): TerminalLinkTarget {
  return unsaved ?? readStored() ?? TERMINAL_LINK_TARGET_DEFAULT;
}

export function saveTerminalLinkTarget(target: TerminalLinkTarget): void {
  try {
    localStorage.setItem(TERMINAL_LINK_TARGET_KEY, target);
  } catch {
    /* unavailable storage */
  }
  unsaved = readStored() === target ? null : target;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TerminalLinkTarget>(CHANGE_EVENT, { detail: target }));
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== TERMINAL_LINK_TARGET_KEY && event.key !== null) return;
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

export function useTerminalLinkTarget(): TerminalLinkTarget {
  return useSyncExternalStore(subscribe, loadTerminalLinkTarget, loadTerminalLinkTarget);
}
