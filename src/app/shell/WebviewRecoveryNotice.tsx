import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../shared/lib/layers";
import { X } from "../../shared/ui/icons";
import { GlassBackdrop } from "./GlassBackdrop";

const NOTICE_MS = 8000;

// Asked once per page load: the flag is cleared when read, so a second
// call (as from React's dev double-mount) would always answer false.
let recoveryCheck: Promise<boolean> | undefined;

function wasRecovered(): Promise<boolean> {
  recoveryCheck ??= invoke<unknown>("take_webview_recovery").then(
    (value) => value === true,
    // Outside the desktop app (tests, web preview) there is no such command.
    () => false,
  );
  return recoveryCheck;
}

/**
 * Fork (L-160): after Windows crash recovery reloads the page, says so once,
 * so a sudden restart of the UI is not a mystery. Unsent composer text comes
 * back on its own (draftCache saves it).
 */
export function WebviewRecoveryNotice(): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    void wasRecovered().then((recovered) => {
      if (mounted && recovered) setVisible(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <section
      role="status"
      aria-label="MonoCode reloaded"
      style={{ zIndex: LAYER.toast }}
      className="fixed bottom-4 left-1/2 isolate flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 items-start gap-2 overflow-hidden rounded-xl border border-content/10 text-content shadow-xl"
    >
      <GlassBackdrop />
      <p className="relative z-[1] flex-1 px-3 py-2.5 text-[12px] leading-relaxed text-content/80">
        MonoCode reloaded after its display crashed. Unsent text was kept.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={() => setVisible(false)}
        className="relative z-[1] m-1.5 grid size-6 shrink-0 place-items-center rounded-md text-content/55 transition-[background-color,color,scale] duration-100 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-96 motion-reduce:active:scale-100"
      >
        <X aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>
    </section>,
    document.body,
  );
}
