import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { makeCommandId } from "@/features/connection/nativeLink";
import {
  failureNote,
  PANEL_ACTIONS,
  PANEL_CATEGORIES,
  panelCommand,
  type PanelCommand,
} from "./notificationActions";
import { readFeed } from "./notificationFeed";

/** Quiet: a failure note replaces the entry without a second sound. */
const RESULT_CHANNEL = "panel-results";
/** Taps already handled: Android can hand the same one over again at launch. */
const handled = new Set<string>();

let categories: Promise<void> | null = null;

/** Sets up the buttons once; the panel's posts wait for it (L-278). */
export function ensurePanelCategories(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  // Don't open Hari: the tap is handled where it is.
  const quiet = { opensAppToForeground: false };
  categories ??= Promise.all([
    Notifications.setNotificationCategoryAsync(PANEL_CATEGORIES.approval, [
      { identifier: PANEL_ACTIONS.approve, buttonTitle: "Approve", options: quiet },
      { identifier: PANEL_ACTIONS.deny, buttonTitle: "Deny", options: quiet },
    ]),
    Notifications.setNotificationCategoryAsync(PANEL_CATEGORIES.answer, [
      {
        identifier: PANEL_ACTIONS.answer,
        buttonTitle: "Answer",
        textInput: { submitButtonTitle: "Send", placeholder: "Your answer, or a choice's name" },
        options: quiet,
      },
    ]),
    Notifications.setNotificationCategoryAsync(PANEL_CATEGORIES.reply, [
      {
        identifier: PANEL_ACTIONS.reply,
        buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Message" },
        options: quiet,
      },
    ]),
    Notifications.setNotificationChannelAsync(RESULT_CHANNEL, {
      name: "Notification replies",
      importance: Notifications.AndroidImportance.LOW,
    }),
  ])
    .then(() => undefined)
    .catch((reason: unknown) => {
      categories = null;
      console.warn("Could not set up notification buttons", reason);
    });
  return categories;
}

/**
 * Fork (Hari, L-278): runs Approve, Deny, Answer and Reply taps from the
 * notification panel. A sent one leaves the panel and is read on the computer;
 * a failed one stays with a note saying why, buttons kept to try again.
 */
export function PanelActions(): null {
  const { command } = useConnection();
  const send = useRef(command);
  useEffect(() => {
    send.current = command;
  });

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void ensurePanelCategories();
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const { request } = response.notification;
      const action = panelCommand(request.content.data, response.actionIdentifier, response.userText);
      if (!action) return;
      const key = `${request.identifier}|${response.actionIdentifier}|${response.notification.date}|${response.userText ?? ""}`;
      if (handled.has(key)) return;
      handled.add(key);
      if (handled.size > 50) handled.delete(handled.values().next().value ?? key);
      void run(action, response.notification, send.current);
    });
    return () => subscription.remove();
  }, []);

  return null;
}

async function run(
  action: PanelCommand,
  notification: Notifications.Notification,
  command: ReturnType<typeof useConnection>["command"],
): Promise<void> {
  const { identifier, content } = notification.request;
  try {
    if (!action.ok) throw new Error(action.error);
    await command<unknown>(action.method, action.params, makeCommandId());
    await Notifications.dismissNotificationAsync(identifier).catch(() => {});
    const feedId: unknown = Reflect.get(content.data ?? {}, "feedId");
    if (typeof feedId === "string")
      await readFeed([feedId]).catch((reason: unknown) =>
        console.warn("Could not mark the notification read", reason),
      );
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    // Posting again under the same id also ends a reply box's spinner.
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: content.title ?? "MonoCode",
        ...(content.subtitle ? { subtitle: content.subtitle } : {}),
        body: failureNote(action.verb, message, Reflect.get(content.data ?? {}, "text")),
        data: content.data ?? {},
        ...(content.categoryIdentifier ? { categoryIdentifier: content.categoryIdentifier } : {}),
      },
      trigger: { channelId: RESULT_CHANNEL },
    }).catch((error: unknown) => console.warn("Could not show the failed reply", error));
  }
}
