import { invoke } from "@tauri-apps/api/core";
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
  Target,
  Terminal,
  X,
  ZoomIn,
  ZoomOut,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { deliverKeptAttachments } from "../../sessions/model/attachToChat";
import { UI_SCALE_CHANGE_EVENT } from "../../settings/model/uiScale";
import { shortUrl } from "../model/browserContext";
import { addressFromInput, overlapsPage } from "../model/browserRequest";
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
  setPicking,
  setPreset,
  showNotice,
  SIZE_PRESETS,
  takePending,
  useBrowserStore,
  type BrowserTab,
} from "../model/browserTabs";
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

function tabLabel(tab: BrowserTab): string {
  if (tab.title) return tab.title;
  if (tab.url || tab.pending) return shortUrl(tab.url || tab.pending || "", 40);
  return "New tab";
}

type Suggestion = { url: string; label: string; detail: string };

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
  onClose,
  onToggleSidebar,
}: {
  active: boolean;
  /** Shown beside a chat rather than as its own view. */
  panel?: boolean;
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
}) {
  const store = useBrowserStore();
  const tab = activeTab(store);
  const frame = useRef<HTMLDivElement>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const addressBox = useRef<HTMLLabelElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const shotButton = useRef<HTMLButtonElement>(null);
  const [address, setAddress] = useState(tab.url);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<"more" | "shot" | null>(null);
  const [devtools, setDevtools] = useState(false);
  const [servers, setServers] = useState<{ port: number; name: string }[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [frameWidth, setFrameWidth] = useState(0);
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

  // Keep the native view on the page area, and out of the way of
  // MonoCode's own menus and dialogs, which it would otherwise paint over.
  const shownId = tab.opened ? tab.id : null;
  useEffect(() => {
    if (!active || shownId == null) return;
    let last = "";
    let shown: boolean | null = null;
    const sync = () => {
      const rect = bounds();
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
  }, [active, shownId, bounds]);

  // The space the page can use, for size presets.
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setFrameWidth(node.clientWidth));
    observer.observe(node);
    setFrameWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  // A preset wider than the space shrinks the page to fit, so a laptop
  // layout still shows whole in a narrow panel.
  const fit =
    tab.preset === "fit" || frameWidth <= 0 ? 1 : Math.min(1, frameWidth / tab.preset);
  const boxWidth = tab.preset === "fit" ? undefined : Math.min(tab.preset, frameWidth || tab.preset);
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
    const pages: Suggestion[] = recents.map((item) => ({
      url: item.url,
      label: item.title || shortUrl(item.url, 80),
      detail: shortUrl(item.url, 80),
    }));
    const all = [...local, ...pages].filter(
      (item, index, list) => list.findIndex((other) => other.url === item.url) === index,
    );
    const matches = typed
      ? all.filter((item) => `${item.url} ${item.label}`.toLowerCase().includes(query))
      : all;
    return matches.slice(0, 8);
  }, [editing, address, servers, recents, tab.url]);

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
    else return;
    event.preventDefault();
  };

  const copyAddress = () => {
    void navigator.clipboard
      .writeText(tab.url)
      .then(() => showNotice("Address copied"))
      .catch(() => showNotice("Couldn't copy the address", "error"));
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
      <div ref={frame} className="relative flex min-h-0 min-w-0 flex-1 justify-center bg-content/[0.03]">
        <div
          ref={pageBox}
          className="relative h-full min-w-0 flex-1"
          style={boxWidth ? { flex: "none", width: boxWidth } : undefined}
          title={tab.title || undefined}
        >
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
              <Globe aria-hidden className="size-3.5 shrink-0 text-content/40" />
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
          <div className="px-2 pb-1 pt-1.5 text-[11px] text-content/45">Page width</div>
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                aria-pressed={tab.preset === preset.value}
                onClick={() => setPreset(tab.id, preset.value)}
                className="rounded-md px-2 py-1 text-left text-[12px] text-content/75 hover:bg-content/10 aria-pressed:bg-accent/15 aria-pressed:text-accent"
              >
                {preset.label}
              </button>
            ))}
          </div>
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
