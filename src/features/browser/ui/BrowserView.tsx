import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Code,
  Copy,
  ExternalLink,
  Globe,
  Image,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  SelectAll,
  Star,
  Target,
  Terminal,
  X,
  ZoomIn,
  ZoomOut,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { deliverKeptAttachments } from "../../sessions/model/attachToChat";
import { UI_SCALE_CHANGE_EVENT } from "../../settings/model/uiScale";
import { openInBackgroundTab } from "../model/backgroundTabs";
import { removeBookmark, tabLinksText, toggleBookmark, useBookmarks } from "../model/browserBookmarks";
import { shortUrl } from "../model/browserContext";
import { menuPoint, type BrowserContextTarget } from "../model/browserMenu";
import { addressFromInput, overlapsPage } from "../model/browserRequest";
import {
  BUILT_IN_SIZES,
  DEVICE_GAP,
  DEVICE_RIM,
  fitScale,
  newCustomSize,
  sameSize,
  sizeLabel,
} from "../model/browserSizes";
import {
  activeTab,
  applyZoom,
  attachScreenshot,
  browserStore,
  closeAllPages,
  closeTab,
  dismissDownload,
  dismissNotice,
  loadRecents,
  markOpened,
  navigateTab,
  newTab,
  selectTab,
  setFit,
  addCustomSize,
  removeCustomSize,
  setPageSize,
  setPicking,
  showNotice,
  takePending,
  markShowing,
  useBrowserStore,
  type BrowserTab,
} from "../model/browserTabs";
import { BrowserContextMenu } from "./BrowserContextMenu";
import { BrowserDevtools } from "./BrowserDevtools";

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-content/60 transition-[background-color,color,transform] duration-100 ease-out hover:bg-content/10 hover:text-content active:scale-96 disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-accent/15 aria-pressed:text-accent";

function ToolButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      className={ICON_BUTTON}
    >
      {children}
    </button>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-content/85 hover:bg-content/10 disabled:opacity-40";

const SIZE_BUTTON =
  "rounded-md px-2 py-1 text-left text-[12px] text-content/75 hover:bg-content/10 aria-pressed:bg-accent/15 aria-pressed:text-accent";

const SIZE_INPUT =
  "rounded-md border border-stroke bg-content/[0.04] px-2 py-1 text-[12px] text-content outline-none placeholder:text-content/35 focus:border-accent/60";

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

/** Browser views (tab and side panel) showing their page as a picture now. */
let pausedPages = 0;

