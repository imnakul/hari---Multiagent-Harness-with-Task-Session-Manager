import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Block, HarnessId } from "../../sessions/model/session";
import {
  historyBlocks,
  isHistoryBlock,
  nativeHistoryStore,
  reconcileNativeHistory,
  trimHistoryBefore,
  type NativeHistoryState,
} from "../model/history";

export type NativeHistoryView = {
  /** Display-only conversation blocks (oldest first); empty when none. */
  blocks: Block[];
  transcriptBlocks: Block[];
  state: NativeHistoryState;
  showEarlier: () => void;
  retry: () => void;
};

/**
 * Read-only earlier history for a chat bound to a native Claude/Codex
 * conversation. Refreshes when the chat is shown; nothing here
 * writes MonoCode turns or reaches the provider.
 */
export function useNativeHistory(input: {
  sessionId: string;
  harness: HarnessId;
  providerAccountId?: string;
  enabled: boolean;
  /** Epoch ms of the chat's first MonoCode turn; earlier provider items only. */
  cutoffMs?: number;
  representedNativeIds?: ReadonlySet<string>;
  localBlocks?: Block[];
}): NativeHistoryView {
  const {
    sessionId,
    harness,
    providerAccountId,
    enabled,
    cutoffMs,
    representedNativeIds,
    localBlocks,
  } = input;
  const accountId = providerAccountId ?? "default";
  useSyncExternalStore(
    nativeHistoryStore.subscribe,
    nativeHistoryStore.getVersion,
    nativeHistoryStore.getVersion,
  );
  const state = nativeHistoryStore.get(sessionId);
  useEffect(() => {
    if (enabled)
      void nativeHistoryStore.ensureLoaded(
        sessionId,
        harness,
        accountId,
        nativeHistoryStore.get(sessionId).status !== "loading",
      );
  }, [enabled, sessionId, harness, accountId]);
  const transcriptBlocks = useMemo(() => {
    if (state.status !== "ready") return localBlocks ?? [];
    if (localBlocks)
      return reconcileNativeHistory(state.items.slice(-state.visible), localBlocks);
    const earlier = trimHistoryBefore(
      state.items,
      cutoffMs,
      representedNativeIds,
    );
    const items = earlier.slice(-state.visible);
    if (items.length === 0) return [];
    return historyBlocks(items);
  }, [state, cutoffMs, representedNativeIds, localBlocks]);
  const blocks = useMemo(
    () => transcriptBlocks.filter(isHistoryBlock),
    [transcriptBlocks],
  );
  return useMemo(
    () => ({
      blocks,
      transcriptBlocks,
      state,
      showEarlier: () => void nativeHistoryStore.showEarlier(sessionId),
      retry: () =>
        void nativeHistoryStore.ensureLoaded(
          sessionId,
          harness,
          accountId,
          true,
        ),
    }),
    [blocks, transcriptBlocks, state, sessionId, harness, accountId],
  );
}
