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
 * True for a moment after the pane `paneId` finishes a turn (working → done).
 * Keyed by pane, so the gliding ring moving from a working pane to a done one
 * does not pulse.
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
    if (before.status !== "working" || status !== "done") return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), FINISH_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [paneId, status]);
  return flashing;
}

/**
 * The one ring over the focused pane (L-137/L-144, gliding per L-151, and in
 * workspace splits too since L-184). The caller positions it (`className`,
 * `style`) over the pane's rounded card and moves it; this draws the style:
 * - `static`: the accent border, glowing inward;
 * - `status`: the chat's state — accent while working (a light travels the
 *   border), amber when it waits on you, red after a failed or stopped turn,
 *   green when done, plain accent before anything ran.
 * Panes that are not focused draw no ring or edge in either style.
 */
export function PaneFocusRing({
  paneId,
  paneStyle,
  status,
  className = "",
  style,
  ringAttribute,
}: {
  paneId: string;
  paneStyle: ActivePaneStyle;
  status: PaneStatus;
  className?: string;
  style?: CSSProperties;
  /** Marks the element for DOM-only moves while a divider is dragged. */
  ringAttribute: "data-pane-ring" | "data-focus-ring";
}): ReactElement {
  const flashing = useFinishFlash(paneId, status);
  const statusStyle = paneStyle === "status";
  return (
    <div
      aria-hidden
      {...{ [ringAttribute]: paneId }}
      data-ring-kind={paneStyle}
      data-pane-status={statusStyle ? status : undefined}
      data-pane-flash={statusStyle && flashing ? "" : undefined}
      className={`pane-ring pointer-events-none rounded-[10px]${statusStyle ? "" : " focus-ring"} ${className}`}
      style={style}
    >
      {statusStyle ? <span className="pane-ring-edge" /> : null}
    </div>
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
