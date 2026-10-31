import { openUrl } from "@tauri-apps/plugin-opener";
import { loadTerminalLinkTarget } from "../../settings/model/terminalLinkSettings";
import { openInMonoBrowser } from "./browserRequest";

/**
 * Opens a clicked web link where Settings → Web links says (fork, L-220):
 * MonoCode's Browser, or the system's default browser. Covers chats, notes,
 * previews and terminals; other schemes are ignored.
 */
export function openWebLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (loadTerminalLinkTarget() === "monocode") {
    openInMonoBrowser(url);
    return;
  }
  void openUrl(url).catch((error: unknown) => {
    console.error("Failed to open web link:", error);
  });
}
