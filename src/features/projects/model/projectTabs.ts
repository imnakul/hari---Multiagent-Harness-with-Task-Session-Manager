import { sameProjectPath } from "./recents";

/** Projects kept as tabs beside the inset sidebar's project name (L-130). */
const STORAGE_KEY = "monocode.insetProjectTabs.v1";

/**
 * Ctrl+click on a project: adds it as a tab, or removes it when it already
 * is one. The current project joins too, so the user can switch back to it.
 * The current project itself is never toggled.
 */
export function toggleProjectTab(
  tabs: readonly string[],
  path: string,
  current: string,
): string[] {
  if (sameProjectPath(path, current)) return [...tabs];
  if (tabs.some((tab) => sameProjectPath(tab, path)))
    return closeProjectTab(tabs, path);
  const withCurrent = tabs.some((tab) => sameProjectPath(tab, current))
    ? [...tabs]
    : [...tabs, current];
  return [...withCurrent, path];
}

export function closeProjectTab(
  tabs: readonly string[],
  path: string,
): string[] {
  return tabs.filter((tab) => !sameProjectPath(tab, path));
}

export function isProjectTab(tabs: readonly string[], path: string): boolean {
  return tabs.some((tab) => sameProjectPath(tab, path));
}

/**
 * The tabs to draw: known projects only (removed ones drop out), once each,
 * in the order they were added. The current project keeps its place, so
 * switching never reorders the row.
 */
export function visibleProjectTabs(
  tabs: readonly string[],
  known: readonly string[],
): string[] {
  const shown: string[] = [];
  for (const tab of tabs) {
    if (!known.some((path) => sameProjectPath(path, tab))) continue;
    if (shown.some((path) => sameProjectPath(path, tab))) continue;
    shown.push(tab);
  }
  return shown;
}

export function loadProjectTabs(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    // Unreadable or missing storage: start with no tabs.
    return [];
  }
}

export function saveProjectTabs(tabs: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Storage full or blocked: tabs last for this run only.
  }
}
