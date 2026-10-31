/**
 * Fork (L-207): the Browser's tabs, DevTools rows, downloads and side panel,
 * shared by the Browser view tab and the side panel beside a chat. Each tab
 * is one native page (`monocode-browser-<id>`); only the shown tab runs, the
 * others are suspended by the backend.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { attachmentsFromFiles } from "../../sessions/model/attachments";
import { attachOrKeep, contextNote } from "../../sessions/model/attachToChat";
import {
  noteName,
  picksNote,
  shortUrl,
  type ConsoleRow,
  type NetworkRow,
  type PicksPayload,
} from "./browserContext";
import { isWebUrl, loadLastBrowserUrl } from "./browserRequest";

export type SizePreset = "fit" | 375 | 768 | 1280;
export const SIZE_PRESETS: { value: SizePreset; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: 375, label: "Phone · 375" },
  { value: 768, label: "Tablet · 768" },
  { value: 1280, label: "Laptop · 1280" },
];

export type PickMode = "element" | "area";

export type BrowserTab = {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  /** The user's zoom; the page also shrinks to fit a size preset. */
  zoom: number;
  preset: SizePreset;
  /** Shrink applied so a preset wider than the space still fits (≤ 1). */
  fit: number;
  /** A native page exists for this tab. */
  opened: boolean;
  /** An address waiting for the shown Browser to load it. */
  pending: string | null;
  picking: PickMode | null;
  console: ConsoleRow[];
  network: NetworkRow[];
};

export type BrowserDownload = {
  key: number;
  url: string;
  path: string | null;
  status: "started" | "done" | "failed";
};

export type BrowserStore = {
  tabs: BrowserTab[];
  activeId: number;
  panelOpen: boolean;
  panelWidth: number;
  downloads: BrowserDownload[];
  /** A short message under the toolbar (attached, failed…). */
  notice: { key: number; text: string; tone: "info" | "error" } | null;
};

export const PANEL_MIN = 320;
export const PANEL_DEFAULT = 520;
const MAX_CONSOLE = 400;
const MAX_NETWORK = 300;
const TABS_KEY = "monocode.browser.tabs";
const PANEL_KEY = "monocode.browser.panel";
const RECENTS_KEY = "monocode.browser.recents";
const MAX_RECENTS = 20;

function blankTab(id: number, url = ""): BrowserTab {
  return {
    id,
    url,
    title: "",
    loading: false,
    zoom: 1,
    preset: "fit",
    fit: 1,
    opened: false,
    pending: null,
    picking: null,
    console: [],
    network: [],
  };
}

function loadInitial(): BrowserStore {
  let tabs: BrowserTab[] = [];
  let activeId = 1;
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") as {
      tabs?: { id: number; url: string; title?: string; preset?: SizePreset }[];
      active?: number;
    } | null;
    tabs = (saved?.tabs ?? [])
      .filter((tab) => Number.isInteger(tab.id) && tab.id > 0)
      .slice(0, 20)
      .map((tab) => ({
        ...blankTab(tab.id, isWebUrl(tab.url) ? tab.url : ""),
        title: tab.title ?? "",
        preset: SIZE_PRESETS.some((p) => p.value === tab.preset) ? tab.preset! : "fit",
      }));
    activeId = saved?.active ?? tabs[0]?.id ?? 1;
  } catch {
    // corrupt or unavailable storage: start fresh
  }
  if (tabs.length === 0) tabs = [blankTab(1, loadLastBrowserUrl() ?? "")];
  if (!tabs.some((tab) => tab.id === activeId)) activeId = tabs[0].id;
  let panelOpen = false;
  let panelWidth = PANEL_DEFAULT;
  try {
    const panel = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null") as {
      open?: boolean;
      width?: number;
    } | null;
    panelOpen = panel?.open === true;
    if (typeof panel?.width === "number" && panel.width >= PANEL_MIN) panelWidth = panel.width;
  } catch {
    // keep defaults
  }
  return { tabs, activeId, panelOpen, panelWidth, downloads: [], notice: null };
}

