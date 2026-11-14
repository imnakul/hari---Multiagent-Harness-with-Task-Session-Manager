/**
 * Fork (Hari, L-275): the title-bar bell's history as the phone sees it, and
 * the phone's changes to it. The phone posts each new entry in Android's
 * notification panel and lists them on its Notifications screen; dismissing
 * or reading one there changes the bell too.
 */
import { projectName } from "../../../shared/lib/paths";
import {
  dismissAllCenterNotifications,
  dismissCenterNotifications,
  markCenterNotificationsRead,
  type CenterNotification,
  type CenterNotificationKind,
} from "../../notifications/model/notificationCenter";
import { mobileProjectId } from "./mobileWorkspace";

export type MobileNotification = {
  id: string;
  kind: CenterNotificationKind;
  /** Chat or automation name. */
  title: string;
  body: string;
  at: number;
  read: boolean;
  /** The chat it opens, with the phone's id for its project. */
  sessionId?: string;
  projectId?: string;
  projectName?: string;
  /** Recorded while the chat was open on the computer (hidden from the bell). */
  seenOnDesktop?: boolean;
};

export type MobileNotificationAction =
  | { action: "dismiss"; ids: string[] }
  | { action: "read"; ids?: string[] }
  | { action: "clear" };

/** The bell's entries for the phone, newest first as stored. */
export function mobileNotificationFeed(
  items: readonly CenterNotification[],
): MobileNotification[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    at: item.at,
    read: item.read,
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.cwd
      ? { projectId: mobileProjectId(item.cwd), projectName: projectName(item.cwd) }
      : {}),
    ...(item.seenOnDesktop ? { seenOnDesktop: true } : {}),
  }));
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((id): id is string => typeof id === "string" && id.length > 0);
  return list.length === value.length ? list : null;
}

/** The phone's change as the desktop relays it; null for anything else. */
export function parseMobileNotificationAction(value: unknown): MobileNotificationAction | null {
  if (typeof value !== "object" || value === null) return null;
  const action: unknown = Reflect.get(value, "action");
  if (action === "clear") return { action };
  if (action === "dismiss") {
    const list = ids(Reflect.get(value, "ids"));
    return list ? { action, ids: list } : null;
  }
  if (action === "read") {
    const raw: unknown = Reflect.get(value, "ids");
    if (raw === undefined || raw === null) return { action };
    const list = ids(raw);
    return list ? { action, ids: list } : null;
  }
  return null;
}

/** Applies the phone's change to the bell's history (shared by every window). */
export function applyMobileNotificationAction(change: MobileNotificationAction): void {
  if (change.action === "clear") dismissAllCenterNotifications();
  else if (change.action === "dismiss") dismissCenterNotifications(change.ids);
  else markCenterNotificationsRead(change.ids);
}
