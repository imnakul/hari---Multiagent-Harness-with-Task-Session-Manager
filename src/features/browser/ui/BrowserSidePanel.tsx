import { useRef, useState } from "react";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { SlidePanel } from "../../../shared/ui/SlidePanel";
import { PANEL_DEFAULT, PANEL_MIN } from "../model/browserTabs";
import { BrowserView } from "./BrowserView";

/**
 * Fork (L-207): the Browser beside the chat. Drag its left edge to resize;
 * the width is remembered. Slides in and out (L-219): the page shows as a
 * still picture while it moves, and goes live once the panel rests.
 */
export function BrowserSidePanel({
  open,
  visible,
  width,
  onWidth,
  onClose,
  onGone,
}: {
  open: boolean;
  visible: boolean;
  width: number;
  onWidth: (width: number) => void;
  onClose: () => void;
  /** The slide out has ended; unmount now. */
  onGone: () => void;
}) {
  const frame = useRef<HTMLElement>(null);
  const max = Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.75));
  const [still, setStill] = useState(true);
  const stillDone = useRef<(() => void) | null>(null);
  return (
    <SlidePanel
      open={open}
      appear
      onMoving={setStill}
      // `onMoving(true)` has just asked for the picture. Wait for it, unless
      // the page was already still (closed mid-slide).
      beforeLeave={() =>
        new Promise<void>((done) => {
          if (still) done();
          else stillDone.current = done;
        })
      }
      onGone={onGone}
    >
      <aside
        ref={frame}
        aria-label="Browser panel"
        style={{ width: Math.min(width, max) }}
        className={`relative my-2 mr-2 ${visible ? "flex" : "hidden"} min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-content/10 bg-surface shadow-xl`}
      >
        <ResizeHandle
          label="Resize Browser panel"
          value={width}
          min={PANEL_MIN}
          max={max}
          defaultValue={PANEL_DEFAULT}
          placement="inset-y-0 left-0"
          reverse
          look="line"
          onLive={(next) => {
            if (frame.current) frame.current.style.width = `${next ?? width}px`;
          }}
          onCommit={onWidth}
        />
        <BrowserView
          active={visible}
          panel
          still={still}
          onStill={() => {
            stillDone.current?.();
            stillDone.current = null;
          }}
          onClose={onClose}
        />
      </aside>
    </SlidePanel>
  );
}
