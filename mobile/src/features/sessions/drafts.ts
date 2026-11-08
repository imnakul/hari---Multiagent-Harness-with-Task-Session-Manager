import Storage from "expo-sqlite/kv-store";

import type { Attachment } from "./attachments";

// Fork (Hari, L-235): a composer's unsent message, per chat, so leaving for
// Settings or another chat and coming back finds it as it was. The words are
// saved on the phone and outlast a restart; attached files only stay while the
// app runs, as they are too large to keep.

export type Draft = { text: string; attachments: Attachment[] };

const PREFIX = "hari.draft.";
/** Waits this long after the last keystroke before saving the words. */
const SAVE_DELAY_MS = 400;

const held = new Map<string, Draft>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The chat's draft: held in memory, else its saved words, else empty. */
export function readDraft(key: string | undefined): Draft {
  if (!key) return { text: "", attachments: [] };
  const kept = held.get(key);
  if (kept) return kept;
  let text = "";
  try {
    text = Storage.getItemSync(PREFIX + key) ?? "";
  } catch {
    // Starts empty.
  }
  return { text, attachments: [] };
}

/** Keeps the chat's draft; an empty one is forgotten. */
export function writeDraft(key: string | undefined, draft: Draft) {
  if (!key) return;
  const empty = draft.text.length === 0 && draft.attachments.length === 0;
  if (empty) held.delete(key);
  else held.set(key, draft);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const words = draft.text;
      void (words ? Storage.setItem(PREFIX + key, words) : Storage.removeItem(PREFIX + key)).catch(
        () => {},
      );
    }, SAVE_DELAY_MS),
  );
}
