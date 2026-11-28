// Fork (Hari, L-412): what the Tabs layout remembers for each desktop: the
// open tab, and each arc's recent places and selection.
import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

export const TAB_NAMES = ["sessions", "share", "monos", "computer", "running"] as const;
export type TabName = (typeof TAB_NAMES)[number];

export type ArcKind = "sessions" | "monos";
export type ArcState = { recent: string[]; selected: string };
export type TabsMemory = { tab: TabName; arcs: Record<ArcKind, ArcState> };

/** The arc's first circle, which shows every project (or Mono). */
export const ALL = "all";
export const MAX_RECENT = 5;

const keyFor = (fingerprint: string) => `hari.tabs.${fingerprint}`;

export const emptyMemory = (): TabsMemory => ({
  tab: "sessions",
  arcs: {
    sessions: { recent: [], selected: ALL },
    monos: { recent: [], selected: ALL },
  },
});

const isTabName = (value: unknown): value is TabName =>
  typeof value === "string" && (TAB_NAMES as readonly string[]).includes(value);

function parseArc(raw: unknown): ArcState {
  if (typeof raw !== "object" || raw === null) return { recent: [], selected: ALL };
  const { recent, selected } = raw as { recent?: unknown; selected?: unknown };
  const ids = Array.isArray(recent)
    ? recent.filter((id): id is string => typeof id === "string" && id !== ALL)
    : [];
  const unique = ids.filter((id, index) => ids.indexOf(id) === index).slice(0, MAX_RECENT);
  return { recent: unique, selected: nextSelection(typeof selected === "string" ? selected : ALL, unique) };
}

/** What is stored, or the defaults for anything missing, corrupt or unknown. */
export function parseTabsMemory(raw: string | null): TabsMemory {
  if (!raw) return emptyMemory();
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return emptyMemory();
    const { tab, arcs } = value as { tab?: unknown; arcs?: unknown };
    const arcRecord = typeof arcs === "object" && arcs !== null ? (arcs as Record<string, unknown>) : {};
    return {
      tab: isTabName(tab) ? tab : "sessions",
      arcs: { sessions: parseArc(arcRecord.sessions), monos: parseArc(arcRecord.monos) },
    };
  } catch {
    return emptyMemory();
  }
}

/** `id` first, any earlier copy removed, the oldest dropped past `max`. */
export function pushRecent(recent: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...recent.filter((other) => other !== id)].slice(0, max);
}

/** The recent places that still exist. */
export function pruneRecent(recent: readonly string[], existingIds: ReadonlySet<string>): string[] {
  return recent.filter((id) => existingIds.has(id));
}

/** The selection once places may have gone: All when the selected one is. */
export function nextSelection(selected: string, recent: readonly string[]): string {
  return selected !== ALL && recent.includes(selected) ? selected : ALL;
}

/** Reads synchronously, so the first screen is the saved tab with no flash. */
export function readTabsMemory(fingerprint: string): TabsMemory {
  try {
    return parseTabsMemory(Storage.getItemSync(keyFor(fingerprint)));
  } catch {
    return emptyMemory();
  }
}

// What the screens read and write, kept in step with storage. Each write
// stores the whole state, so the latest one wins.
const cache = new Map<string, TabsMemory>();
const listeners = new Set<() => void>();

export const subscribeTabsMemory = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getTabsMemory(fingerprint: string): TabsMemory {
  let memory = cache.get(fingerprint);
  if (!memory) {
    memory = readTabsMemory(fingerprint);
    cache.set(fingerprint, memory);
  }
  return memory;
}

function saveTabsMemory(fingerprint: string, next: TabsMemory, { notify = true } = {}) {
  cache.set(fingerprint, next);
  if (notify) listeners.forEach((listener) => listener());
  void Storage.setItem(keyFor(fingerprint), JSON.stringify(next)).catch(() => undefined);
}

export function rememberTab(fingerprint: string, tab: TabName) {
  const memory = getTabsMemory(fingerprint);
  // Quietly: the open tab is only read at launch, and telling every screen
  // on each switch re-rendered Sessions and the bar mid-transition.
  if (memory.tab !== tab) saveTabsMemory(fingerprint, { ...memory, tab }, { notify: false });
}

/**
 * The arc with `id` (or All) selected. A place already on it keeps its spot,
 * so circles don't jump under the thumb; a new one goes next to All and the
 * oldest added drops past `MAX_RECENT`.
 */
export function arcWithSelection(arc: ArcState, id: string): ArcState {
  if (id === ALL) return { ...arc, selected: ALL };
  if (arc.recent.includes(id)) return { ...arc, selected: id };
  return { recent: pushRecent(arc.recent, id), selected: id };
}

/** Selects `id` (or All) in an arc; see `arcWithSelection`. */
export function selectInArc(fingerprint: string, kind: ArcKind, id: string) {
  const memory = getTabsMemory(fingerprint);
  const arc = memory.arcs[kind];
  const next = arcWithSelection(arc, id);
  if (next.selected === arc.selected && next.recent === arc.recent) return;
  saveTabsMemory(fingerprint, { ...memory, arcs: { ...memory.arcs, [kind]: next } });
}

/** Drops `id` from an arc, falling back to All when it was selected. */
export function removeFromArc(fingerprint: string, kind: ArcKind, id: string) {
  const memory = getTabsMemory(fingerprint);
  const arc = memory.arcs[kind];
  const recent = arc.recent.filter((other) => other !== id);
  const next = { recent, selected: nextSelection(arc.selected, recent) };
  saveTabsMemory(fingerprint, { ...memory, arcs: { ...memory.arcs, [kind]: next } });
}

/**
 * Drops places the desktop no longer has. Only call once the catalog has
 * loaded, so an empty list on reconnecting never wipes the arc. Returns the
 * ids dropped, for their icons to go too.
 */
export function pruneArc(fingerprint: string, kind: ArcKind, existingIds: ReadonlySet<string>): string[] {
  const memory = getTabsMemory(fingerprint);
  const arc = memory.arcs[kind];
  const recent = pruneRecent(arc.recent, existingIds);
  if (recent.length === arc.recent.length) return [];
  const next = { recent, selected: nextSelection(arc.selected, recent) };
  saveTabsMemory(fingerprint, { ...memory, arcs: { ...memory.arcs, [kind]: next } });
  return arc.recent.filter((id) => !existingIds.has(id));
}

/** Route file for a tab. Share and Computer carry `-tab` so they don't share a URL with the root `/share` and `/computer`. */
export function tabRoute(name: TabName): "sessions" | "share-tab" | "monos" | "computer-tab" | "running" {
  return name === "share" || name === "computer" ? `${name}-tab` : name;
}

/** The tab a route file stands for. */
export function tabOfRoute(route: string): TabName {
  return (route.endsWith("-tab") ? route.slice(0, -4) : route) as TabName;
}

/** The saved state for this desktop; re-renders as it changes. */
export function useTabsMemory(fingerprint: string): TabsMemory {
  return useSyncExternalStore(subscribeTabsMemory, () => getTabsMemory(fingerprint));
}
