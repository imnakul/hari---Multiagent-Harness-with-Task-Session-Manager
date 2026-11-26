/**
 * Fork (L-399): which left-column sections of the Activity page are folded.
 * Stored per machine; every section starts open.
 */
export type SectionId = "projects" | "apps" | "sites" | "phone";

export const ACTIVITY_COLLAPSED_KEY = "monocode.activity.collapsed.v1";
export const SECTION_IDS: readonly SectionId[] = ["projects", "apps", "sites", "phone"];

export type CollapsedSections = Record<SectionId, boolean>;

const OPEN: CollapsedSections = { projects: false, apps: false, sites: false, phone: false };

export function loadCollapsed(): CollapsedSections {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACTIVITY_COLLAPSED_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return { ...OPEN };
    const next = { ...OPEN };
    for (const id of SECTION_IDS) next[id] = Reflect.get(value, id) === true;
    return next;
  } catch {
    return { ...OPEN };
  }
}

export function saveCollapsed(id: SectionId, collapsed: boolean): CollapsedSections {
  const next = { ...loadCollapsed(), [id]: collapsed };
  try {
    localStorage.setItem(ACTIVITY_COLLAPSED_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("activity: could not save the folded sections", error);
  }
  return next;
}
