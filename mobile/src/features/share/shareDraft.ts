import Storage from "expo-sqlite/kv-store";

import type { ShareFile } from "./shareTransfers";

// Fork (Hari, L-301): Share's unsent message, as a chat's draft (drafts.ts):
// the words are saved on the phone and outlast a restart; picked files stay
// only while Hari runs.

const KEY = "hari.shareDraft";
const SAVE_DELAY_MS = 400;

let files: ShareFile[] = [];
let words: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function readShareDraft(): { text: string; files: ShareFile[] } {
  if (words === null) {
    try {
      words = Storage.getItemSync(KEY) ?? "";
    } catch {
      words = "";
    }
  }
  return { text: words, files };
}

export function writeShareText(text: string) {
  words = text;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void (text ? Storage.setItem(KEY, text) : Storage.removeItem(KEY)).catch(() => {});
  }, SAVE_DELAY_MS);
}

export function writeShareFiles(next: ShareFile[]) {
  files = next;
}
