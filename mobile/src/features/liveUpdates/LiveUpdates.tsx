import * as Notifications from "expo-notifications";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { makeCommandId } from "@/features/connection/nativeLink";
import { useLivePreferences } from "@/features/settings/liveUpdates";
import { useColors } from "@/ui/theme";
import {
  isRunning,
  liveCards,
  LOST_AFTER_MS,
  pressSettled,
  type LivePress,
} from "./liveCards";
import {
  liveAvailable,
  onLiveEvent,
  showLiveCards,
  type LiveEvent,
} from "./nativeLive";

/**
 * Fork (Hari, L-239): keeps the Live Update in step with the computer. While
 * a session runs, Android's service ticks every 15 seconds (and as the screen
 * comes on); with the app out of view, each tick asks the computer again.
 * The cards' Stop, Approve and Deny go to the computer as the app's own do.
 */
export function LiveUpdates() {
  const { connected, catalog, refresh, command } = useConnection();
  const [{ enabled, mode }, setPreferences] = useLivePreferences();
  // Fork (L-245): the card takes the app's accent.
  const accent = useColors().accent;
  // Moved on by each tick and button, to look at the sessions again.
  const [now, setNow] = useState(() => Date.now());
  const dismissed = useRef(new Set<string>());
  const pressed = useRef<Record<string, LivePress>>({});
  const everConnected = useRef(false);
  const lostSince = useRef<number | null>(null);
  const showing = useRef(false);
  const lostNotified = useRef(false);
  const handle = useRef<(event: LiveEvent) => void>(() => {});

  useEffect(() => {
    if (!liveAvailable) return;
    if (!enabled) {
      showing.current = false;
      showLiveCards([]);
      return;
    }
    const at = Math.max(now, Date.now());
    const sessions = catalog.sessions;
    // A swiped-away session shows again on its next run; a press shows
    // until the computer has done it.
    for (const id of [...dismissed.current])
      if (!sessions.some((session) => session.id === id && isRunning(session)))
        dismissed.current.delete(id);
    for (const [id, press] of Object.entries(pressed.current))
      if (pressSettled(press, sessions.find((session) => session.id === id), at))
        delete pressed.current[id];
    if (connected) {
      everConnected.current = true;
      lostSince.current = null;
      lostNotified.current = false;
    } else if (everConnected.current) {
      lostSince.current ??= at;
    }
    // The saved list from an earlier run may be stale: wait for the computer.
    if (!everConnected.current) {
      showLiveCards([]);
      return;
    }
    if (lostSince.current !== null && at - lostSince.current >= LOST_AFTER_MS) {
      if (showing.current && !lostNotified.current) {
        lostNotified.current = true;
        void Notifications.scheduleNotificationAsync({
          content: { title: "Hari", body: "Lost connection to your computer" },
          trigger: { channelId: "sessions" },
        });
      }
      showing.current = false;
      showLiveCards([]);
      return;
    }
    const cards = liveCards({
      sessions,
      projects: catalog.projects,
      mode,
      dismissed: dismissed.current,
      pressed: pressed.current,
      reconnecting: lostSince.current !== null,
    });
    showing.current = cards.length > 0;
    showLiveCards(cards, accent);
  }, [enabled, mode, connected, catalog, now, accent]);

  useEffect(() => {
    handle.current = (event) => {
      if (event.action === "tick") {
        if (AppState.currentState === "active") setNow(Date.now());
        else void refresh().finally(() => setNow(Date.now()));
        return;
      }
      if (event.action === "failed") {
        // Off until the user turns it on again, so a card the phone rejects
        // can't fail on every launch.
        setPreferences({ enabled: false });
        void Notifications.scheduleNotificationAsync({
          content: {
            title: "Live Updates turned off",
            // Fork (L-247): Android's reason, so a report can say what failed.
            body: `This phone couldn't show the running-session card${
              event.message ? ` (${event.message})` : ""
            }. You can turn it on again in Settings.`,
          },
          trigger: { channelId: "sessions" },
        });
        return;
      }
      if (event.action === "dismiss") {
        for (const id of event.sessionIds ?? []) dismissed.current.add(id);
        setNow(Date.now());
        return;
      }
      // Fork (L-279): Share's, handled by ShareSync.
      if (event.action === "shared") return;
      const session = catalog.sessions.find((entry) => entry.id === event.sessionId);
      if (!session) return;
      const stop = event.action === "stop";
      const verb = stop ? "stop" : event.action;
      const mark = (label: string, at: number) => {
        pressed.current[session.id] = stop
          ? { label, busy: true, at }
          : { label, requestId: event.requestId, at };
      };
      mark(stop ? "Stopping…" : event.action === "approve" ? "Approving…" : "Denying…", Date.now());
      setNow(Date.now());
      void command(
        stop ? "session.cancel" : "session.approve",
        stop
          ? { conversationId: session.id }
          : {
              conversationId: session.id,
              requestId: event.requestId,
              decision: event.action === "approve" ? "allow" : "deny",
            },
        makeCommandId(),
      )
        .then(() => refresh())
        .catch((reason: unknown) => {
          // Shown for about 15 seconds, then the buttons come back.
          const why = reason instanceof Error ? reason.message : String(reason);
          mark(`Couldn't ${verb}: ${why}`, Date.now() - 15_000);
        })
        .finally(() => setNow(Date.now()));
    };
  }, [catalog, command, refresh, setPreferences]);

  useEffect(() => {
    const subscription = onLiveEvent((event) => handle.current(event));
    return () => subscription?.remove();
  }, []);

  return null;
}
