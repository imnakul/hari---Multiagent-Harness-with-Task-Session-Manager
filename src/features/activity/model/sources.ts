import type { ActivityLog, AwSummary } from "./activity";

/**
 * Fork (L-398): which sources the Activity page shows. MonoCode is the agent
 * log, Browser the sites and browser apps, Other apps the rest of the desktop
 * (apps, meetings, hourly notes), Phone the Hari screen time. Stored per
 * machine; at least one stays on.
 */
export type ActivitySource = "monocode" | "browser" | "other" | "phone";

export const ACTIVITY_SOURCES_KEY = "monocode.activity.sources.v1";
export const ALL_SOURCES: readonly ActivitySource[] = ["monocode", "browser", "other", "phone"];
export const DEFAULT_SOURCES: readonly ActivitySource[] = ["monocode", "browser", "other"];

const BROWSER_APP = /^(google[ -]chrome|chrome|chromium|msedge|microsoft[ -]edge|firefox|brave|opera|vivaldi|arc|zen)(\s.*)?$/i;

/** Whether an ActivityWatch app name is a web browser (case-insensitive, no ".exe"). */
export function isBrowserApp(name: string): boolean {
  return BROWSER_APP.test(name.trim().replace(/\.exe$/i, ""));
}

function isSource(value: unknown): value is ActivitySource {
  return ALL_SOURCES.some((source) => source === value);
}

export function loadSources(): ActivitySource[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACTIVITY_SOURCES_KEY) ?? "null");
    if (Array.isArray(value)) {
      const picked = ALL_SOURCES.filter((source) => value.some((item) => item === source));
      if (picked.length > 0) return picked;
    }
  } catch {
    // Unreadable or no storage: use the default.
  }
  return [...DEFAULT_SOURCES];
}

export function saveSources(sources: readonly ActivitySource[]): void {
  try {
    localStorage.setItem(ACTIVITY_SOURCES_KEY, JSON.stringify(sources.filter(isSource)));
  } catch (error) {
    console.warn("activity: could not save the sources", error);
  }
}

/** Flips one source; refuses to turn the last one off. */
export function toggleSource(
  sources: readonly ActivitySource[],
  source: ActivitySource,
): ActivitySource[] {
  const on = sources.includes(source);
  if (on && sources.length === 1) return [...sources];
  return ALL_SOURCES.filter((item) => (item === source ? !on : sources.includes(item)));
}

/** ActivityWatch data narrowed to the chosen sources. Active time stays whole (it is not per app). */
export function filterAw(aw: AwSummary, sources: readonly ActivitySource[]): AwSummary {
  const browser = sources.includes("browser");
  const other = sources.includes("other");
  return {
    ...aw,
    apps: aw.apps.filter((row) => (isBrowserApp(row.app) ? browser : other)),
    sites: browser ? aw.sites : [],
    meetings: other ? aw.meetings : [],
    meetingMs: other ? aw.meetingMs : 0,
  };
}

/** The log narrowed to the chosen sources: agent events and prompt notes need MonoCode, hourly notes Browser or Other apps. */
export function filterLog(log: ActivityLog, sources: readonly ActivitySource[]): ActivityLog {
  const monocode = sources.includes("monocode");
  const desktop = sources.includes("browser") || sources.includes("other");
  return {
    events: monocode ? log.events : [],
    notes: log.notes.filter((note) => (note.kind === "hourly" ? desktop : monocode)),
  };
}
