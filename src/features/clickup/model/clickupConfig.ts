import { useSyncExternalStore } from "react";

/** Fork (L-381): which project ClickUp is linked to and which lists are shown. Holds no token and no member data. */

export const CLICKUP_CONFIG_KEY = "monocode.clickup.v1";
export const MAX_CLICKUP_LISTS = 10;

export interface ClickupListRef {
  id: string;
  name: string;
}
export interface ClickupConfig {
  projectPath: string | null;
  lists: ClickupListRef[];
}

const EMPTY: ClickupConfig = { projectPath: null, lists: [] };
const CHANGE_EVENT = "monocode:clickup-config";

/** Accepts `…/v/li/<id>`, `…/v/l/<x>-<id>-<y>` or a bare numeric ID; anything else gives null. */
export function parseClickupListRef(input: string): string | null {
  const text = input.trim();
  if (/^\d{4,}$/.test(text)) return text;
  const link = /^https?:\/\/(?:app\.)?clickup\.com\/[^?#]*?\/v\/(li|l)\/([^/?#]+)/i.exec(text);
  if (!link) return null;
  if (link[1].toLowerCase() === "li") return /^\d{4,}$/.test(link[2]) ? link[2] : null;
  const parts = link[2].split("-");
  const id = parts.length >= 2 ? parts[1] : link[2];
  return /^\d{4,}$/.test(id) ? id : null;
}

export function parseClickupConfig(raw: string | null): ClickupConfig {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY;
    const record = value as Record<string, unknown>;
    const lists: ClickupListRef[] = [];
    if (Array.isArray(record.lists)) {
      for (const entry of record.lists) {
        if (typeof entry !== "object" || entry === null) continue;
        const { id, name } = entry as Record<string, unknown>;
        if (typeof id !== "string" || typeof name !== "string" || !id) continue;
        if (lists.some((list) => list.id === id)) continue;
        lists.push({ id, name });
        if (lists.length >= MAX_CLICKUP_LISTS) break;
      }
    }
    return {
      projectPath: typeof record.projectPath === "string" && record.projectPath ? record.projectPath : null,
      lists,
    };
  } catch {
    return EMPTY;
  }
}

let cached: { raw: string | null; config: ClickupConfig } | null = null;

export function loadClickupConfig(): ClickupConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CLICKUP_CONFIG_KEY);
  } catch {
    raw = null;
  }
  if (cached?.raw === raw) return cached.config;
  cached = { raw, config: parseClickupConfig(raw) };
  return cached.config;
}

export function saveClickupConfig(config: ClickupConfig): void {
  const next: ClickupConfig = {
    projectPath: config.projectPath,
    lists: config.lists.slice(0, MAX_CLICKUP_LISTS),
  };
  try {
    localStorage.setItem(CLICKUP_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the in-session value is lost on restart; nothing else to do.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeClickupConfig(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === CLICKUP_CONFIG_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useClickupConfig(): ClickupConfig {
  return useSyncExternalStore(subscribeClickupConfig, loadClickupConfig, () => EMPTY);
}

/** AC-C3: the nav entry shows for the linked project, or anywhere until a project is linked. */
export function clickupVisibleFor(
  config: ClickupConfig,
  currentProject: string | null,
  samePath: (a: string, b: string) => boolean,
): boolean {
  if (!config.projectPath) return true;
  return currentProject !== null && samePath(config.projectPath, currentProject);
}
