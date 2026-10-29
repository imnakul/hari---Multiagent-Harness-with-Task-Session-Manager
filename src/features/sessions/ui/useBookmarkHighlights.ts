import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { sessionPanelSnapshot, subscribeSessionPanel } from "../model/sessionPanel";
import {
  BOOKMARK_HIGHLIGHT,
  findTextRange,
  paintSharedHighlight,
} from "../model/transcriptHighlights";

const NONE = () => () => {};

/**
 * Tints text bookmarked from a selection in the chat with the accent colour
 * (fork, L-192). Bookmarks of a whole reply have no quote and stay plain.
 * Repaints when the transcript changes, since replies render and unmount as
 * the chat scrolls.
 */
export function useBookmarkHighlights(
  scroller: HTMLElement | null,
  sessionId: string | undefined,
  visible: boolean,
): void {
  const subscribe = useCallback(
    (listener: () => void) => (sessionId ? subscribeSessionPanel(sessionId, listener) : NONE()),
    [sessionId],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (sessionId ? sessionPanelSnapshot(sessionId) : null),
    () => null,
  );
  const quotes = useMemo(
    () =>
      (entry?.data.bookmarks ?? []).flatMap((bookmark) =>
        bookmark.quote ? [{ blockId: bookmark.blockId, quote: bookmark.quote }] : [],
      ),
    [entry],
  );

  useEffect(() => {
    if (!scroller || !visible || quotes.length === 0) return;
    const owner = Symbol("bookmark-quotes");
    const paint = () => {
      const ranges: Range[] = [];
      for (const { blockId, quote } of quotes)
        for (const reply of scroller.querySelectorAll<HTMLElement>(
          `[data-selectable-agent-response="${CSS.escape(blockId)}"]`,
        )) {
          const range = findTextRange(reply, quote);
          if (range) {
            ranges.push(range);
            break;
          }
        }
      paintSharedHighlight(BOOKMARK_HIGHLIGHT, owner, ranges);
    };
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    });
    observer.observe(scroller, { childList: true, characterData: true, subtree: true });
    paint();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      paintSharedHighlight(BOOKMARK_HIGHLIGHT, owner, []);
    };
  }, [scroller, visible, quotes]);
}
