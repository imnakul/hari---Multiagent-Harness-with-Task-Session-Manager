import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  LoaderCircle,
  RefreshCw,
} from "../../../shared/ui/icons";
import { UI_SCALE_CHANGE_EVENT } from "../../settings/model/uiScale";
import {
  addressFromInput,
  loadLastBrowserUrl,
  overlapsPage,
  saveLastBrowserUrl,
  type BrowserRequest,
} from "../model/browserRequest";

type BrowserStatePayload = {
  url?: string | null;
  title?: string | null;
  loading?: boolean | null;
};

/**
 * The page lives in a native view that outlasts this component in the
 * classic layout (leaving the Browser hides it), so what it shows is kept
 * here for the next mount.
 */
const page = {
  open: false,
  url: "",
  title: "",
  lastRequestId: 0,
};

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-content/60 transition-[background-color,color,transform] duration-100 ease-out hover:bg-content/10 hover:text-content active:scale-96 disabled:pointer-events-none disabled:opacity-35";

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={ICON_BUTTON}
    >
      {children}
    </button>
  );
}

/** Layers MonoCode draws outside the app root: menus, dialogs, toasts. */
function coveringLayer(pageRect: DOMRect): boolean {
  const visit = (element: Element, depth: number): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    // A pass-through container (a toast region, say) only covers the page
    // where something inside it does.
    if (style.pointerEvents !== "none") {
      if (overlapsPage(pageRect, element.getBoundingClientRect())) return true;
      return false;
    }
    if (depth >= 3) return false;
    for (const child of Array.from(element.children)) {
      if (visit(child, depth + 1)) return true;
    }
    return false;
  };
  for (const child of Array.from(document.body.children)) {
    if (child.id === "root" || child.id === "boot-splash") continue;
    if (/^(SCRIPT|STYLE|TEMPLATE|LINK|NOSCRIPT)$/.test(child.tagName)) continue;
    if (visit(child, 0)) return true;
  }
  return false;
}

function physicalBounds(rect: DOMRect) {
  const ratio = window.devicePixelRatio || 1;
  return {
    x: rect.left * ratio,
    y: rect.top * ratio,
    width: rect.width * ratio,
    height: rect.height * ratio,
  };
}

