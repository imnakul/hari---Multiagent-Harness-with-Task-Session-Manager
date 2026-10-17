import type { HarnessId } from "../../sessions/model/session";

/**
 * In-app notification history behind the title-bar bell (fork-only, L-91).
 *
 * Collects what happened while the user looked elsewhere (chat replies,
 * approvals, questions, automation runs) so it can be reviewed in one place
 * later. It is independent of the OS banner setting, which only decides
 * whether a banner also pops up. Kept in localStorage: losing it only clears
 * the history.
 */
export type CenterNotificationKind =
  | "finished"
  | "approval"
  | "question"
  | "automationSucceeded"
  | "automationFailed";

export type CenterNotification = {
  id: string;
  kind: CenterNotificationKind;
  /** Chat or automation name. */
  title: string;
  body: string;
  at: number;
  read: boolean;
  cwd?: string;
  harness?: HarnessId;
  model?: string;
  /** Opens this chat on click, when it still exists. */
  sessionId?: string;
};

export type CenterNotificationInput = Omit<CenterNotification, "id" | "at" | "read"> & {
  /** Same key replaces the earlier entry (one entry per pending approval). */
  key?: string;
  at?: number;
};

const STORAGE_KEY = "monocode.notificationCenter.v1";
const CHANGED_EVENT = "monocode:notification-center-changed";
/** Window event the app listens for to open a notification's chat. */
export const OPEN_NOTIFICATION_SESSION_EVENT = "monocode:notification-center-open";
/** Oldest entries are dropped past this. */
export const MAX_CENTER_NOTIFICATIONS = 100;

const KINDS: readonly string[] = [
  "finished",
  "approval",
  "question",
  "automationSucceeded",
  "automationFailed",
];

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isCenterNotification(value: unknown): value is CenterNotification {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: string): unknown => Reflect.get(value, name);
  const kind = field("kind");
  return (
    typeof field("id") === "string" &&
    typeof kind === "string" &&
    KINDS.includes(kind) &&
    typeof field("title") === "string" &&
    typeof field("body") === "string" &&
    typeof field("at") === "number" &&
    typeof field("read") === "boolean" &&
    optionalString(field("cwd")) &&
    optionalString(field("harness")) &&
    optionalString(field("model")) &&
    optionalString(field("sessionId"))
  );
}

let cached: { raw: string | null; items: CenterNotification[] } | null = null;

function readItems(): CenterNotification[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cached?.items ?? [];
  }
  if (cached && cached.raw === raw) return cached.items;
  let items: CenterNotification[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed.filter(isCenterNotification);
    } catch {
      // Corrupt JSON: start empty; the next write replaces it.
    }
  }
  cached = { raw, items };
  return items;
}

function writeItems(items: CenterNotification[]): void {
  const next = items.slice(0, MAX_CENTER_NOTIFICATIONS);
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Storage full or unavailable: keep this window's copy in memory.
  }
  cached = { raw, items: next };
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Newest first; stable until the store changes (for `useSyncExternalStore`). */
export function centerNotificationsSnapshot(): CenterNotification[] {
  return readItems();
}

export function subscribeCenterNotifications(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function recordCenterNotification(input: CenterNotificationInput): void {
  const { key, at, ...rest } = input;
  const id = key ?? crypto.randomUUID();
  const entry: CenterNotification = { ...rest, id, at: at ?? Date.now(), read: false };
  writeItems([entry, ...readItems().filter((item) => item.id !== id)]);
}

export function dismissCenterNotification(id: string): void {
  const items = readItems();
  if (items.some((item) => item.id === id))
    writeItems(items.filter((item) => item.id !== id));
}

export function dismissAllCenterNotifications(): void {
  if (readItems().length > 0) writeItems([]);
}

export function markCenterNotificationsRead(): void {
  const items = readItems();
  if (items.some((item) => !item.read))
    writeItems(items.map((item) => (item.read ? item : { ...item, read: true })));
}

export const CENTER_KIND_LABEL: Record<CenterNotificationKind, string> = {
  finished: "Reply ready",
  approval: "Needs approval",
  question: "Has a question",
  automationSucceeded: "Automation finished",
  automationFailed: "Automation failed",
};

/** Records a finished automation run; cancelled runs are left out by callers. */
export function recordAutomationNotification(
  automation: { name: string; cwd: string; harness: HarnessId; model: string },
  status: "succeeded" | "failed",
  detail: { sessionId?: string; error?: string } = {},
): void {
  recordCenterNotification({
    kind: status === "succeeded" ? "automationSucceeded" : "automationFailed",
    title: automation.name,
    body:
      status === "succeeded"
        ? "Run finished."
        : detail.error
          ? `Run failed: ${detail.error}`
          : "Run failed.",
    cwd: automation.cwd,
    harness: automation.harness,
    model: automation.model,
    ...(detail.sessionId ? { sessionId: detail.sessionId } : {}),
  });
}
