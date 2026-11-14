import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

/**
 * Fork (Hari, L-291): "Send to phone" from right-click menus. Sends in the
 * background and says how it went in a small toast, whose Show opens the
 * Share panel.
 */
export type ShareSentNotice = { id: number; ok: boolean; message: string };

let notice: ShareSentNotice | null = null;
let timer: number | null = null;
let held = false;
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function schedule() {
  if (timer != null) window.clearTimeout(timer);
  timer = held ? null : window.setTimeout(dismissShareSentNotice, 3500);
}

function show(ok: boolean, message: string) {
  counter += 1;
  notice = { id: counter, ok, message };
  emit();
  schedule();
}

export function dismissShareSentNotice(): void {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  notice = null;
  emit();
}

export function holdShareSentNotice(hold: boolean): void {
  held = hold;
  if (notice) schedule();
}

export function useShareSentNotice(): ShareSentNotice | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notice,
    () => null,
  );
}

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Couldn't send it";

/** Sends text or a link to the phone; `what` names it in the toast ("Link", "Text"). */
export async function sendTextToShare(text: string, what = "Text"): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    await invoke<void>("mobile_share_send_text", { text: trimmed, clipboard: false });
    show(true, `${what} sent to your phone`);
  } catch (reason) {
    show(false, errorText(reason));
  }
}

/** Sends files on this computer to the phone. */
export async function sendFilesToShare(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await invoke<void>("mobile_share_send_files", { paths });
    show(true, paths.length === 1 ? "File sent to your phone" : `${paths.length} files sent to your phone`);
  } catch (reason) {
    show(false, errorText(reason));
  }
}
