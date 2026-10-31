import { useSyncExternalStore } from "react";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { Globe } from "../../../shared/ui/icons";
import { browserStore, subscribeBrowser, togglePanel } from "../model/browserTabs";

/** Fork (L-207): shows or hides the Browser side panel beside the chat. */
export function BrowserPanelButton() {
  const open = useSyncExternalStore(subscribeBrowser, () => browserStore().panelOpen);
  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-pressed={open}
      aria-label="Browser panel"
      title={`${open ? "Hide" : "Show"} Browser panel (${MOD}${SHIFT}U)`}
      className={`flex size-6 items-center justify-center rounded-md transition-colors duration-100 hover:bg-content/5 hover:text-content ${
        open ? "text-accent" : "text-content/50"
      }`}
    >
      <Globe aria-hidden className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}
