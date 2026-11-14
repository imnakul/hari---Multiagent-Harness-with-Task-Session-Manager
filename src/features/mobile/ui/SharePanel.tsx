import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { CloudUpload, Archive, Pin, SmartPhone, Trash2, X } from "../../../shared/ui/icons";
import { ResizeHandle } from "../../../shared/ui/ResizeHandle";
import { SlidePanel } from "../../../shared/ui/SlidePanel";
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
import { PhoneStatus, SHARE_SMALL_BUTTON, shareErrorMessage } from "./PhoneStatus";
import { ShareBubble } from "./ShareBubble";
import { ShareComposer } from "./ShareComposer";

/** Tauri reports physical pixels on some Windows setups; map back to CSS pixels. */
function toClientPoint(x: number, y: number): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  if (scale !== 1 && (x > window.innerWidth || y > window.innerHeight)) return { x: x / scale, y: y / scale };
  return { x, y };
}

type Storage = { historyBytes: number; filesBytes: number; files: number };

const HEADER_BUTTON =
  "grid size-7 place-items-center rounded-md text-content/55 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** Pinned items in a bar at the top; a click jumps to one and moves to the next. */
function PinBar({
  pins,
  onJump,
}: {
  pins: ReturnType<typeof pinnedShares>;
  onJump: (id: string) => void;
}): JSX.Element | null {
  const [index, setIndex] = useState(0);
  if (!pins.length) return null;
  const current = pins[Math.min(index, pins.length - 1)];
  if (!current) return null;
  const label =
    current.kind === "file" ? (current.name ?? "File") : (current.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  return (
    <button
      type="button"
      title={pins.length > 1 ? "Jump to this pin; click again for the next" : "Jump to the pinned message"}
      onClick={() => {
        onJump(current.id);
        setIndex((value) => (value + 1) % pins.length);
      }}
      className="flex min-w-0 shrink-0 items-center gap-2 border-b border-stroke px-3 py-1.5 text-left text-[12px] hover:bg-content/[0.04]"
    >
      <span className="flex shrink-0 flex-col gap-0.5" aria-hidden>
        {pins.slice(0, 4).map((pin, at) => (
          <span
            key={pin.id}
            className={`h-1.5 w-0.5 rounded-full ${at === index % Math.min(pins.length, 4) ? "bg-accent" : "bg-content/25"}`}
          />
        ))}
      </span>
      <Pin className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-content/80">{label}</span>
      {pins.length > 1 ? (
        <span className="shrink-0 tabular-nums text-content/40">
          {(index % pins.length) + 1}/{pins.length}
        </span>
      ) : null}
    </button>
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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke bg-content/[0.02] px-3 py-2 text-[12px] text-content/65">
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
function ShareContent({ onClose }: { onClose: () => void }): JSX.Element {
  const [list, setList] = useState<ShareList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShareFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<string[]>([]);
  const [storageOpen, setStorageOpen] = useState(false);
  const [phoneFiles, setPhoneFiles] = useState(false);
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
  }, [newestShown, filter, phoneFiles]);

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
      <header className="flex h-10 shrink-0 select-none items-center gap-1 border-b border-stroke pl-3 pr-1.5">
        <SmartPhone className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-content">
          {phoneFiles ? "Phone files" : "Share"}
        </h3>
        {paired ? (
          <button
            type="button"
            title={phoneFiles ? "Back to Share" : "Browse the phone's files"}
            aria-pressed={phoneFiles}
            onClick={() => setPhoneFiles((value) => !value)}
            className={`${HEADER_BUTTON} ${phoneFiles ? "bg-content/10 text-content" : ""}`}
          >
            <SmartPhone className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
        {!phoneFiles ? (
          <button
            type="button"
            title="Storage and Delete all"
            aria-pressed={storageOpen}
            onClick={() => setStorageOpen((value) => !value)}
            className={`${HEADER_BUTTON} ${storageOpen ? "bg-content/10 text-content" : ""}`}
          >
            <Archive className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
        <button type="button" title="Close Share" aria-label="Close Share" onClick={onClose} className={HEADER_BUTTON}>
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      {phoneFiles ? (
        <PhoneFilesView onError={setError} />
      ) : (
        <>
          {storageOpen ? <StorageStrip busy={busy} attempt={attempt} onDone={load} /> : null}
          <div className="flex shrink-0 flex-col gap-2 border-b border-stroke px-3 py-2">
            {paired ? <PhoneStatus onError={setError} /> : null}
            <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-1">
              {SHARE_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={`h-6 rounded-full px-2.5 text-[11.5px] transition-[background-color,color,transform] duration-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 ${
                    filter === option.id
                      ? "bg-content/[0.12] text-content"
                      : "text-content/55 hover:bg-content/[0.07] hover:text-content"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <PinBar pins={pins} onJump={jumpTo} />

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

      {phoneFiles ? null : list !== null && paired ? (
        <ShareComposer busy={busy} attempt={attempt} staged={staged} onStage={setStaged} />
      ) : list !== null && items.length > 0 ? (
        <p className="shrink-0 border-t border-stroke px-3 py-3 text-[12px] text-content/55">
          Pair Hari on your phone (Settings → Mobile) to send text, links, the clipboard and files both ways.
        </p>
      ) : null}

      {dragging && !phoneFiles ? (
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
  const max = Math.max(SHARE_PANEL_MIN, Math.round(window.innerWidth * 0.6));
  return (
    <SlidePanel
      open={open}
      appear
      className={overlay ? "fixed bottom-0 right-0 top-10 z-40 justify-end" : ""}
      onGone={() => setMounted(false)}
    >
      <aside
        ref={frame}
        aria-label="Share panel"
        style={{ width: Math.min(width, max) }}
        className="relative my-2 mr-2 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-content/10 bg-surface text-content shadow-xl"
      >
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
        <ShareContent onClose={() => setSharePanelOpen(false)} />
      </aside>
    </SlidePanel>
  );
}

function rootContains(root: HTMLElement | null, node: Element | null): boolean {
  return Boolean(root && node && root.contains(node));
}
