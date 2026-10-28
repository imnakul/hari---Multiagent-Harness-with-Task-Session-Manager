/**
 * When each chat was last on screen (fork, L-190, L-192), per device. Coming
 * back to a chat after the "Open Session overview when you come back" wait
 * opens its Session overview on Summary.
 */
const KEY = "monocode.sessionLastSeen";
const MAX_ENTRIES = 300;

function read(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw))
      if (typeof value === "number" && Number.isFinite(value)) entries[id] = value;
    return entries;
  } catch {
    return {};
  }
}

/** Last time the chat was on screen, or null when never recorded. */
export function sessionLastSeen(sessionId: string): number | null {
  return read()[sessionId] ?? null;
}

export function recordSessionSeen(sessionId: string, at: number): void {
  const entries = read();
  delete entries[sessionId];
  entries[sessionId] = at;
  const ids = Object.keys(entries);
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES)))
    delete entries[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // private mode / quota
  }
}

/** True when the chat has been away from the screen for at least `idleMs`. */
export function awayLongerThan(
  sessionId: string,
  idleMs: number,
  now: number = Date.now(),
): boolean {
  const seen = sessionLastSeen(sessionId);
  return seen === null || now - seen >= idleMs;
}
