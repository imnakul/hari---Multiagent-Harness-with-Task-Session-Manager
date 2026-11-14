import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { CloudUpload, SmartPhone, Trash2 } from "../../../shared/ui/icons";
import { parseShareList, SHARE_CHANGE_EVENT, type ShareList } from "../model/mobileShare";
import { markShareSeen, matchesShareFilter, SHARE_FILTERS, shareDays, type ShareFilter } from "../model/shareView";
import { PhoneStatus, SHARE_SMALL_BUTTON, shareErrorMessage } from "./PhoneStatus";
import { ShareBubble } from "./ShareBubble";
import { ShareComposer } from "./ShareComposer";

type Props = {
  /** False while another view is in front: drops are ignored and nothing is marked seen. */
  active: boolean;
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar: () => void;
};

/** Tauri reports physical pixels on some Windows setups; map back to CSS pixels. */
function toClientPoint(x: number, y: number): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) return { x: x / scale, y: y / scale };
  return { x, y };
}

/**
 * Fork (Hari, L-287): Share as a full app view, a chat with the paired phone.
 * From the phone on the left, to the phone on the right; drop or paste files
 * to send them.
 */
export function ShareView({
  active,
  tabbed = false,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
}: Props): JSX.Element {
  const [list, setList] = useState<ShareList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShareFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    invoke<unknown>("mobile_share_list")
      .then((raw) => {
        setList(parseShareList(raw));
        setLoadError(null);
      })
      .catch((reason: unknown) => setLoadError(shareErrorMessage(reason)));
  }, []);

  useEffect(() => {
    load();
    const changes = listen(SHARE_CHANGE_EVENT, load);
    return () => {
      void changes.then((unlisten) => unlisten());
    };
  }, [load]);

  const items = useMemo(() => list?.items ?? [], [list]);
  const paired = (list?.phones ?? 0) > 0;
  const newestIn = items.find((entry) => entry.direction === "in")?.at ?? 0;

  useEffect(() => {
    if (active && newestIn > 0) markShareSeen(newestIn);
  }, [active, newestIn]);

  const attempt = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (reason: unknown) {
      setError(shareErrorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  // Files dropped anywhere on the view go to the phone.
  useEffect(() => {
    if (!active || !paired) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let lastDropAt = 0;
    const overView = (x: number, y: number) => {
      const root = rootRef.current;
      if (!root) return false;
      const point = toClientPoint(x, y);
      const rect = root.getBoundingClientRect();
      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    };
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        const over = overView(event.payload.position.x, event.payload.position.y);
        if (event.payload.type !== "drop") {
          setDragging(over);
          return;
        }
        setDragging(false);
        // WebView2 can report one drop twice.
        if (!over || Date.now() - lastDropAt < 250 || event.payload.paths.length === 0) return;
        lastDropAt = Date.now();
        const paths = event.payload.paths;
        void attempt(() => invoke<void>("mobile_share_send_files", { paths }));
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((reason: unknown) => console.warn("Share: could not watch for dropped files", reason));
    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, [active, paired, attempt]);

  const visible = useMemo(() => items.filter((entry) => matchesShareFilter(entry, filter)), [items, filter]);
  const days = useMemo(() => shareDays(visible), [visible]);

  // Stay at the newest item as things arrive, like a chat.
  const newestShown = visible[0]?.id;
  useEffect(() => {
    if (!active) return;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [active, newestShown, filter]);

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Share with your phone"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {!tabbed ? (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <SmartPhone className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 truncate text-content">Share</span>
          </div>
          {IS_MAC ? null : <WindowControls />}
        </div>
      ) : null}

      <div className="flex shrink-0 flex-col gap-2 border-b border-stroke px-4 py-2.5">
        {paired ? <PhoneStatus onError={setError} /> : null}
        <div className="flex flex-wrap items-center gap-1">
          <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-1">
            {SHARE_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={`h-7 rounded-full px-3 text-[12px] transition-[background-color,color,transform] duration-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
                  filter === option.id
                    ? "bg-content/[0.12] text-content"
                    : "text-content/55 hover:bg-content/[0.07] hover:text-content"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {items.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              title="Clear the history. Files stay where they are."
              onClick={() => void attempt(() => invoke<void>("mobile_share_remove", { ids: null }))}
              className={`ml-auto ${SHARE_SMALL_BUTTON}`}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              Clear history
            </button>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {list === null ? (
          loadError ? (
            <div role="alert" className="mx-auto mt-10 max-w-sm text-center text-[12.5px] text-content/60">
              <p>Couldn't load the Share history. {loadError}</p>
              <button type="button" onClick={load} className={`mt-3 ${SHARE_SMALL_BUTTON}`}>
                Try again
              </button>
            </div>
          ) : (
            <ul aria-busy="true" aria-label="Loading Share history" className="mx-auto max-w-3xl space-y-3">
              {[0, 1, 2].map((index) => (
                <li
                  key={index}
                  className={`h-12 w-2/5 animate-pulse rounded-2xl bg-content/[0.06] ${index === 1 ? "ml-auto" : ""}`}
                />
              ))}
            </ul>
          )
        ) : items.length === 0 ? (
          <div className="mx-auto mt-12 max-w-sm text-center">
            <SmartPhone className="mx-auto size-6 text-content/30" strokeWidth={1.5} aria-hidden />
            <p className="mt-3 text-[13px] text-content/75">Nothing shared yet</p>
            <p className="mt-1 text-[12px] text-content/45">
              {paired
                ? "Send text, links, the clipboard or files below. Files from the phone go to Downloads\\Hari."
                : "Pair Hari on your phone (Settings → Mobile) to send text, links, the clipboard and files both ways."}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-12 text-center text-[12.5px] text-content/45">
            No {SHARE_FILTERS.find((option) => option.id === filter)?.label.toLowerCase()} yet.
          </p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h3 className="mb-2 text-center text-[11px] font-medium text-content/40">{day.label}</h3>
                <ul className="space-y-2.5">
                  {day.items.map((entry) => (
                    <ShareBubble key={entry.id} entry={entry} paired={paired} onError={setError} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="shrink-0 border-t border-stroke px-4 py-2 text-[12px] text-red-400">
          {error}
        </p>
      ) : null}

      {list !== null && paired ? (
        <ShareComposer busy={busy} attempt={attempt} />
      ) : list !== null && items.length > 0 ? (
        <p className="shrink-0 border-t border-stroke px-4 py-3 text-[12px] text-content/55">
          Pair Hari on your phone (Settings → Mobile) to send text, links, the clipboard and files both ways.
        </p>
      ) : null}

      {dragging ? (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-accent/60 bg-surface/85">
          <span className="flex items-center gap-2 text-[13px] text-content">
            <CloudUpload className="size-4" strokeWidth={1.75} aria-hidden />
            Drop to send to your phone
          </span>
        </div>
      ) : null}
    </div>
  );
}
