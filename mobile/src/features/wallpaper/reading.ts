// Fork (Hari, L-245): the routes of a conversation's messages, whose
// wallpaper takes READING_DIM (see wallpaper.ts) so they read easily.
const READING_ROUTES = new Set([
  "project/[projectId]/session/[sessionId]",
  "session",
  "mono/[monoId]",
]);

/** Whether a route, by its name in the root stack, shows a conversation. */
export const isReadingRoute = (name: string): boolean => READING_ROUTES.has(name);

/** As isReadingRoute, for a path (`/project/a/session/b`). */
export const isReadingPath = (path: string): boolean =>
  /^\/(project\/[^/]+\/session\/[^/]+|session|mono\/[^/]+)\/?$/.test(path);
