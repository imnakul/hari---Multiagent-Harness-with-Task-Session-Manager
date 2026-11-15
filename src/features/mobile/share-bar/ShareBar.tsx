import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Check, CloudUpload, SmartPhone, X } from "../../../shared/ui/icons";
import { parseShareList, SHARE_CHANGE_EVENT, type ShareList } from "../model/mobileShare";
import { SHARE_BAR_SHOWN_EVENT } from "../model/shareBar";
import { shareErrorMessage } from "../ui/PhoneStatus";
import { ShareComposer } from "../ui/ShareComposer";

/** How long "Sent" stays next to the title. */
const SENT_FOR_MS = 2200;
/** WebView2 can report one drop twice. */
const DROP_REPEAT_MS = 250;

const newestOutId = (list: ShareList | null): string | null =>
  list?.items.find((entry) => entry.direction === "out")?.id ?? null;

/**
 * Fork (L-320): the floating Share bar. Share's own composer in a small
 * always-on-top glass window: type or paste text, a link or a picture, or
 * drop files anywhere on it, and Send. It stays open after sending; the × or
 * the shortcut (Ctrl+Alt+H by default) puts it away.
 */
export function ShareBar({ onShown }: { onShown: () => void }): JSX.Element {
  const [list, setList] = useState<ShareList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastOut = useRef<string | null | undefined>(undefined);
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;

  const load = useCallback(() => {
    invoke<unknown>("mobile_share_list")
      .then((raw) => {
        const next = parseShareList(raw);
        const out = newestOutId(next);
        // A new outgoing item since the last look means a send went through.
        if (lastOut.current !== undefined && out !== null && out !== lastOut.current) setSentAt(Date.now());
        lastOut.current = out;
        setList(next);
        setLoadError(null);
      })
      .catch((reason: unknown) => setLoadError(shareErrorMessage(reason)));
  }, []);

  useEffect(() => {
    load();
    const changes = listen(SHARE_CHANGE_EVENT, load);
    const shown = listen(SHARE_BAR_SHOWN_EVENT, () => {
      onShownRef.current();
      load();
      setError(null);
      rootRef.current?.querySelector("textarea")?.focus();
    });
    return () => {
      void changes.then((unlisten) => unlisten());
      void shown.then((unlisten) => unlisten());
    };
  }, [load]);

  useEffect(() => {
    if (!sentAt) return;
    const timer = window.setTimeout(() => setSentAt(0), SENT_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [sentAt]);

  const paired = (list?.phones ?? 0) > 0;

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

  // The whole window is the drop target; files wait in the composer.
  useEffect(() => {
    if (!paired) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let lastDropAt = 0;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (event.payload.type !== "drop") {
          setDragging(true);
          return;
        }
        setDragging(false);
        if (Date.now() - lastDropAt < DROP_REPEAT_MS || event.payload.paths.length === 0) return;
        lastDropAt = Date.now();
        const paths = event.payload.paths;
        setStaged((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((reason: unknown) => console.warn("Share bar: could not watch for dropped files", reason));
    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, [paired]);

  const close = (): void => {
    void invoke("share_bar_hide").catch((reason: unknown) => setError(shareErrorMessage(reason)));
  };

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Share to your phone"
      className="quick-composer-surface relative flex h-full flex-col overflow-clip rounded-[16px] border border-content/10 text-content"
    >
      <header
        title="Drag to move"
        onMouseDown={(event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
          event.preventDefault();
          void getCurrentWindow()
            .startDragging()
            .catch(() => undefined);
        }}
        className="flex h-9 shrink-0 cursor-grab select-none items-center gap-2 pl-3.5 pr-1.5 active:cursor-grabbing"
      >
        <SmartPhone className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
        <h1 className="min-w-0 flex-1 truncate text-[12px] font-medium text-content/60">Share to phone</h1>
        <span
          role="status"
          className={`flex items-center gap-1 text-[11.5px] text-accent transition-opacity duration-200 ${sentAt ? "opacity-100" : "opacity-0"}`}
        >
          {sentAt ? (
            <>
              <Check className="size-3.5" strokeWidth={2} aria-hidden />
              Sent
            </>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="Close the Share bar"
          title="Close (or press the shortcut again)"
          onClick={close}
          className="grid size-7 shrink-0 place-items-center rounded-md text-content/40 transition-[background-color,color,transform] duration-100 hover:bg-selection-hover hover:text-content active:scale-[0.96]"
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-end">
        {list === null ? (
          loadError ? (
            <p role="alert" className="px-4 pb-4 text-[12px] text-red-400">
              {loadError}
            </p>
          ) : (
            <div aria-busy="true" aria-label="Loading" className="mx-2.5 mb-2.5 h-20 animate-pulse rounded-lg bg-content/5" />
          )
        ) : paired ? (
          <>
            {error ? (
              <p role="alert" className="truncate px-3.5 pb-1 text-[12px] text-red-400" title={error}>
                {error}
              </p>
            ) : null}
            <ShareComposer busy={busy} attempt={attempt} staged={staged} onStage={setStaged} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 pb-4 text-center">
            <p className="text-[13px] font-medium text-content">Pair Hari first</p>
            <p className="text-[12px] text-content/45">In MonoCode, open Settings → Connections and pair your phone.</p>
          </div>
        )}
      </div>
      {dragging && paired ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[16px] border border-dashed border-accent/60 bg-background-base/85 text-[13px] text-accent">
          <span className="flex items-center gap-2">
            <CloudUpload className="size-4" strokeWidth={1.75} aria-hidden />
            Drop to add
          </span>
        </div>
      ) : null}
    </div>
  );
}
