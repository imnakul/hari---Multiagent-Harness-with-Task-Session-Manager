import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import {
  ArrowUpRight,
  Archive,
  Bell,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  ListFilter,
  Pin,
  Settings,
  SmartPhone,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { useWindowWidth } from "../../../shared/hooks/useWindowWidth";
import { SlidePanel } from "../../../shared/ui/SlidePanel";
import { SelectMenu } from "../../sessions/ui/SelectMenu";
import { formatFileSize } from "../../files/model/filePreview";
import { parseShareList, SHARE_CHANGE_EVENT, type ShareList } from "../model/mobileShare";
import {
  markShareSeen,
  matchesShareFilter,
  pinnedShares,
  readSharePanelOpen,
  readSharePanelWidth,
  saveSharePanelWidth,
  setSharePanelOpen,
  SHARE_FILTERS,
  SHARE_PANEL_DEFAULT,
  SHARE_PANEL_MIN,
  shareDays,
  subscribeSharePanel,
  type ShareFilter,
} from "../model/shareView";
import { PhoneFilesView } from "./PhoneFilesView";
import { PhoneNotificationsView } from "./PhoneNotificationsView";
import { PhoneStatus, SHARE_SMALL_BUTTON, shareErrorMessage } from "./PhoneStatus";
import { isPicture, ShareBubble, ShareImage, ShareText } from "./ShareBubble";
import { ShareComposer } from "./ShareComposer";

/** Tauri reports physical pixels on some Windows setups; map back to CSS pixels. */
function toClientPoint(x: number, y: number): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) return { x: x / scale, y: y / scale };
  return { x, y };
}

type Storage = { historyBytes: number; filesBytes: number; files: number };

type ShareView = "share" | "notifications" | "files" | "settings";
type ShareTab = Exclude<ShareView, "settings">;

/**
 * Fork (Hari, L-332, L-337): Share's tabs, in the header. Notifications and
 * Files need a paired phone; Settings is the gear beside them.
 */
const SHARE_TABS: readonly { id: ShareTab; label: string }[] = [
  { id: "share", label: "Share" },
  { id: "notifications", label: "Notifications" },
  { id: "files", label: "Files" },
];
/** Below this panel width Notifications shows as a bell, so the header fits. */
const SHARE_TABS_NARROW = 380;

const SHARE_FILTER_OPTIONS = SHARE_FILTERS.map((option) => ({ value: option.id, label: option.label }));

const HEADER_BUTTON =
  "grid size-7 place-items-center rounded-md text-content/55 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/**
 * Fork (Hari, L-338): the pinned items as one card at the top. Folded it
 * shows one line; a click opens it in place (the picture, or the whole text
 * in a box that scrolls). The arrow jumps to it in the chat; with several
 * pins, the chevrons step through them.
 */
