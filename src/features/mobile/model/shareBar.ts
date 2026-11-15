import { invoke } from "@tauri-apps/api/core";
import { IS_WIN } from "../../../platform/tauri/platform";
import { loadShareBarShortcut } from "../../settings/model/settings";

/** Shown and hidden by the backend on its global shortcut. */
export const SHARE_BAR_SHOWN_EVENT = "share_bar_shown";

/**
 * Fork (L-320): claims or releases the Share bar's global shortcut.
 *
 * @throws "Shortcut taken: …" when another app or MonoCode holds the chord;
 * the previous chord then stays active.
 */
export async function setShareBarShortcut(enabled: boolean, shortcut = loadShareBarShortcut()): Promise<void> {
  if (!IS_WIN) return;
  await invoke("share_bar_set_enabled", { enabled, shortcut });
}

