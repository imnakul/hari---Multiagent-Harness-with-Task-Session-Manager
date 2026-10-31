import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { AppWindow, X } from "../../../shared/ui/icons";
import {
  dismissBackgroundNotice,
  holdBackgroundNotice,
  showBackgroundTab,
  useBackgroundNotice,
} from "../model/backgroundTabs";

/**
 * Fork (L-224): "Opened in a background tab", with Show, when a link went to
 * MonoCode's Browser while it wasn't on screen. Same corner as the other
 * toasts (ApprovalToasts, UpdateToasts).
 */
export function BackgroundTabToast(): ReactElement | null {
  const notice = useBackgroundNotice();
  if (!notice) return null;
  const label =
    notice.count === 1 ? "Opened in a background tab" : `Opened ${notice.count} background tabs`;

  return createPortal(
    <div
      aria-live="polite"
      style={{ zIndex: LAYER.toast, top: 12 }}
      className="pointer-events-none fixed right-3 flex w-[min(320px,calc(100vw-24px))] flex-col"
    >
      <article
        role="status"
        onMouseEnter={() => holdBackgroundNotice(true)}
        onMouseLeave={() => holdBackgroundNotice(false)}
        className="approval-toast pointer-events-auto overflow-hidden rounded-xl border border-content/20 border-dashed bg-content/10 shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <AppWindow aria-hidden className="size-4 shrink-0 text-content/70" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-content">{label}</span>
          <button
            type="button"
            onClick={() => showBackgroundTab(notice.tab)}
            className="flex h-7 shrink-0 items-center rounded-md border border-content/15 px-2.5 text-[12px] font-medium text-content/90 hover:bg-content/10 hover:text-content"
          >
            Show
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissBackgroundNotice}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </article>
    </div>,
    document.body,
  );
}
