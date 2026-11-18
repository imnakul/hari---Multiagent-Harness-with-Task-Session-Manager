import { router } from "expo-router";

import { pickProject } from "./projectPick";

type NavState = {
  key: string;
  routes: readonly { name: string; state?: unknown }[];
};

/** What the app's navigation container gives (expo-router's useNavigationContainerRef). */
export type RootNav = {
  getRootState(): unknown;
  dispatch(action: { type: string; payload?: object; target?: string }): void;
};

/** The app's own stack: under expo-router's "__root" slot. */
function appStack(nav: RootNav): NavState | undefined {
  let state = nav.getRootState() as NavState | undefined;
  while (state?.routes.length === 1 && state.routes[0].name === "__root" && state.routes[0].state)
    state = state.routes[0].state as NavState;
  return state;
}

/**
 * Fork (Hari, L-343): takes off every screen over the place at the bottom of
 * the app's stack (a project or a Mono): sessions, files, sheets. A switch
 * from the side menu otherwise changed only the project underneath, and the
 * sessions on top stayed in front of it.
 */
export function clearToPlace(nav: RootNav) {
  const stack = appStack(nav);
  const above = (stack?.routes.length ?? 1) - 1;
  if (stack && above > 0) nav.dispatch({ type: "POP", payload: { count: above }, target: stack.key });
}

/** Fork (Hari, L-343): a project, as the one place on screen. */
export function showProject(nav: RootNav, projectId: string) {
  clearToPlace(nav);
  // The project screen takes a pick in place; anything else is replaced.
  if (!pickProject(projectId))
    router.replace({ pathname: "/project/[projectId]", params: { projectId } });
}

/** Fork (Hari, L-343): a session over its project, and nothing else over it. */
export function showSession(nav: RootNav, projectId: string, sessionId: string) {
  showProject(nav, projectId);
  router.push({
    pathname: "/project/[projectId]/session/[sessionId]",
    params: { projectId, sessionId },
  });
}