/** A quick picture of the visible page as a data URL, or null after ~300 ms. */
async function capturePage(tab: number): Promise<string | null> {
  const timeout = new Promise<null>((done) => window.setTimeout(() => done(null), 300));
  const shot = invoke<string>("browser_screenshot", { tab, clip: null, quick: true })
    .then((data) => `data:image/jpeg;base64,${data}`)
    .catch(() => null);
  return Promise.race([shot, timeout]);
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

function tabLabel(tab: BrowserTab): string {
  if (tab.title) return tab.title;
  if (tab.url || tab.pending) return shortUrl(tab.url || tab.pending || "", 40);
  return "New tab";
}

type Suggestion = { url: string; label: string; detail: string; bookmark?: boolean };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Fork (L-203, L-207): web pages inside MonoCode, as a full view tab or a
 * side panel beside the chat. Several tabs, page tools (pick and comment,
 * screenshots, console and network) and size presets.
 */
export function BrowserView({
  active,
  panel = false,
  tabbed = false,
  besideRail = false,
  compactRail = false,
  still = false,
  onStill,
  onClose,
  onToggleSidebar,
}: {
  active: boolean;
  /** Shown beside a chat rather than as its own view. */
  panel?: boolean;
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  /** The panel is sliding: show the page as a still picture (L-219). */
  still?: boolean;
  /** Called once the page is still (or within ~150 ms) after `still` turns on. */
  onStill?: () => void;
  onClose: () => void;
  onToggleSidebar?: () => void;
}) {
  const store = useBrowserStore();
  const customSizes = store.customSizes;
  const tab = activeTab(store);
  const frame = useRef<HTMLDivElement>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const addressBox = useRef<HTMLLabelElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const shotButton = useRef<HTMLButtonElement>(null);
  const bookmarksButton = useRef<HTMLButtonElement>(null);
  const [address, setAddress] = useState(tab.url);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"more" | "shot" | "bookmarks" | null>(null);
  // Fork (L-226): bookmarks, and whether the shown page is one.
  const bookmarks = useBookmarks();
  const saved = !!tab.url && bookmarks.some((item) => item.url === tab.url);
  // The New size form starts closed each time the More menu opens.
  useEffect(() => {
    if (menu !== "more") setSizeForm(null);
  }, [menu]);
  const [devtools, setDevtools] = useState(false);
  const [servers, setServers] = useState<{ port: number; name: string }[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [sizeForm, setSizeForm] = useState<{ name: string; width: string; height: string; error?: string } | null>(null);
  const opening = useRef(new Set<number>());

  // The address bar follows the page unless the user is typing.
  useEffect(() => {
    if (!editing) setAddress(tab.url || tab.pending || "");
  }, [tab.id, tab.url, tab.pending, editing]);

  const bounds = useCallback(() => {
    const rect = pageBox.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }, []);

  const go = useCallback(
    async (id: number, target: string) => {
      const rect = bounds();
      if (!rect || opening.current.has(id)) return;
      opening.current.add(id);
      try {
        await invoke("browser_open", { tab: id, url: target, bounds: physicalBounds(rect) });
        markOpened(id);
        const current = browserStore().tabs.find((item) => item.id === id);
        if (current && current.zoom * current.fit !== 1) applyZoom({ ...current, opened: true });
      } catch (cause) {
        showNotice(String(cause), "error");
      } finally {
        opening.current.delete(id);
      }
    },
    [bounds],
  );

  // Load what the shown tab needs: an asked-for page, the page it had
  // before a restart, or just bring its existing page forward.
  useEffect(() => {
    if (!active) return;
    if (tab.pending) {
      const url = takePending(tab.id);
      if (url) void go(tab.id, url);
      return;
    }
    if (tab.opened) {
      void invoke<boolean>("browser_select", { tab: tab.id })
        .then((exists) => {
          if (!exists && tab.url) void go(tab.id, tab.url);
        })
        .catch(() => {});
      return;
    }
    if (tab.url) void go(tab.id, tab.url);
    else addressRef.current?.focus();
  }, [active, tab.id, tab.pending, tab.opened, tab.url, go]);

  // Tabs opened in the background load out of sight while this view shows
  // (L-224); the page stays asleep until its tab is picked.
  const waiting = store.tabs
    .filter((item) => item.id !== tab.id && item.pending)
    .map((item) => item.id)
    .join(",");
  useEffect(() => {
    if (!active) return;
    return markShowing();
  }, [active]);
  useEffect(() => {
    if (!active || !waiting) return;
    const rect = bounds();
    if (!rect) return;
    for (const item of browserStore().tabs) {
      if (item.id === tab.id || !item.pending) continue;
      const url = takePending(item.id);
      if (!url) continue;
      invoke("browser_preload", { tab: item.id, url, bounds: physicalBounds(rect) })
        .then(() => markOpened(item.id))
        .catch((cause: unknown) => showNotice(String(cause), "error"));
    }
  }, [active, waiting, tab.id, bounds]);

  // Keep the native view on the page area. MonoCode's own menus, dialogs
  // and toasts would sit under it, so while one overlaps the page, the page
  // shows as a still picture and the native view hides (L-214).
  const shownId = tab.opened ? tab.id : null;
  const [frozen, setFrozenState] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    { target: BrowserContextTarget; x: number; y: number } | null
  >(null);
  // Menus and toasts turn nearly solid while the page is a picture (L-222).
  const paused = Boolean(frozen);
  useEffect(() => {
    if (!paused) return;
    pausedPages += 1;
    document.documentElement.classList.add("browser-page-paused");
    return () => {
      pausedPages -= 1;
      if (!pausedPages) document.documentElement.classList.remove("browser-page-paused");
    };
  }, [paused]);
  const view = useRef({
    shown: null as boolean | null,
    /** Bumped to cancel a picture still being taken. */
    capture: 0,
    pending: false,
    /** The user clicked the picture: live page even though covered. */
    liveAnyway: false,
    /** The right-click menu is open. */
    hold: false,
    /** The side panel is sliding (L-219). */
    still,
    frozen: null as string | null,
    freeze: null as (() => Promise<void>) | null,
    /** Hide the page now, dropping a picture still being taken. */
    hide: null as (() => void) | null,
    sync: null as (() => void) | null,
  });
  useEffect(() => {
    if (!active || shownId == null) return;
    const state = view.current;
    state.shown = null;
    state.pending = false;
    state.liveAnyway = false;
    let last = "";
    let unfreeze = 0;
    const setFrozen = (image: string | null) => {
      state.frozen = image;
      setFrozenState(image);
    };
    const showPage = (visible: boolean) => {
      if (state.shown === visible) return;
      state.shown = visible;
      void invoke("browser_set_visible", { visible }).catch(() => {});
    };
    // Picture first, hide second, so the swap does not flash.
    const freeze = async () => {
      window.clearTimeout(unfreeze);
      unfreeze = 0;
      if (state.shown !== true) {
        showPage(false);
        return;
      }
      const token = ++state.capture;
      state.pending = true;
      const image = await capturePage(shownId);
      if (token !== state.capture) return;
      state.pending = false;
      if (image) {
        setFrozen(image);
        await new Promise((done) => requestAnimationFrame(done));
        if (token !== state.capture) return;
      }
      showPage(false);
    };
    state.freeze = freeze;
    state.hide = () => {
      state.capture += 1;
      state.pending = false;
      showPage(false);
    };
    const sync = () => {
      const rect = bounds();
      const covered = rect ? coveringLayer(rect) : false;
      if (!covered) state.liveAnyway = false;
      const live =
        Boolean(rect) &&
        !document.hidden &&
        !state.hold &&
        !state.still &&
        (!covered || state.liveAnyway);
      if (live && rect) {
        const next = physicalBounds(rect);
        const key = `${next.x},${next.y},${next.width},${next.height}`;
        if (key !== last) {
          last = key;
          void invoke("browser_set_bounds", { bounds: next }).catch(() => {});
        }
        if (state.pending) {
          state.capture += 1;
          state.pending = false;
        }
        showPage(true);
        // Drop the picture once the live page has painted over it.
        if (state.frozen && !unfreeze) {
          unfreeze = window.setTimeout(() => {
            unfreeze = 0;
            setFrozen(null);
          }, 80);
        }
      } else if (rect && !document.hidden && state.shown === true) {
        if (!state.pending) void freeze();
      } else if (!state.pending) {
        showPage(false);
      }
    };
    state.sync = sync;
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
      window.clearTimeout(unfreeze);
      state.capture += 1;
      state.pending = false;
      state.freeze = null;
      state.hide = null;
      state.sync = null;
      setFrozen(null);
      void invoke("browser_set_visible", { visible: false }).catch(() => {});
    };
  }, [active, shownId, bounds]);

  // The side panel sliding in or out: the page waits as a picture, since the
  // native view cannot follow the slide frame by frame (L-219). A slow picture
  // gives way after ~150 ms so the slide never waits long.
  const onStillRef = useRef(onStill);
  onStillRef.current = onStill;
  useEffect(() => {
    const state = view.current;
    state.still = still;
    if (!still) {
      state.sync?.();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onStillRef.current?.();
    };
    const cap = window.setTimeout(() => {
      state.hide?.();
      finish();
    }, 150);
    void (state.freeze?.() ?? Promise.resolve()).then(finish);
    return () => window.clearTimeout(cap);
  }, [still]);

  // Right-click on the page: freeze it, then open MonoCode's menu where the
  // click was (L-215).
  useEffect(() => {
    if (!active || shownId == null) return;
    let alive = true;
    const unlisten = listen<BrowserContextTarget>("browser://context-menu", (event) => {
      const target = event.payload;
      const box = pageBox.current?.getBoundingClientRect();
      if (target.tab !== shownId || !box) return;
      const state = view.current;
      state.hold = true;
      void (state.freeze?.() ?? Promise.resolve()).then(() => {
        if (!alive) return;
        setContextMenu({ target, ...menuPoint(target, box, window.devicePixelRatio || 1) });
      });
    });
    return () => {
      alive = false;
      view.current.hold = false;
      setContextMenu(null);
      void unlisten.then((stop) => stop());
    };
  }, [active, shownId]);

  const closeContextMenu = useCallback(() => {
    view.current.hold = false;
    setContextMenu(null);
  }, []);

  // The space the page can use, for size presets.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setFrameSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  // A size larger than the space shrinks the page to fit (both sides), so a
  // laptop layout still shows whole in a narrow panel. The gap and the glass
  // rim around a fixed size come out of the space first (L-222).
  const around = 2 * (DEVICE_GAP + DEVICE_RIM);
  const fit = fitScale(tab.size, {
    width: frameSize.width - around,
    height: frameSize.height - around,
  });
  const boxStyle = tab.size
    ? {
        flex: "none",
        width: Math.floor(tab.size.width * fit),
        height: tab.size.height ? Math.floor(tab.size.height * fit) : undefined,
      }
    : undefined;
  useEffect(() => {
    if (!active || Math.abs(tab.fit - fit) < 0.005) return;
    setFit(tab.id, fit);
    if (tab.opened) applyZoom({ ...tab, fit });
  }, [active, fit, tab]);

  // Leaving the Browser: a full view hid the chat, so attachments made
  // meanwhile go in now that it is back.
  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(deliverKeptAttachments, 150);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Closing the Browser tab (inset layout) frees the pages unless the side
  // panel still shows them; leaving it in the classic layout only hides it.
  useEffect(
    () => () => {
      window.setTimeout(deliverKeptAttachments, 150);
      if (!tabbed || panel || browserStore().panelOpen) return;
      closeAllPages();
    },
    [tabbed, panel],
  );

  const recents = useMemo(() => (editing ? loadRecents() : []), [editing]);
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!editing) return [];
    const query = address.trim().toLowerCase();
    const typed = query && query !== (tab.url || "").toLowerCase();
    const local: Suggestion[] = servers.map((server) => ({
      url: `http://localhost:${server.port}/`,
      label: `localhost:${server.port}`,
      detail: `Running · ${server.name}`,
    }));
    const marked: Suggestion[] = bookmarks.map((item) => ({
      url: item.url,
      label: item.title || shortUrl(item.url, 80),
      detail: shortUrl(item.url, 80),
      bookmark: true,
    }));
    const pages: Suggestion[] = recents.map((item) => ({
      url: item.url,
      label: item.title || shortUrl(item.url, 80),
      detail: shortUrl(item.url, 80),
    }));
    const all = [...marked, ...local, ...pages].filter(
      (item, index, list) => list.findIndex((other) => other.url === item.url) === index,
    );
    const matches = typed
      ? all.filter((item) => `${item.url} ${item.label}`.toLowerCase().includes(query))
      : all;
    return matches.slice(0, 8);
  }, [editing, address, servers, recents, bookmarks, tab.url]);

  const loadServers = () => {
    void invoke<{ port: number; name: string }[]>("browser_local_servers")
      .then(setServers)
      .catch(() => setServers([]));
  };

  const openAddress = (target: string) => {
    setEditing(false);
    setHighlight(-1);
    addressRef.current?.blur();
    navigateTab(tab.id, target);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const picked = suggestions[highlight];
    const target = picked ? picked.url : addressFromInput(address);
    if (target) openAddress(target);
  };

  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setAddress(tab.url);
      event.currentTarget.blur();
    } else if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setHighlight((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setHighlight((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    }
  };

  const history = (action: "back" | "forward" | "reload" | "hardReload") => {
    void invoke("browser_history", { tab: tab.id, action }).catch((cause) =>
      showNotice(String(cause), "error"),
    );
  };

  const zoomBy = (step: number) => applyZoom(tab, step === 0 ? 1 : tab.zoom + step);

  // Ctrl/Cmd +, − and 0 while focus is in the toolbar; inside the page the
  // webview handles the same keys itself.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const mod = IS_MAC ? event.metaKey : event.ctrlKey;
    if (!mod || !tab.opened) return;
    if (event.key === "=" || event.key === "+") zoomBy(0.1);
    else if (event.key === "-") zoomBy(-0.1);
    else if (event.key === "0") zoomBy(0);
    else if (event.shiftKey && event.key.toLowerCase() === "r") history("hardReload");
    else if (!event.shiftKey && event.key.toLowerCase() === "d") toggleSaved();
    else return;
    event.preventDefault();
  };

  const copyAddress = () => {
    void navigator.clipboard
      .writeText(tab.url)
      .then(() => showNotice("Address copied"))
      .catch(() => showNotice("Couldn't copy the address", "error"));
  };

  const toggleSaved = () => {
    if (!tab.url) return;
    const added = toggleBookmark(tab.url, tab.title);
    showNotice(added ? "Bookmark added" : "Bookmark removed");
  };

  const copyTabLinks = () => {
    const text = tabLinksText(store.tabs);
    const count = text ? text.split("\n").length : 0;
    void navigator.clipboard
      .writeText(text)
      .then(() => showNotice(count === 1 ? "Copied 1 tab link" : `Copied ${count} tab links`))
      .catch(() => showNotice("Couldn't copy the tab links", "error"));
  };

  const togglePick = () => setPicking(tab.id, tab.picking === "element" ? null : "element");

  const tabStrip = (
    <div role="tablist" aria-label="Browser tabs" className="flex h-8 min-w-0 shrink-0 items-end gap-0.5 overflow-x-auto px-1.5 pt-1 [scrollbar-width:none]">
      {store.tabs.map((item) => {
        const selected = item.id === tab.id;
        return (
          <div
            key={item.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={item.url || undefined}
            onClick={() => selectTab(item.id)}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(item.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") selectTab(item.id);
            }}
            className={`group flex h-7 min-w-0 max-w-48 flex-1 basis-32 cursor-default items-center gap-1.5 rounded-t-md pl-2 pr-1 text-[12px] transition-colors duration-100 ${
              selected ? "bg-content/10 text-content" : "text-content/55 hover:bg-content/5 hover:text-content/80"
            }`}
          >
            {item.loading ? (
              <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin text-content/45" />
            ) : (
              <Globe aria-hidden className="size-3 shrink-0 text-content/40" />
            )}
            <span className="min-w-0 flex-1 truncate">{tabLabel(item)}</span>
            <button
              type="button"
              aria-label={`Close ${tabLabel(item)}`}
              title="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(item.id);
              }}
              className={`grid size-4 shrink-0 place-items-center rounded text-content/45 hover:bg-content/15 hover:text-content ${
                selected ? "" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={() => {
          newTab();
          window.setTimeout(() => addressRef.current?.focus(), 0);
        }}
        className="mb-0.5 grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
      {panel ? (
        <button
          type="button"
          aria-label="Close Browser panel"
          title="Close Browser panel"
          onClick={onClose}
          className="mb-0.5 ml-auto grid size-6 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );

  const toolbar = (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 px-2">
      <ToolButton label="Back" disabled={!tab.opened} onClick={() => history("back")}>
        <ChevronLeft aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Forward" disabled={!tab.opened} onClick={() => history("forward")}>
        <ChevronRight aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Reload (Shift-click to skip the cache)"
        disabled={!tab.opened}
        onClick={(event) => history(event.shiftKey ? "hardReload" : "reload")}
      >
        <RefreshCw aria-hidden className="size-3.5" />
      </ToolButton>
      <form onSubmit={submit} className="mx-1 flex min-w-0 flex-1">
        <label
          ref={addressBox}
          data-browser-address
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2 focus-within:border-accent/60"
        >
          {tab.loading ? (
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
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="browser-suggestions"
            placeholder="Search or type an address"
            onChange={(event) => {
              setAddress(event.target.value);
              setHighlight(-1);
            }}
            onFocus={(event) => {
              setEditing(true);
              loadServers();
              event.currentTarget.select();
            }}
            onBlur={() => window.setTimeout(() => setEditing(false), 120)}
            onKeyDown={onAddressKey}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
          />
          {tab.url && !editing ? (
            <button
              type="button"
              aria-label={saved ? "Remove bookmark" : "Bookmark this page"}
              title={saved ? "Remove bookmark (Ctrl+D)" : "Bookmark this page (Ctrl+D)"}
              aria-pressed={saved}
              onClick={toggleSaved}
              className="grid size-5 shrink-0 place-items-center rounded text-content/40 transition-colors duration-100 hover:bg-content/10 hover:text-content aria-pressed:text-accent"
            >
              <Star aria-hidden className={`size-3.5 ${saved ? "fill-current" : ""}`} />
            </button>
          ) : null}
          {tab.zoom !== 1 ? (
            <button
              type="button"
              title="Reset zoom"
              onClick={() => zoomBy(0)}
              className="shrink-0 rounded px-1 text-[11px] tabular-nums text-content/55 hover:bg-content/10"
            >
              {Math.round(tab.zoom * 100)}%
            </button>
          ) : null}
        </label>
      </form>
      <ToolButton
        label={tab.picking === "element" ? "Stop picking" : "Pick elements and comment"}
        pressed={tab.picking === "element"}
        disabled={!tab.opened}
        onClick={togglePick}
      >
        <Target aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Screenshot to chat"
        disabled={!tab.opened}
        pressed={tab.picking === "area"}
        buttonRef={shotButton}
        onClick={() => setMenu(menu === "shot" ? null : "shot")}
      >
        <Image aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="Console and network" pressed={devtools} onClick={() => setDevtools(!devtools)}>
        <Terminal aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Bookmarks"
        buttonRef={bookmarksButton}
        pressed={menu === "bookmarks"}
        onClick={() => setMenu(menu === "bookmarks" ? null : "bookmarks")}
      >
        <Bookmark aria-hidden className="size-3.5" />
      </ToolButton>
      <ToolButton label="More" buttonRef={moreButton} onClick={() => setMenu(menu === "more" ? null : "more")}>
        <MoreHorizontal aria-hidden className="size-3.5" />
      </ToolButton>
    </div>
  );

  return (
    <section
      role="region"
      aria-label="Browser"
      data-app-browser
      onKeyDown={onKeyDown}
      className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col bg-surface text-content"
    >
      {panel || tabbed ? (
        <>
          {tabStrip}
          <div className="flex h-10 shrink-0 items-center border-b border-stroke">{toolbar}</div>
        </>
      ) : (
        <>
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
          {tabStrip}
        </>
      )}
      {store.notice ? (
        <p
          role={store.notice.tone === "error" ? "alert" : "status"}
          className={`flex shrink-0 items-center gap-2 border-b border-stroke px-3 py-1.5 text-[12px] ${
            store.notice.tone === "error" ? "text-red-300/90" : "text-content/70"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{store.notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="text-content/40 hover:text-content">
            <X aria-hidden className="size-3" />
          </button>
        </p>
      ) : null}
      <div
        ref={frame}
        className={`relative flex min-h-0 min-w-0 flex-1 justify-center bg-content/[0.03] ${tab.size?.height ? "items-center" : ""}`}
        style={tab.size ? { padding: DEVICE_GAP } : undefined}
      >
        {/* A fixed size sits in a thin glass rim; the page inside is never cut (L-222). */}
        <div
          className={tab.size ? `browser-device-rim flex-none ${tab.size.height ? "" : "h-full"}` : "contents"}
          style={tab.size ? { padding: DEVICE_RIM } : undefined}
        >
          <div
            ref={pageBox}
            className={`relative min-w-0 flex-1 ${tab.size?.height ? "" : "h-full"}`}
            style={boxStyle}
            title={tab.title || undefined}
          >
            {frozen && tab.opened ? (
              <button
                type="button"
                aria-label="Page (paused while a menu or message is open). Click to bring it back."
                title="Click to bring the live page back"
                onClick={() => {
                  view.current.liveAnyway = true;
                }}
                className="absolute inset-0 cursor-default"
              >
                <img
                  src={frozen}
                  alt=""
                  draggable={false}
                  className="block size-full select-none"
                />
              </button>
            ) : null}
            {tab.opened ? null : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Globe aria-hidden className="size-6 text-content/30" />
                <p className="text-[13px] text-content/70">Search or type an address above.</p>
                <p className="max-w-sm text-[12px] text-content/45">
                  Right-click a link in a chat and pick Open in MonoCode to load it here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {store.downloads.length ? (
        <ul role="list" className="shrink-0 border-t border-stroke px-2 py-1 text-[12px]">
          {store.downloads.map((item) => {
            const name = item.path?.split(/[\\/]/).pop() || shortUrl(item.url, 60);
            return (
              <li key={item.key} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-content/75">{name}</span>
                <span className={item.status === "failed" ? "text-red-300" : "text-content/45"}>
                  {item.status === "started" ? "Downloading…" : item.status === "done" ? "In Downloads" : "Failed"}
                </span>
                {item.status === "done" && item.path ? (
                  <button
                    type="button"
                    onClick={() => void invoke("reveal_path", { path: item.path }).catch(() => {})}
                    className="rounded px-1.5 text-content/60 hover:bg-content/10 hover:text-content"
                  >
                    Show
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`Dismiss ${name}`}
                  onClick={() => dismissDownload(item.key)}
                  className="text-content/40 hover:text-content"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {devtools ? <BrowserDevtools tab={tab} onClose={() => setDevtools(false)} /> : null}

      {contextMenu && contextMenu.target.tab === tab.id ? (
        <BrowserContextMenu
          target={contextMenu.target}
          tab={tab}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      ) : null}

      {editing && suggestions.length ? (
        <Popover
          anchor={addressBox}
          side="bottom"
          align="start"
          gap={4}
          width={Math.max(260, addressBox.current?.offsetWidth ?? 0)}
          role="listbox"
          id="browser-suggestions"
          aria-label="Suggestions"
          ignore="[data-browser-address]"
          onDismiss={() => setEditing(false)}
          className="p-1"
        >
          {suggestions.map((item, index) => (
            <button
              key={item.url}
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openAddress(item.url)}
              className={`${MENU_ITEM} ${index === highlight ? "bg-content/10" : ""}`}
            >
              {item.bookmark ? (
                <Star aria-hidden className="size-3.5 shrink-0 fill-current text-accent/80" />
              ) : (
                <Globe aria-hidden className="size-3.5 shrink-0 text-content/40" />
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="max-w-[45%] shrink-0 truncate text-[11px] text-content/40">{item.detail}</span>
            </button>
          ))}
        </Popover>
      ) : null}

      {menu === "shot" ? (
        <Popover anchor={shotButton} side="bottom" align="end" gap={4} width={230} role="menu" onDismiss={() => setMenu(null)} className="p-1">
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={() => {
              setMenu(null);
              void attachScreenshot(tab.id);
            }}
          >
            <Image aria-hidden className="size-3.5 text-content/50" />
            Visible page
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={() => {
              setMenu(null);
              setPicking(tab.id, "area");
            }}
          >
            <SelectAll aria-hidden className="size-3.5 text-content/50" />
            Drag an area
          </button>
        </Popover>
      ) : null}

      {menu === "bookmarks" ? (
        <Popover anchor={bookmarksButton} side="bottom" align="end" gap={4} width={300} role="menu" aria-label="Bookmarks" onDismiss={() => setMenu(null)} className="p-1">
          <button type="button" role="menuitem" className={MENU_ITEM} disabled={!tab.url} onClick={toggleSaved}>
            <Star aria-hidden className={`size-3.5 ${saved ? "fill-current text-accent" : "text-content/50"}`} />
            {saved ? "Remove this page" : "Bookmark this page"}
            <span className="ml-auto text-[11px] text-content/40">Ctrl+D</span>
          </button>
          <div className="my-1 h-px bg-stroke" />
          {bookmarks.length ? (
            <div className="max-h-80 overflow-y-auto">
              {bookmarks.map((item) => (
                <div key={item.url} className="group flex items-center">
                  <button
                    type="button"
                    role="menuitem"
                    title={`${item.url}\nCtrl+click or middle-click: open in a background tab`}
                    className={`${MENU_ITEM} min-w-0 flex-1`}
                    onClick={(event) => {
                      setMenu(null);
                      if (event.ctrlKey || event.metaKey) openInBackgroundTab(item.url);
                      else navigateTab(tab.id, item.url);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      openInBackgroundTab(item.url);
                    }}
                  >
                    <Globe aria-hidden className="size-3.5 shrink-0 text-content/40" />
                    <span className="min-w-0 flex-1 truncate">{item.title || shortUrl(item.url, 80)}</span>
                    <span className="max-w-[40%] shrink-0 truncate text-[11px] text-content/40">{hostOf(item.url)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove bookmark ${item.title || item.url}`}
                    title="Remove bookmark"
                    onClick={() => removeBookmark(item.url)}
                    className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-content/45 opacity-0 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2 py-2 text-[12px] text-content/50">
              No bookmarks yet. Click the star in the address bar, or press Ctrl+D.
            </p>
          )}
        </Popover>
      ) : null}

      {menu === "more" ? (
        <Popover anchor={moreButton} side="bottom" align="end" gap={4} width={240} role="menu" onDismiss={() => setMenu(null)} className="p-1">
          <div className="flex items-center gap-1 px-2 py-1 text-[12.5px] text-content/70">
            <span className="flex-1">Zoom</span>
            <ToolButton label="Zoom out" disabled={!tab.opened} onClick={() => zoomBy(-0.1)}>
              <ZoomOut aria-hidden className="size-3.5" />
            </ToolButton>
            <button
              type="button"
              disabled={!tab.opened}
              onClick={() => zoomBy(0)}
              className="w-11 rounded-md py-1 text-center tabular-nums hover:bg-content/10"
              title="Reset zoom"
            >
              {Math.round(tab.zoom * 100)}%
            </button>
            <ToolButton label="Zoom in" disabled={!tab.opened} onClick={() => zoomBy(0.1)}>
              <ZoomIn aria-hidden className="size-3.5" />
            </ToolButton>
          </div>
          <div className="px-2 pb-1 pt-1.5 text-[11px] text-content/45">Page size</div>
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            <button
              type="button"
              aria-pressed={tab.size === null}
              onClick={() => setPageSize(tab.id, null)}
              className={SIZE_BUTTON}
            >
              Fit
            </button>
            {BUILT_IN_SIZES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={sameSize(tab.size, preset)}
                onClick={() => setPageSize(tab.id, { width: preset.width, height: preset.height })}
                className={SIZE_BUTTON}
              >
                {preset.name} <span className="tabular-nums text-content/40">{sizeLabel(preset)}</span>
              </button>
            ))}
          </div>
          {customSizes.length ? (
            <ul role="list" className="px-1 pb-1">
              {customSizes.map((preset) => (
                <li key={preset.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={sameSize(tab.size, preset)}
                    onClick={() =>
                      setPageSize(tab.id, preset.height ? { width: preset.width, height: preset.height } : { width: preset.width })
                    }
                    className={`${SIZE_BUTTON} flex min-w-0 flex-1 items-center gap-2`}
                  >
                    <span className="truncate">{preset.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-content/40">{sizeLabel(preset)}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove size ${preset.name}`}
                    onClick={() => removeCustomSize(preset.id)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-content/40 opacity-0 transition-opacity duration-100 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {sizeForm ? (
            <form
              className="flex flex-col gap-1 px-2 pb-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                const made = newCustomSize(customSizes, sizeForm);
                if ("error" in made) {
                  setSizeForm({ ...sizeForm, error: made.error });
                  return;
                }
                addCustomSize(made.preset);
                setPageSize(tab.id, made.preset.height ? { width: made.preset.width, height: made.preset.height } : { width: made.preset.width });
                setSizeForm(null);
              }}
            >
              <input
                autoFocus
                aria-label="Size name"
                placeholder="Name (optional)"
                value={sizeForm.name}
                maxLength={40}
                onChange={(event) => setSizeForm({ ...sizeForm, name: event.target.value, error: undefined })}
                className={SIZE_INPUT}
              />
              <div className="flex items-center gap-1">
                <input
                  aria-label="Width"
                  placeholder="Width"
                  inputMode="numeric"
                  value={sizeForm.width}
                  onChange={(event) => setSizeForm({ ...sizeForm, width: event.target.value, error: undefined })}
                  className={`${SIZE_INPUT} w-0 flex-1 tabular-nums`}
                />
                <span aria-hidden className="text-[12px] text-content/40">×</span>
                <input
                  aria-label="Height (optional)"
                  placeholder="Height"
                  inputMode="numeric"
                  value={sizeForm.height}
                  onChange={(event) => setSizeForm({ ...sizeForm, height: event.target.value, error: undefined })}
                  className={`${SIZE_INPUT} w-0 flex-1 tabular-nums`}
                />
                <button type="submit" className="rounded-md bg-accent/15 px-2 py-1 text-[12px] text-accent hover:bg-accent/25">
                  Add
                </button>
              </div>
              {sizeForm.error ? (
                <p role="alert" className="text-[11px] text-red-400">
                  {sizeForm.error}
                </p>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setSizeForm({ name: "", width: "", height: "" })}
              className="mx-1 mb-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-content/60 hover:bg-content/10 hover:text-content"
            >
              <Plus aria-hidden className="size-3" />
              New size…
            </button>
          )}
          <div className="my-1 h-px bg-stroke" />
          <button type="button" role="menuitem" className={MENU_ITEM} disabled={!tab.opened} onClick={() => { setMenu(null); history("hardReload"); }}>
            <RotateCcw aria-hidden className="size-3.5 text-content/50" />
            Reload without cache
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM} disabled={!tab.url} onClick={() => { setMenu(null); copyAddress(); }}>
            <Copy aria-hidden className="size-3.5 text-content/50" />
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            disabled={!store.tabs.some((item) => item.url || item.pending)}
            onClick={() => {
              setMenu(null);
              copyTabLinks();
            }}
          >
            <Copy aria-hidden className="size-3.5 text-content/50" />
            Copy all tab links
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            disabled={!tab.opened}
            onClick={() => {
              setMenu(null);
              void invoke("browser_devtools", { tab: tab.id }).catch((cause) => showNotice(String(cause), "error"));
            }}
          >
            <Code aria-hidden className="size-3.5 text-content/50" />
            Inspect (DevTools)
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            disabled={!tab.url}
            onClick={() => {
              setMenu(null);
              void openUrl(tab.url).catch((cause) => showNotice(String(cause), "error"));
            }}
          >
            <ExternalLink aria-hidden className="size-3.5 text-content/50" />
            Open in default browser
          </button>
        </Popover>
      ) : null}
    </section>
  );
}