let state: BrowserStore = loadInitial();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({
        tabs: state.tabs.map(({ id, url, title, preset }) => ({ id, url, title, preset })),
        active: state.activeId,
      }),
    );
    localStorage.setItem(
      PANEL_KEY,
      JSON.stringify({ open: state.panelOpen, width: state.panelWidth }),
    );
  } catch {
    // private mode / quota
  }
}

function set(next: Partial<BrowserStore>, save = false) {
  state = { ...state, ...next };
  if (save) persist();
  for (const listener of listeners) listener();
}

function updateTab(id: number, change: (tab: BrowserTab) => Partial<BrowserTab>, save = false) {
  let hit = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    hit = true;
    return { ...tab, ...change(tab) };
  });
  if (hit) set({ tabs }, save);
}

export function browserStore(): BrowserStore {
  return state;
}

export function subscribeBrowser(listener: () => void) {
  ensureListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBrowserStore(): BrowserStore {
  return useSyncExternalStore(subscribeBrowser, browserStore);
}

export function activeTab(store = state): BrowserTab {
  return store.tabs.find((tab) => tab.id === store.activeId) ?? store.tabs[0];
}

let noticeKey = 0;
export function showNotice(text: string, tone: "info" | "error" = "info") {
  noticeKey += 1;
  const key = noticeKey;
  set({ notice: { key, text, tone } });
  window.setTimeout(() => {
    if (state.notice?.key === key) set({ notice: null });
  }, tone === "error" ? 6000 : 3500);
}

export function dismissNotice() {
  set({ notice: null });
}

// ---------- tabs ----------

/** Opens a new tab, loading `url` when given, and shows it. */
export function newTab(url?: string): number {
  const id = Math.max(0, ...state.tabs.map((tab) => tab.id)) + 1;
  const tab = blankTab(id);
  tab.pending = url ?? null;
  set({ tabs: [...state.tabs, tab], activeId: id }, true);
  return id;
}

/** Loads `url` in the shown tab, or a new one when it already has a page. */
export function requestPage(url: string) {
  const current = activeTab();
  if (!current.url && !current.pending) {
    updateTab(current.id, () => ({ pending: url }));
  } else {
    newTab(url);
  }
}

export function navigateTab(id: number, url: string) {
  updateTab(id, () => ({ pending: url }));
}

/** Called by the Browser when it starts loading a pending address. */
export function takePending(id: number): string | null {
  const tab = state.tabs.find((item) => item.id === id);
  if (!tab?.pending) return null;
  const url = tab.pending;
  updateTab(id, () => ({ pending: null, url }), true);
  return url;
}

export function markOpened(id: number) {
  updateTab(id, () => ({ opened: true }));
}

export function selectTab(id: number) {
  if (!state.tabs.some((tab) => tab.id === id) || state.activeId === id) return;
  set({ activeId: id }, true);
}

export function closeTab(id: number) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  void invoke("browser_close", { tab: id }).catch(() => {});
  let tabs = state.tabs.filter((tab) => tab.id !== id);
  let activeId = state.activeId;
  if (tabs.length === 0) {
    tabs = [blankTab(id + 1)];
    activeId = tabs[0].id;
  } else if (activeId === id) {
    activeId = tabs[Math.min(index, tabs.length - 1)].id;
  }
  set({ tabs, activeId }, true);
}

/** Every native page closed (the Browser left entirely); tabs stay listed. */
export function closeAllPages() {
  void invoke("browser_close", { tab: null }).catch(() => {});
  set({
    tabs: state.tabs.map((tab) => ({ ...tab, opened: false, picking: null, loading: false })),
  });
}

export function setPreset(id: number, preset: SizePreset) {
  updateTab(id, () => ({ preset }), true);
}

export function setFit(id: number, fit: number) {
  updateTab(id, () => ({ fit }));
}