/** Fork (L-203): a web page inside MonoCode, with its own address bar. */
export function BrowserView({
  active,
  request,
  tabbed = false,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
}: {
  active: boolean;
  request: BrowserRequest | null;
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
}) {
  const pageBox = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(page.open);
  const [url, setUrl] = useState(page.url);
  const [title, setTitle] = useState(page.title);
  const [address, setAddress] = useState(page.url);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const bounds = useCallback(() => {
    const rect = pageBox.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }, []);

  const go = useCallback(
    async (target: string) => {
      const rect = bounds();
      if (!rect) return;
      setError(null);
      setAddress(target);
      setUrl(target);
      page.url = target;
      setLoading(true);
      try {
        await invoke("browser_open", { url: target, bounds: physicalBounds(rect) });
        page.open = true;
        setOpen(true);
        saveLastBrowserUrl(target);
      } catch (cause) {
        setLoading(false);
        setError(String(cause));
      }
    },
    [bounds],
  );

  // Page events from the native view.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<BrowserStatePayload>("browser://state", ({ payload }) => {
      if (typeof payload.url === "string") {
        page.url = payload.url;
        setUrl(payload.url);
        if (!editingRef.current) setAddress(payload.url);
        saveLastBrowserUrl(payload.url);
      }
      if (typeof payload.title === "string") {
        page.title = payload.title;
        setTitle(payload.title);
      }
      if (typeof payload.loading === "boolean") setLoading(payload.loading);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // A page asked for from a link, or the last page on first open.
  useEffect(() => {
    if (!active) return;
    if (request && request.id !== page.lastRequestId) {
      page.lastRequestId = request.id;
      void go(request.url);
      return;
    }
    if (!page.open) {
      const last = loadLastBrowserUrl();
      if (last) void go(last);
      else addressRef.current?.focus();
    }
  }, [active, request, go]);

  // Keep the native view on the page area, and out of the way of
  // MonoCode's own menus and dialogs, which it would otherwise paint over.
  useEffect(() => {
    if (!open) return;
    let last = "";
    let shown: boolean | null = null;
    const sync = () => {
      const rect = active ? bounds() : null;
      const visible = Boolean(rect) && !document.hidden && !coveringLayer(rect!);
      if (visible && rect) {
        const next = physicalBounds(rect);
        const key = `${next.x},${next.y},${next.width},${next.height}`;
        if (key !== last) {
          last = key;
          void invoke("browser_set_bounds", { bounds: next }).catch(() => {});
        }
      }
      if (visible !== shown) {
        shown = visible;
        void invoke("browser_set_visible", { visible }).catch(() => {});
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    if (pageBox.current) observer.observe(pageBox.current);
    window.addEventListener("resize", sync);
    window.addEventListener(UI_SCALE_CHANGE_EVENT, sync);
    document.addEventListener("visibilitychange", sync);
    // Moves without a resize (a panel opening beside) and menus opening.
    const timer = window.setInterval(sync, 120);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener(UI_SCALE_CHANGE_EVENT, sync);
      document.removeEventListener("visibilitychange", sync);
      window.clearInterval(timer);
      void invoke("browser_set_visible", { visible: false }).catch(() => {});
    };
  }, [open, active, bounds]);

  // Closing the Browser tab (inset layout) frees the page; leaving it in the
  // classic layout only hides it.
  useEffect(
    () => () => {
      if (!tabbed) return;
      page.open = false;
      void invoke("browser_close").catch(() => {});
    },
    [tabbed],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = addressFromInput(address);
    if (!target) return;
    setEditing(false);
    addressRef.current?.blur();
    void go(target);
  };

  const history = (action: "back" | "forward" | "reload") => {
    void invoke("browser_history", { action }).catch((cause) =>
      setError(String(cause)),
    );
  };

  const toolbar = (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 px-2">
      <ToolButton label="Back" disabled={!open} onClick={() => history("back")}>
        <ChevronLeft aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Forward" disabled={!open} onClick={() => history("forward")}>
        <ChevronRight aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Reload" disabled={!open} onClick={() => history("reload")}>
        <RefreshCw aria-hidden className="size-3.5" />
      </ToolButton>
      <form onSubmit={submit} className="mx-1 flex min-w-0 flex-1">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2 focus-within:border-accent/60">
          {loading ? (
            <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-content/45" />
          ) : (
            <Globe aria-hidden className="size-3.5 shrink-0 text-content/45" />
          )}
          <span className="sr-only">Address</span>
          <input
            ref={addressRef}
            value={address}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search or type an address"
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditing(true);
              event.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setAddress(url);
              event.currentTarget.blur();
            }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
          />
        </label>
      </form>
      <ToolButton
        label="Open in default browser"
        disabled={!url}
        onClick={() => void openUrl(url).catch((cause) => setError(String(cause)))}
      >
        <ExternalLink aria-hidden className="size-3.5" />
      </ToolButton>
    </div>
  );

  return (
    <section
      role="region"
      aria-label="Browser"
      data-app-browser
      className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col bg-surface text-content"
    >
      {tabbed ? (
        <div className="flex h-10 shrink-0 items-center border-b border-stroke">{toolbar}</div>
      ) : (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
          {toolbar}
          {IS_MAC ? null : <WindowControls />}
        </div>
      )}
      {error ? (
        <p role="alert" className="shrink-0 border-b border-stroke px-4 py-1.5 text-[12px] text-red-300/90">
          {error}
        </p>
      ) : null}
      <div ref={pageBox} className="relative min-h-0 min-w-0 flex-1" title={title || undefined}>
        {open ? null : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Globe aria-hidden className="size-6 text-content/30" />
            <p className="text-[13px] text-content/70">Search or type an address above.</p>
            <p className="max-w-sm text-[12px] text-content/45">
              Right-click a link in a chat and pick Open in MonoCode to load it here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
