import { router } from "expo-router";

import { hubTabSet } from "@/features/pc/hubTab";
import { readPlaceMemory, updatePlaceMemory, type PlaceMemory } from "./placeMemory";
import { pickProject } from "./projectPick";

type Route = { name: string; params?: Record<string, unknown>; state?: unknown };
type NavState = { key: string; routes: readonly Route[] };

/** What the app's navigation container gives (expo-router's useNavigationContainerRef). */
export type RootNav = {
  getRootState(): unknown;
  dispatch(action: { type: string; payload?: object; target?: string }): void;
};

/** Fork (Hari, L-346): the places the side menu switches between. */
export type PlaceTarget =
  | { kind: "project"; id: string }
  | { kind: "tasks" | "notes" | "computer" | "notifications" }
  /** The hub on Share, as a share notification opens it: no folder over it. */
  | { kind: "share" };

/** The app's own stack: under expo-router's "__root" slot. */
function appStack(nav: RootNav): NavState | undefined {
  let state = nav.getRootState() as NavState | undefined;
  while (state?.routes.length === 1 && state.routes[0].name === "__root" && state.routes[0].state)
    state = state.routes[0].state as NavState;
  return state;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * Fork (Hari, L-347): what the place at the bottom of the stack has open,
 * written to the memory as the user leaves it.
 */
function snapshot(stack: NavState, desktop: string | undefined) {
  const [place, ...above] = stack.routes;
  if (!place) return;
  const nested = (place.state as NavState | undefined)?.routes ?? [];
  if (place.name === "project/[projectId]/index") {
    const projectId = text(place.params?.projectId);
    if (!projectId) return;
    const session = [...above]
      .reverse()
      .find((route) => route.name === "project/[projectId]/session/[sessionId]" && route.params?.projectId === projectId);
    const sessionId = text(session?.params?.sessionId);
    updatePlaceMemory(desktop, (memory) => {
      const sessions = { ...memory.sessions };
      if (sessionId) sessions[projectId] = sessionId;
      else delete sessions[projectId];
      return { ...memory, sessions };
    });
  } else if (place.name === "notes") {
    const note = nested.find((route) => route.name === "[noteId]");
    updatePlaceMemory(desktop, (memory) => ({ ...memory, note: text(note?.params?.noteId) }));
  } else if (place.name === "computer" || place.name === "share") {
    const index = nested.find((route) => route.name === "index");
    const files = nested.find((route) => route.name === "files");
    const tab =
      hubTabSet() ?? (place.name === "share" || index?.params?.tab === "share" ? "share" : "control");
    updatePlaceMemory(desktop, (memory) => ({
      ...memory,
      computer: { tab, folder: files ? (text(files.params?.path) ?? "") : undefined },
    }));
  }
}

/**
 * Fork (Hari, L-343): takes off every screen over the place at the bottom of
 * the app's stack (a project or a Mono): sessions, files, sheets. A switch
 * from the side menu otherwise changed only the project underneath, and the
 * sessions on top stayed in front of it. L-347: what the place had open is
 * remembered first.
 */
export function clearToPlace(nav: RootNav, desktop?: string) {
  const stack = appStack(nav);
  if (!stack) return;
  snapshot(stack, desktop);
  const above = stack.routes.length - 1;
  if (above > 0) nav.dispatch({ type: "POP", payload: { count: above }, target: stack.key });
}

/** Fork (Hari, L-343): a project, as the one place on screen. */
export function showProject(nav: RootNav, projectId: string, desktop?: string) {
  clearToPlace(nav, desktop);
  // The project screen takes a pick in place; anything else is replaced.
  if (!pickProject(projectId))
    router.replace({ pathname: "/project/[projectId]", params: { projectId } });
}

/** Fork (Hari, L-343): a session over its project, and nothing else over it. */
export function showSession(nav: RootNav, projectId: string, sessionId: string, desktop?: string) {
  showProject(nav, projectId, desktop);
  router.push({
    pathname: "/project/[projectId]/session/[sessionId]",
    params: { projectId, sessionId },
  });
}

/**
 * Fork (Hari, L-346, L-347): a place from the side menu, rebuilt where the
 * user left it: a project's session, the open note, the hub's tab and folder.
 */
export function showPlace(nav: RootNav, place: PlaceTarget, desktop?: string) {
  // Read before leaving: the place being left may be this one (a project
  // picked again from another project's session is not).
  const leaving = appStack(nav);
  if (leaving) snapshot(leaving, desktop);
  const memory: PlaceMemory = readPlaceMemory(desktop);
  if (place.kind === "project") {
    const sessionId = memory.sessions[place.id];
    if (sessionId) showSession(nav, place.id, sessionId, desktop);
    else showProject(nav, place.id, desktop);
    return;
  }
  clearToPlace(nav, desktop);
  if (place.kind === "notes") {
    router.replace("/notes");
    if (memory.note) router.push({ pathname: "/notes/[noteId]", params: { noteId: memory.note } });
    return;
  }
  if (place.kind === "computer" || place.kind === "share") {
    const tab = place.kind === "share" ? "share" : (memory.computer?.tab ?? "share");
    router.replace({ pathname: "/computer", params: { tab } });
    const folder = place.kind === "computer" ? memory.computer?.folder : undefined;
    if (folder !== undefined) router.push({ pathname: "/computer/files", params: { path: folder } });
    return;
  }
  router.replace(`/${place.kind}`);
}