/** Applies the user's zoom times the preset's fit to the page. */
export function applyZoom(tab: BrowserTab, zoom = tab.zoom) {
  const clamped = Math.min(5, Math.max(0.25, Math.round(zoom * 100) / 100));
  updateTab(tab.id, () => ({ zoom: clamped }));
  if (tab.opened) {
    void invoke("browser_zoom", { tab: tab.id, factor: clamped * tab.fit }).catch(() => {});
  }
}

export function clearDevtools(id: number, which: "console" | "network") {
  updateTab(id, () => (which === "console" ? { console: [] } : { network: [] }));
}

// ---------- panel ----------

export function setPanelOpen(open: boolean) {
  if (state.panelOpen !== open) set({ panelOpen: open }, true);
}

export function togglePanel() {
  setPanelOpen(!state.panelOpen);
}

export function setPanelWidth(width: number) {
  set({ panelWidth: Math.max(PANEL_MIN, Math.round(width)) }, true);
}

// ---------- recents ----------

export function loadRecents(): { url: string; title: string }[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    return Array.isArray(list)
      ? list.filter(
          (item): item is { url: string; title: string } =>
            typeof item?.url === "string" && isWebUrl(item.url),
        )
      : [];
  } catch {
    return [];
  }
}

function rememberPage(url: string, title: string) {
  if (!isWebUrl(url)) return;
  const list = loadRecents().filter((item) => item.url !== url);
  const previous = loadRecents().find((item) => item.url === url);
  list.unshift({ url, title: title || previous?.title || "" });
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // ignore
  }
}

// ---------- pick tool, screenshots ----------

export function setPicking(id: number, mode: PickMode | null) {
  updateTab(id, () => ({ picking: mode }));
  void invoke("browser_pick", { tab: id, mode: mode ?? "off" }).catch((cause) => {
    updateTab(id, () => ({ picking: null }));
    showNotice(String(cause), "error");
  });
}

function reportAttached(result: "added" | "kept", what: string) {
  showNotice(
    result === "added"
      ? `${what} added to the chat`
      : `${what} saved; it goes into the chat when you go back to it`,
  );
}

