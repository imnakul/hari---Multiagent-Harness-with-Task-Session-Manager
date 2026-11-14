import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { linkStreamLive, onLinkSignal } from "@/features/link/linkStream";
import { onLiveEvent, setLiveWatching } from "@/features/liveUpdates/nativeLive";
import { readFeedPreferences, useFeedPreferences } from "@/features/settings/notificationFeed";
import {
  useNotificationPreferences,
  type NotificationCategory,
} from "@/features/settings/notifications";
import {
  connectFeed,
  feedState,
  loadFeedRecord,
  panelId,
  parseFeed,
  planPanel,
  saveFeedRecord,
  setFeedState,
  type FeedItem,
} from "./notificationFeed";

/** How often the list is asked for while Hari is on screen. */
const POLL_MS = 5_000;
/** Fork (L-277): with the event stream open the list arrives by itself; ask
 *  this rarely, in case a change was missed. */
const STREAM_POLL_MS = 60_000;
const SESSION_CHANNEL = "sessions";

const category = (item: FeedItem): NotificationCategory | "automations" =>
  item.kind === "finished"
    ? "agentFinished"
    : item.kind === "approval" || item.kind === "question"
      ? "agentInput"
      : "automations";

/**
 * Fork (Hari, L-275): keeps the phone's copy of the desktop bell's history.
 * With the event stream open (L-277) the computer pushes the list as it
 * changes, and the asking below slows to a once-a-minute check.
 * Asks for it every 5 seconds on screen, and on each tick of the background
 * service (every 15 seconds, and as the screen comes on) while "Keep watching
 * in the background" holds the service on. Each new unread entry the user
 * wants goes to Android's notification panel; one read or removed on either
 * side leaves it.
 */
export function NotificationFeedSync() {
  const { pairing, connected, command } = useConnection();
  const [{ watch }] = useFeedPreferences();
  const categories = useNotificationPreferences();
  const enabled = useRef(categories.enabled);
  useEffect(() => {
    enabled.current = categories.enabled;
  });
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  const busy = useRef(false);
  const lastFetch = useRef(0);

  // Android stops the service with the app swiped away only if the user lets it.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const on = watch && fingerprint !== null;
    setLiveWatching(on);
    if (!on) return;
    // Opening Hari starts it again if Android stopped it meanwhile.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setLiveWatching(true);
    });
    return () => subscription.remove();
  }, [watch, fingerprint]);

  const post = useCallback(async (desktop: string, items: FeedItem[]) => {
    if (Platform.OS !== "android") return;
    const preferences = readFeedPreferences();
    const plan = planPanel(items, loadFeedRecord(desktop), (item) => {
      if (item.seenOnDesktop && !preferences.seenOnDesktop) return false;
      const kind = category(item);
      return kind === "automations" ? preferences.automations : enabled.current(kind);
    });
    saveFeedRecord(desktop, plan.record);
    for (const id of plan.withdraw)
      void Notifications.dismissNotificationAsync(panelId(id)).catch(() => {});
    // Oldest first, so the newest lands on top of the panel.
    for (const item of [...plan.post].reverse()) {
      await Notifications.scheduleNotificationAsync({
        identifier: panelId(item.id),
        content: {
          title: item.title || "MonoCode",
          ...(item.projectName ? { subtitle: item.projectName } : {}),
          body: item.body,
          data: {
            feedId: item.id,
            ...(item.projectId && item.sessionId
              ? { projectId: item.projectId, sessionId: item.sessionId }
              : {}),
          },
        },
        trigger: { channelId: SESSION_CHANNEL },
      });
    }
  }, []);

  const take = useCallback(
    async (desktop: string, answer: unknown) => {
      const parsed = parseFeed(answer);
      if (!parsed) throw new Error("The computer sent notifications Hari can't read");
      lastFetch.current = Date.now();
      if (!parsed.available) {
        setFeedState({ phase: "waiting" });
        return;
      }
      setFeedState({ phase: "ready", items: parsed.items, error: null });
      await post(desktop, parsed.items);
    },
    [post],
  );

  const fetchFeed = useCallback(async () => {
    if (!fingerprint || busy.current) return;
    busy.current = true;
    try {
      await take(fingerprint, await command<unknown>("notifications.list"));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const current = feedState();
      if (message.includes("Unsupported mobile operation")) setFeedState({ phase: "unsupported" });
      else if (current.phase === "ready") setFeedState({ ...current, error: message });
      else setFeedState({ phase: "loading", error: message });
    } finally {
      busy.current = false;
    }
  }, [fingerprint, command, take]);

  // Fork (L-277): the computer pushes the list on the event stream as it changes.
  useEffect(() => {
    if (!fingerprint) return;
    return onLinkSignal("notifications", (payload) => {
      void take(fingerprint, payload).catch((reason: unknown) => {
        console.warn("Notifications from the stream", reason);
      });
    });
  }, [fingerprint, take]);

  useEffect(() => {
    if (!fingerprint) {
      connectFeed(null, null);
      return;
    }
    connectFeed(
      (method, params) => command<unknown>(method, params),
      fetchFeed,
    );
    return () => connectFeed(null, null);
  }, [fingerprint, command, fetchFeed]);

  // On screen: every few seconds, and as Hari comes back.
  useEffect(() => {
    if (!fingerprint || !connected) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = (state: string) => {
      clearInterval(timer);
      if (state !== "active") return;
      void fetchFeed();
      timer = setInterval(() => {
        if (linkStreamLive() && Date.now() - lastFetch.current < STREAM_POLL_MS) return;
        void fetchFeed();
      }, POLL_MS);
    };
    poll(AppState.currentState);
    const subscription = AppState.addEventListener("change", poll);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [fingerprint, connected, fetchFeed]);

  // Out of view: the background service's tick (timers don't run then).
  useEffect(() => {
    const subscription = onLiveEvent((event) => {
      if (event.action !== "tick" || AppState.currentState === "active") return;
      // The stream brings changes while it is open; the tick is the fallback.
      if (linkStreamLive() && Date.now() - lastFetch.current < STREAM_POLL_MS) return;
      void fetchFeed();
    });
    return () => subscription?.remove();
  }, [fetchFeed]);

  return null;
}
