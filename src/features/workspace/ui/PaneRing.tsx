import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from "react";
import type { PaneStatus } from "../../sessions/model/paneStatus";
import {
  loadActivePaneStyle,
  loadInactivePaneDim,
  subscribeActivePaneStyle,
  subscribeInactivePaneDim,
  type ActivePaneStyle,
  type InactivePaneDim,
} from "../../settings/model/settings";

/** How long the green "finished" flash shows after a turn ends. */
const FINISH_FLASH_MS = 1_600;

/** Settings → Appearance → Focused pane style (L-184), live. */
export function useActivePaneStyle(): ActivePaneStyle {
  return useSyncExternalStore(
    subscribeActivePaneStyle,
    loadActivePaneStyle,
    loadActivePaneStyle,
  );
}

/** Settings → Appearance → Dim other panes (L-184), live. */
export function useInactivePaneDim(): InactivePaneDim {
  return useSyncExternalStore(
    subscribeInactivePaneDim,
    loadInactivePaneDim,
    loadInactivePaneDim,
  );
}

/**
 * True for a moment after the pane `paneId` stops working. Keyed by pane, so
 * the gliding ring moving from a working pane to an idle one does not flash.
 */
function useFinishFlash(paneId: string, status: PaneStatus): boolean {
  const previous = useRef({ paneId, status });
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = { paneId, status };
    if (before.paneId !== paneId) {
      setFlashing(false);
      return;
    }
    if (before.status !== "working" || status !== "idle") return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), FINISH_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [paneId, status]);
  return flashing;
}

/**
 * The one ring over the focused pane (L-137/L-144, gliding per L-151 and now
 * in workspace splits too). The caller positions it (`className`, `style`)
 * and moves it; this draws the chosen style:
 * - `static`: the accent border and glow the app always had;
 * - `gradient`: a two-tone accent border;
 * - `status`: the chat's state — accent when idle, a light travelling the
 *   border while working, amber when it waits on you, red after an error,
 *   a green flash when a turn finishes.
 *
 * `inset` suits flush workspace panes (glow inside), `card` the rounded Focus
 * panes (glow outside).
 */
export function PaneFocusRing({
  paneId,
  paneStyle,
  status,
  variant,
  className = "",
  style,
  ringAttribute,
}: {
  paneId: string;
  paneStyle: ActivePaneStyle;
  status: PaneStatus;
  variant: "inset" | "card";
  className?: string;
  style?: CSSProperties;
  /** Marks the element for DOM-only moves while a divider is dragged. */
  ringAttribute: "data-pane-ring" | "data-focus-ring";
}): ReactElement {
  const flashing = useFinishFlash(paneId, status);
  const legacy =
    paneStyle === "static"
      ? variant === "card"
        ? " focus-ring"
        : " active-pane-ring"
      : "";
  return (
    <div
      aria-hidden
      {...{ [ringAttribute]: paneId }}
      data-ring-kind={paneStyle}
      data-ring-variant={variant}
      data-pane-status={paneStyle === "status" ? status : undefined}
      data-pane-flash={paneStyle === "status" && flashing ? "" : undefined}
      className={`pane-ring pointer-events-none${legacy} ${className}`}
      style={style}
    >
      {paneStyle === "static" ? null : <span className="pane-ring-edge" />}
    </div>
  );
}

/**
 * A thin status edge on a pane that is not focused, for the `status` style:
 * so a chat waiting on you, failing or finishing shows without focusing it.
 * Idle panes draw nothing. Keep it mounted (with `hidden` while the pane is
 * focused) so it notices a turn finishing.
 */
export function PaneStatusEdge({
  paneId,
  status,
  hidden,
  className = "",
}: {
  paneId: string;
  status: PaneStatus;
  hidden: boolean;
  className?: string;
}): ReactElement | null {
  const flashing = useFinishFlash(paneId, status);
  if (hidden || (status === "idle" && !flashing)) return null;
  return (
    <span
      aria-hidden
      data-pane-status={status}
      data-pane-flash={flashing ? "" : undefined}
      className={`pane-status-edge pointer-events-none absolute inset-0 z-20 ${className}`}
    >
      <span className="pane-ring-edge" />
    </span>
  );
}

/**
 * `data-pane-dim` for a pane: the dim strength when it is not focused and
 * more than one pane shows, else nothing.
 */
export function paneDimAttribute(
  dim: InactivePaneDim,
  focused: boolean,
  multiplePanes: boolean,
): InactivePaneDim | undefined {
  return dim !== "off" && !focused && multiplePanes ? dim : undefined;
}