/** Attaches a text note to the focused chat. */
export function attachNote(kind: string, detail: string, text: string) {
  reportAttached(attachOrKeep([contextNote(noteName(kind, detail), text)]), kind);
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A screenshot of the page (or a page region) into the chat as an image. */
export async function attachScreenshot(
  id: number,
  clip?: { x: number; y: number; width: number; height: number },
) {
  try {
    const data = await invoke<string>("browser_screenshot", { tab: id, clip: clip ?? null });
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const file = new File([base64ToBytes(data)], `browser-${stamp}.png`, { type: "image/png" });
    const attachments = await attachmentsFromFiles([file]);
    if (attachments.length === 0) throw new Error("The screenshot could not be saved");
    reportAttached(attachOrKeep(attachments), "Screenshot");
  } catch (cause) {
    showNotice(`Screenshot failed: ${String(cause)}`, "error");
  }
}

// ---------- native events ----------

type StatePayload = {
  tab: number;
  url?: string;
  title?: string;
  loading?: boolean;
  zoom?: number;
};

type DevtoolsEntry =
  | (Omit<ConsoleRow, "kind"> & { kind: "console" })
  | { kind: "request"; id: string; method: string; url: string; type?: string; postData?: string | null }
  | { kind: "response"; id: string; status: number; statusText?: string; mimeType?: string }
  | { kind: "failed"; id: string; error?: string; canceled?: boolean }
  | { kind: "finished"; id: string; size?: number };

function onDevtools(id: number, entry: DevtoolsEntry) {
  updateTab(id, (tab) => {
    if (entry.kind === "console") {
      const row: ConsoleRow = {
        kind: "console",
        level: entry.level,
        text: entry.text,
        source: entry.source ?? null,
      };
      return { console: [...tab.console, row].slice(-MAX_CONSOLE) };
    }
    if (entry.kind === "request") {
      // Redirects reuse the id: the latest hop replaces the row.
      const rest = tab.network.filter((row) => row.id !== entry.id);
      const row: NetworkRow = {
        kind: "network",
        id: entry.id,
        method: entry.method,
        url: entry.url,
        type: entry.type,
        postData: entry.postData ?? null,
        done: false,
      };
      return { network: [...rest, row].slice(-MAX_NETWORK) };
    }
    const network = tab.network.map((row) => {
      if (row.id !== entry.id) return row;
      if (entry.kind === "response") {
        return { ...row, status: entry.status, statusText: entry.statusText, mimeType: entry.mimeType };
      }
      if (entry.kind === "failed") {
        return { ...row, error: entry.canceled ? "canceled" : (entry.error ?? "failed"), done: true };
      }
      return { ...row, size: entry.size, done: true };
    });
    return { network };
  });
}

let downloadKey = 0;
function onDownload(payload: { url: string; path: string | null; status: BrowserDownload["status"] }) {
  const name = payload.path?.split(/[\\/]/).pop() || shortUrl(payload.url, 60);
  if (payload.status === "started") {
    downloadKey += 1;
    const item: BrowserDownload = { key: downloadKey, ...payload };
    set({ downloads: [item, ...state.downloads].slice(0, 5) });
    showNotice(`Downloading ${name} to Downloads`);
    return;
  }
  const match = state.downloads.find((item) => item.url === payload.url && item.status === "started");
  const downloads = match
    ? state.downloads.map((item) => (item === match ? { ...item, ...payload } : item))
    : [{ key: ++downloadKey, ...payload }, ...state.downloads].slice(0, 5);
  set({ downloads });
  showNotice(
    payload.status === "done" ? `Downloaded ${name}` : `Download failed: ${name}`,
    payload.status === "done" ? "info" : "error",
  );
}

export function dismissDownload(key: number) {
  set({ downloads: state.downloads.filter((item) => item.key !== key) });
}

function onPick(id: number, data: { kind: string } & Record<string, unknown>) {
  if (data.kind === "picks") {
    const payload = data as unknown as PicksPayload;
    if (!Array.isArray(payload.items) || payload.items.length === 0) return;
    const count = payload.items.length;
    reportAttached(
      attachOrKeep([
        contextNote(
          noteName("Page feedback", `${count} item${count === 1 ? "" : "s"}`),
          picksNote(payload),
        ),
      ]),
      count === 1 ? "1 pick" : `${count} picks`,
    );
    setPicking(id, null);
    return;
  }
  updateTab(id, () => ({ picking: null }));
  if (data.kind === "area") {
    const rect = data.rect as { x: number; y: number; width: number; height: number };
    void attachScreenshot(id, rect);
  }
}

let installed = false;
function ensureListeners() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  void listen<StatePayload>("browser://state", ({ payload }) => {
    updateTab(
      payload.tab,
      (tab) => {
        const change: Partial<BrowserTab> = {};
        if (typeof payload.url === "string") change.url = payload.url;
        if (typeof payload.title === "string") change.title = payload.title;
        if (typeof payload.loading === "boolean") change.loading = payload.loading;
        if (typeof payload.zoom === "number" && tab.fit > 0) {
          change.zoom = Math.round((payload.zoom / tab.fit) * 100) / 100;
        }
        if (change.url || change.title) {
          rememberPage(change.url ?? tab.url, change.title ?? tab.title);
        }
        return change;
      },
      typeof payload.url === "string" || typeof payload.title === "string",
    );
  }).catch(() => {});
  void listen<{ tab: number; entry: DevtoolsEntry }>("browser://devtools", ({ payload }) =>
    onDevtools(payload.tab, payload.entry),
  ).catch(() => {});
  void listen<{ url: string; path: string | null; status: BrowserDownload["status"] }>(
    "browser://download",
    ({ payload }) => onDownload(payload),
  ).catch(() => {});
  void listen<{ url: string }>("browser://new-tab", ({ payload }) => {
    if (isWebUrl(payload.url)) newTab(payload.url);
  }).catch(() => {});
  void listen<{ tab: number; data: { kind: string } & Record<string, unknown> }>(
    "browser://pick",
    ({ payload }) => onPick(payload.tab, payload.data),
  ).catch(() => {});
}
