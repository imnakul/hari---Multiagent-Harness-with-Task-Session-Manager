import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { shareBubble, type ShareBubbleState } from "@/features/liveUpdates/nativeLive";

const OFF: ShareBubbleState = { enabled: false, permitted: false };

/**
 * Fork (Hari, L-321): the Share bubble's switch. Turning it on without
 * "Display over other apps" opens that system page; back in Hari, the bubble
 * starts once it's allowed. `accent` tints the bubble.
 */
export function useShareBubble(accent: string): [ShareBubbleState, (on: boolean) => void] {
  const [state, setState] = useState<ShareBubbleState>(() => shareBubble?.state() ?? OFF);

  useEffect(() => {
    if (!shareBubble) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setState(shareBubble?.state() ?? OFF);
    });
    return () => subscription.remove();
  }, []);

  // On (and allowed): running, in the current accent.
  useEffect(() => {
    if (state.enabled && state.permitted) shareBubble?.set(true, accent);
  }, [state.enabled, state.permitted, accent]);

  const turn = useCallback(
    (on: boolean) => {
      if (!shareBubble) return;
      const done = shareBubble.set(on, accent);
      setState(shareBubble.state());
      if (on && !done) shareBubble.openSettings();
    },
    [accent],
  );

  return [state, turn];
}
