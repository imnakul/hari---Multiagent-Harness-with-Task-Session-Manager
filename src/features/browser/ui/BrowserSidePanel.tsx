import { useRef } from "react";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { PANEL_DEFAULT, PANEL_MIN } from "../model/browserTabs";
import { BrowserView } from "./BrowserView";

/**
 * Fork (L-207): the Browser beside the chat. Drag its left edge to resize;
 * the width is remembered.
 */
export function BrowserSidePanel({
  visible,
  width,
  onWidth,
  onClose,
}: {
  visible: boolean;
  width: number;
  onWidth: (width: number) => void;
  onClose: () => void;
}) {
  const frame = useRef<HTMLElement>(null);
  const max = Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.75));
  return (
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
      <BrowserView active={visible} panel onClose={onClose} />
    </aside>
  );
}