function PinCard({
  pins,
  onJump,
}: {
  pins: ReturnType<typeof pinnedShares>;
  onJump: (id: string) => void;
}): JSX.Element | null {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (!pins.length) return null;
  const at = Math.min(index, pins.length - 1);
  const current = pins[at];
  if (!current) return null;
  const label =
    current.kind === "file" ? (current.name ?? "File") : (current.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  const step = (delta: number) => setIndex((at + delta + pins.length) % pins.length);
  return (
    <section aria-label="Pinned" className="shrink-0 border-b border-stroke">
      <div className="flex min-w-0 items-center gap-0.5 py-1 pl-3 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          title={open ? "Fold the pin" : "Open the pin here"}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          <Pin className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-content/80">{label}</span>
          <ChevronDown
            className={`size-3.5 shrink-0 text-content/45 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        {pins.length > 1 ? (
          <>
            <span className="shrink-0 px-1 text-[11px] tabular-nums text-content/40">
              {at + 1} of {pins.length}
            </span>
            <button type="button" title="Previous pin" aria-label="Previous pin" onClick={() => step(-1)} className={HEADER_BUTTON}>
              <ChevronUp className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" title="Next pin" aria-label="Next pin" onClick={() => step(1)} className={HEADER_BUTTON}>
              <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}
        <button
          type="button"
          title="Go to it in the chat"
          aria-label="Go to the pinned message in the chat"
          onClick={() => onJump(current.id)}
          className={HEADER_BUTTON}
        >
          <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {open ? (
        <div key={current.id} className="max-h-72 overflow-y-auto px-3 pb-2.5 animate-[zen-step-in_220ms_ease-out_both]">
          {isPicture(current) && current.path ? (
            <ShareImage path={current.path} label={current.name ?? "Picture"} tile={false} />
          ) : current.kind === "file" ? (
            <p className="text-[12px] text-content/60">
              {current.name ?? "File"}
              {current.size !== undefined ? ` · ${formatFileSize(current.size)}` : ""}
            </p>
          ) : (
            <ShareText text={current.text ?? ""} />
          )}
        </div>
      ) : null}
    </section>
  );
}

/** How much Share takes on this computer, with Delete all (pinned and saved stay). */
function StorageStrip({
  busy,
  attempt,
  onDone,
}: {
  busy: boolean;
  attempt: (action: () => Promise<void>) => Promise<boolean>;
  onDone: () => void;
}): JSX.Element {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const load = useCallback(() => {
    invoke<Storage>("mobile_share_storage").then(setStorage, () => setStorage(null));
  }, []);
  useEffect(load, [load]);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-content/65">
      <Archive className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">
        {storage
          ? `${storage.files} file${storage.files === 1 ? "" : "s"} · ${formatFileSize(storage.filesBytes)} in Downloads\\Hari · history ${formatFileSize(storage.historyBytes)}`
          : "Checking…"}
        {freed !== null ? ` · freed ${formatFileSize(freed)}` : ""}
      </span>
      {confirming ? (
        <>
          <button type="button" onClick={() => setConfirming(false)} className={SHARE_SMALL_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                const result = await invoke<{ freed: number }>("mobile_share_clear");
                setFreed(result.freed);
                setConfirming(false);
                load();
              }).then((done) => {
                if (done) onDone();
              })
            }
            className={`${SHARE_SMALL_BUTTON} border-red-400/40 text-red-400 hover:bg-red-400/10`}
          >
            Delete on both
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          title="Delete the history and the received files on this computer and the phone. Pinned and saved items stay."
          onClick={() => setConfirming(true)}
          className={SHARE_SMALL_BUTTON}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          Delete all
        </button>
      )}
    </div>
  );
}

/**
 * Fork (Hari, L-287, L-290): Share as a panel on the right, a chat with the
 * paired phone. The title-bar phone button opens and closes it. Drop, paste
 * or attach files to send them; pins sit in a bar at the top.
 */
function ShareContent({ onClose, width }: { onClose: () => void; width: number }): JSX.Element {
  const [list, setList] = useState<ShareList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShareFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<string[]>([]);
  // Fork (Hari, L-325, L-332): Share itself, the phone's notifications, its files, or settings.
  const [view, setView] = useState<ShareView>("share");
  const awayFromShare = view !== "share";
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
  const narrow = width < SHARE_TABS_NARROW;
  const tabs = useMemo(
    () =>
      SHARE_TABS.filter((tab) => paired || tab.id === "share").map((tab) =>
        tab.id === "notifications" && narrow ? { ...tab, icon: Bell, iconOnly: true } : tab,
      ),
    [paired, narrow],
  );
  const newestIn = items.find((entry) => entry.direction === "in")?.at ?? 0;

  useEffect(() => {
    if (newestIn > 0) markShareSeen(newestIn);
  }, [newestIn]);

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

  // Files dropped on the panel wait in the composer.
  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let lastDropAt = 0;
    const overPanel = (x: number, y: number) => {
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
        const over = overPanel(event.payload.position.x, event.payload.position.y);
        if (event.payload.type !== "drop") {
          setDragging(over);
          return;
        }
        setDragging(false);
        // WebView2 can report one drop twice.
        if (!over || Date.now() - lastDropAt < 250 || event.payload.paths.length === 0) return;
        lastDropAt = Date.now();
        const paths = event.payload.paths;
        setStaged((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
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
  }, [paired]);

  const visible = useMemo(() => items.filter((entry) => matchesShareFilter(entry, filter)), [items, filter]);
  const days = useMemo(() => shareDays(visible), [visible]);
  const pins = useMemo(() => pinnedShares(items), [items]);

  // Stay at the newest item as things arrive, like a chat.
  const newestShown = visible[0]?.id;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [newestShown, filter, awayFromShare]);

  const jumpTo = (id: string) => {
    const go = () => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-share-ids~="${CSS.escape(id)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.animate?.([{ backgroundColor: "rgb(127 127 127 / 0.18)" }, { backgroundColor: "transparent" }], {
        duration: 1200,
        easing: "ease-out",
      });
    };
    if (filter !== "all" && !visible.some((entry) => entry.id === id)) {
      setFilter("all");
      window.setTimeout(go, 50);
    } else go();
  };

  return (
    <div ref={rootRef} role="region" aria-label="Share with your phone" className="relative flex min-h-0 flex-1 flex-col">
      {/* Fork (Hari, L-337): one row: the tabs stand in for the title, then the
          filter (Share only), Settings and Close. */}
      <header className="flex h-11 shrink-0 select-none items-center gap-1 border-b border-stroke pl-2 pr-1.5">
        <SegmentedSwitch
          options={tabs}
          value={view}
          onChange={setView}
          ariaLabel="Share views"
          size="md"
        />
        <span className="min-w-0 flex-1" />
        {view === "share" ? (
          <SelectMenu
            label="Show"
            value={filter}
            options={SHARE_FILTER_OPTIONS}
            onChange={(value) => setFilter(value as ShareFilter)}
            icon={ListFilter}
            marked={filter !== "all"}
            className=""
            menuWidth={160}
          />
        ) : null}
        <button
          type="button"
          title="Settings"
          aria-label="Share settings"
          aria-pressed={view === "settings"}
          onClick={() => setView(view === "settings" ? "share" : "settings")}
          className={`${HEADER_BUTTON} ${view === "settings" ? "bg-content/10 text-content" : ""}`}
        >
          <Settings className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" title="Close Share" aria-label="Close Share" onClick={onClose} className={HEADER_BUTTON}>
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      {view === "files" ? (
        <PhoneFilesView onError={setError} />
      ) : view === "notifications" ? (
        <PhoneNotificationsView onError={setError} />
      ) : view === "settings" ? (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3">
          <section aria-label="Phone" className="space-y-2">
            <h4 className="text-[11px] font-medium text-content/40">Phone</h4>
            {paired ? (
              <PhoneStatus onError={setError} />
            ) : (
              <p className="text-[12px] text-content/55">
                Pair Hari on your phone (Settings → Mobile) to see its battery, storage and network, and to ring it.
              </p>
            )}
          </section>
          <section aria-label="Storage on this computer" className="space-y-2">
            <h4 className="text-[11px] font-medium text-content/40">Storage on this computer</h4>
            <StorageStrip busy={busy} attempt={attempt} onDone={load} />
          </section>
        </div>
      ) : (
        <>
          <PinCard pins={pins} onJump={jumpTo} />

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {list === null ? (
              loadError ? (
                <div role="alert" className="mx-auto mt-10 max-w-sm text-center text-[12.5px] text-content/60">
                  <p>Couldn't load the Share history. {loadError}</p>
                  <button type="button" onClick={load} className={`mt-3 ${SHARE_SMALL_BUTTON}`}>
                    Try again
                  </button>
                </div>
              ) : (
                <ul aria-busy="true" aria-label="Loading Share history" className="space-y-3">
                  {[0, 1, 2].map((index) => (
                    <li
                      key={index}
                      className={`h-12 w-3/5 animate-pulse rounded-2xl bg-content/[0.06] ${index === 1 ? "ml-auto" : ""}`}
                    />
                  ))}
                </ul>
              )
            ) : items.length === 0 ? (
              <div className="mx-auto mt-12 max-w-xs text-center">
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
                {filter === "saved"
                  ? "Nothing saved yet. Saved items stay when the history fills up or is deleted."
                  : `No ${SHARE_FILTERS.find((option) => option.id === filter)?.label.toLowerCase()} yet.`}
              </p>
            ) : (
              <div className="space-y-4">
                {days.map((day) => (
                  <section key={day.key} aria-label={day.label}>
                    <h3 className="mb-2 text-center text-[11px] font-medium text-content/40">{day.label}</h3>
                    <ul className="space-y-2">
                      {day.rows.map((row) => (
                        <ShareBubble key={row.key} row={row} paired={paired} onError={setError} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="shrink-0 border-t border-stroke px-3 py-2 text-[12px] text-red-400">
          {error}
        </p>
      ) : null}

      {awayFromShare ? null : list !== null && paired ? (
        <ShareComposer busy={busy} attempt={attempt} staged={staged} onStage={setStaged} />
      ) : list !== null && items.length > 0 ? (
        <p className="shrink-0 border-t border-stroke px-3 py-3 text-[12px] text-content/55">
          Pair Hari on your phone (Settings → Mobile) to send text, links, the clipboard and files both ways.
        </p>
      ) : null}

      {dragging && !awayFromShare ? (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-accent/60 bg-surface/85">
          <span className="flex items-center gap-2 text-[13px] text-content">
            <CloudUpload className="size-4" strokeWidth={1.75} aria-hidden />
            Drop to attach
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function useSharePanelOpen(): boolean {
  return useSyncExternalStore(subscribeSharePanel, readSharePanelOpen, () => false);
}

/**
 * Fork (L-290): the Share panel, mounted while open or sliding out. Docked
 * beside the chats, or over them (`overlay`) in Zen.
 */
export function SharePanel({ overlay = false }: { overlay?: boolean }): JSX.Element | null {
  const open = useSharePanelOpen();
  const [mounted, setMounted] = useState(open);
  const [width, setWidth] = useState(readSharePanelWidth);
  const windowWidth = useWindowWidth();
  // Fork (Hari, L-302): the history and its pictures load once the slide has
  // ended, and give way as it starts to close, so the slide has only the
  // chat beside it to lay out. A skeleton holds the place meanwhile.
  const [still, setStill] = useState(false);
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && rootContains(frame.current, document.activeElement)) setSharePanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open && !mounted) return null;
  // Fork (L-335): redrawn on resize, and held while minimised.
  const max = Math.max(SHARE_PANEL_MIN, Math.round(windowWidth * 0.6));
  return (
    <SlidePanel
      open={open}
      appear
      motion="unroll"
      className={overlay ? "fixed bottom-0 right-0 top-10 z-40 justify-end" : ""}
      onMoving={(moving) => setStill(!moving)}
      onGone={() => setMounted(false)}
    >
      <aside
        ref={frame}
        aria-label="Share panel"
        style={{ width: Math.min(width, max) }}
        className={`share-panel relative isolate my-2 mr-2 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-content/10 text-content ${
          overlay ? "shadow-xl" : "bg-content/[0.02]"
        }`}
      >
        {/* Fork (L-306): docked, the panel is clear over the wallpaper like the
            chats beside it; over another view it needs the frosted glass. */}
        {overlay ? <GlassBackdrop /> : null}
        <ResizeHandle
          label="Resize Share panel"
          value={width}
          min={SHARE_PANEL_MIN}
          max={max}
          defaultValue={SHARE_PANEL_DEFAULT}
          placement="inset-y-0 left-0"
          reverse
          look="line"
          onLive={(next) => {
            if (frame.current) frame.current.style.width = `${next ?? width}px`;
          }}
          onCommit={(next) => {
            setWidth(next);
            saveSharePanelWidth(next);
          }}
        />
        <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
          {still ? <ShareContent onClose={() => setSharePanelOpen(false)} width={Math.min(width, max)} /> : <ShareSkeleton />}
        </div>
      </aside>
    </SlidePanel>
  );
}

/** Holds the panel's place while it slides: the header and a few bubbles. */
function ShareSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Share with your phone" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke pl-3">
        <SmartPhone className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] font-medium text-content">Share</span>
      </div>
      <ul className="space-y-3 px-3 py-3">
        {[0, 1, 2].map((index) => (
          <li
            key={index}
            className={`h-12 w-3/5 rounded-2xl bg-content/[0.06] ${index === 1 ? "ml-auto" : ""}`}
          />
        ))}
      </ul>
    </div>
  );
}

function rootContains(root: HTMLElement | null, node: Element | null): boolean {
  return Boolean(root && node && root.contains(node));
}
