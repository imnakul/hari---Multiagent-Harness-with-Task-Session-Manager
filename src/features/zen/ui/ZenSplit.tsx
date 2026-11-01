import {
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePresence } from "../../../shared/hooks/usePresence";
import { FocusSash } from "../../focus/ui/FocusSash";
import { clampZenSplit } from "../model/zenPanes";
import { loadZenSplit, saveZenSplit, type ZenSplitName } from "../model/zenWindow";

/** How long the bottom half takes to slide up or away. */
export const ZEN_SLIDE_MS = 240;

/**
 * Zen's two rows (fork, L-230): `top` fills the panel; when `bottom` is set
 * it slides up from the bottom edge to its saved share, and slides away on
 * close while `top` grows back. The edge between them drags like Focus's.
 */
export function ZenSplit({
  name,
  top,
  bottom,
  label,
}: {
  /** Each kind of split keeps its own size. */
  name: ZenSplitName;
  top: ReactNode;
  /** Null closes the bottom half. */
  bottom: ReactNode | null;
  /** Names the edge for screen readers. */
  label: string;
}): ReactNode {
  const [split, setSplit] = useState(() => loadZenSplit(name));
  const area = useRef<HTMLDivElement>(null);
  // The closing half keeps its last content while it slides away.
  const last = useRef<ReactNode>(null);
  if (bottom !== null) last.current = bottom;
  const presence = usePresence(bottom !== null, ZEN_SLIDE_MS);
  const shownBottom = presence.mounted ? (bottom ?? last.current) : null;
  const share = presence.shown ? split : 1;

  const setLive = (value: number, resizing: boolean) => {
    const element = area.current;
    if (!element) return;
    element.style.setProperty("--zen-split", String(clampZenSplit(value)));
    if (resizing) element.dataset.zenResizing = "";
    else delete element.dataset.zenResizing;
  };
  const commit = (value: number) => {
    const next = clampZenSplit(value);
    setLive(next, false);
    setSplit(next);
    saveZenSplit(name, next);
  };

  return (
    <div
      ref={area}
      data-zen-split={name}
      className="group/zen-split relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ "--zen-split": String(share) } as CSSProperties}
    >
      <div
        className="flex min-h-0 min-w-0 shrink-0 flex-col transition-[height] ease-out group-data-[zen-resizing]/zen-split:transition-none motion-reduce:transition-none"
        style={{
          height: "calc(var(--zen-split) * 100%)",
          transitionDuration: `${ZEN_SLIDE_MS}ms`,
        }}
      >
        {top}
      </div>
      {shownBottom !== null ? (
        <>
          {presence.shown ? (
            <FocusSash
              orientation="horizontal"
              sashId={`zen-${name}`}
              label={label}
              value={split}
              style={{
                left: 0,
                right: 0,
                top: "calc(var(--zen-split) * 100% - 4px)",
                height: "8px",
              }}
              measure={() => {
                const rect = area.current?.getBoundingClientRect();
                return rect ? { origin: rect.top, span: rect.height } : null;
              }}
              onPreview={(value) => setLive(value, true)}
              onCommit={commit}
              onCancel={() => setLive(split, false)}
              onReset={() => commit(0.5)}
            />
          ) : null}
          <div
            inert={bottom === null || undefined}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-stroke"
          >
            {shownBottom}
          </div>
        </>
      ) : null}
    </div>
  );
}
