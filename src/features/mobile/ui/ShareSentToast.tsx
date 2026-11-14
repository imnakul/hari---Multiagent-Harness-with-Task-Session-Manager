import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { SmartPhone, X } from "../../../shared/ui/icons";
import {
  dismissShareSentNotice,
  holdShareSentNotice,
  useShareSentNotice,
} from "../model/sendToShare";
import { setSharePanelOpen } from "../model/shareView";

/**
 * Fork (Hari, L-291): "Sent to your phone", with Show (opens Share), after a
 * right-click "Send to phone". Same corner as the other toasts.
 */
export function ShareSentToast(): ReactElement | null {
  const notice = useShareSentNotice();
  if (!notice) return null;
  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast, top: 12 }}
      className="pointer-events-none fixed right-3 flex w-[min(320px,calc(100vw-24px))] flex-col"
    >
      <article
        key={notice.id}
        role={notice.ok ? "status" : "alert"}
        onMouseEnter={() => holdShareSentNotice(true)}
        onMouseLeave={() => holdShareSentNotice(false)}
        className="approval-toast pointer-events-auto overflow-hidden rounded-xl border border-content/20 bg-surface/95 shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <SmartPhone
            aria-hidden
            className={`size-4 shrink-0 ${notice.ok ? "text-content/70" : "text-red-400"}`}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] text-content" title={notice.message}>
            {notice.message}
          </span>
          {notice.ok ? (
            <button
              type="button"
              onClick={() => {
                setSharePanelOpen(true);
                dismissShareSentNotice();
              }}
              className="flex h-7 shrink-0 items-center rounded-md border border-content/15 px-2.5 text-[12px] font-medium text-content/90 hover:bg-content/10 hover:text-content"
            >
              Show
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissShareSentNotice}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      </article>
    </div>,
    document.body,
  );
}
