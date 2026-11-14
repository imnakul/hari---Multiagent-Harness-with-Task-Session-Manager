import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState, useSyncExternalStore, type JSX } from "react";
import { SmartPhone } from "../../../shared/ui/icons";
import { parseShareList, SHARE_CHANGE_EVENT } from "../model/mobileShare";
import { readShareSeen, readSharePanelOpen, subscribeSharePanel, subscribeShareSeen, toggleSharePanel } from "../model/shareView";

const BUTTON =
  "flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content";

/**
 * Fork (Hari, L-279, L-287, L-290): the title-bar phone button. It opens and
 * closes the Share panel; arrivals put a dot on it until Share has shown them.
 */
export function ShareButton(): JSX.Element {
  const [newestIn, setNewestIn] = useState(0);
  const seenAt = useSyncExternalStore(subscribeShareSeen, readShareSeen, readShareSeen);
  const open = useSyncExternalStore(subscribeSharePanel, readSharePanelOpen, () => false);

  const load = useCallback(() => {
    invoke<unknown>("mobile_share_list")
      .then((raw) => {
        const newest = parseShareList(raw).items.find((entry) => entry.direction === "in");
        setNewestIn(newest?.at ?? 0);
      })
      .catch((reason: unknown) => console.warn("Share: could not load the history", reason));
  }, []);

  useEffect(() => {
    load();
    const changes = listen(SHARE_CHANGE_EVENT, load);
    return () => {
      void changes.then((unlisten) => unlisten());
    };
  }, [load]);

  const unseen = newestIn > seenAt;

  return (
    <button
      type="button"
      title="Share with your phone"
      aria-label={unseen ? "Share with your phone, new items" : "Share with your phone"}
      data-tauri-drag-region="false"
      aria-pressed={open}
      onClick={toggleSharePanel}
      className={`relative ${BUTTON} ${open ? "bg-content/10 text-content" : ""}`}
    >
      <SmartPhone className="size-3.5" strokeWidth={1.75} />
      {unseen ? (
        <span className="absolute right-[13px] top-[calc(50%-8px)] size-1.5 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}
