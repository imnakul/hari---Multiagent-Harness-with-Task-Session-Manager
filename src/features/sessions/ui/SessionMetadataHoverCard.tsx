import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useMemo,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { PopoverSide } from "../../../shared/lib/popover";
import { Popover } from "../../../shared/ui/Popover";
import type { SessionMetadata } from "../model/sessionMetadata";
import { notesSummary, splitHeadingTag } from "../model/sessionMetadataAi";
import { AgentMarkdown } from "./AgentMarkdown";
import { useSessionHoverMetadata } from "./useSessionMetadata";

/** Hover intent: a pointer passing over a row of tabs opens nothing. */
const OPEN_DELAY_MS = 400;
/** Lets the pointer cross the gap into the card without closing it. */
const CLOSE_DELAY_MS = 120;

/** Newest Summary topics listed in the hover card; the rest are counted. */
const HOVER_TOPICS = 5;

/** A Summary heading with its bracketed kind as a faint tag (L-192). */
function TopicHeading({ heading }: { heading: string }): ReactNode {
  const { name, tag } = splitHeadingTag(heading);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate">{name}</span>
      {tag ? <span className="shrink-0 text-[11px] text-content/40">{tag}</span> : null}
    </span>
  );
}

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

/**
 * Label (accent), Left off and Summary headings of one chat (L-181, L-192).
 * `title` is the chat's own title, shown under the label so the chat stays
 * recognisable. The full Summary lives in the Session overview.
 */
export function SessionMetadataBody({
  metadata,
  title,
}: {
  metadata: SessionMetadata;
  title: string;
}): ReactNode {
  const summary = useMemo(() => notesSummary(metadata.notes), [metadata.notes]);
  const hasSummary = summary.leftOff !== null || summary.groups.length > 0;
  return (
    <>
      {metadata.label ? (
        <p className="break-words text-[13px] font-semibold leading-5 session-label-text">
          {metadata.label}
        </p>
      ) : null}
      {title && title !== metadata.label ? (
        <p
          className={`break-words leading-4 ${
            metadata.label
              ? "mt-0.5 text-[11px] text-content/50"
              : "text-[13px] font-semibold leading-5 text-content"
          }`}
        >
          {title}
        </p>
      ) : null}
      {hasSummary ? (
        <div className="mt-2 space-y-1.5 border-t border-stroke pt-2 text-[12px] leading-[18px]">
          {summary.leftOff ? (
            <div className="text-content/85">
              <p className="text-[11px] font-medium uppercase tracking-wide text-content/45">
                Left off
              </p>
              <AgentMarkdown text={summary.leftOff} hardBreaks />
            </div>
          ) : null}
          {summary.groups.length > 0 ? (
            <div className={summary.leftOff ? "pt-1" : undefined}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-content/45">
                Topics
              </p>
              <ul role="list" className="mt-0.5 space-y-0.5 text-content/75">
                {summary.groups.slice(0, HOVER_TOPICS).map((group, index) => (
                  <li key={index} className="flex min-w-0 items-baseline gap-2">
                    <span aria-hidden="true" className="shrink-0 text-content/35">
                      •
                    </span>
                    {group.heading ? (
                      <TopicHeading heading={group.heading} />
                    ) : (
                      <div className="line-clamp-3 min-w-0">
                        <AgentMarkdown text={group.body} hardBreaks />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {summary.groups.length > HOVER_TOPICS ? (
                <p className="mt-0.5 pl-4 text-[11px] text-content/45">
                  +{summary.groups.length - HOVER_TOPICS} more
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

type AnchorProps = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  "aria-describedby": string | undefined;
};

/**
 * Hover card for a chat's tab, pane header or classic card (L-181). When
 * "Show metadata on hover" is on and the chat has metadata, `active` is true:
 * spread `anchorProps` on the hovered element, drop its native `title`, and
 * render `card`. Otherwise `active` is false and the caller keeps its usual
 * hover. Pressing the anchor (click, drag) closes the card.
 */
export function useSessionMetadataHoverCard({
  sessionId,
  title,
  side = "bottom",
}: {
  sessionId: string | null | undefined;
  title: string;
  side?: PopoverSide;
}): { active: boolean; anchorProps: AnchorProps; card: ReactNode } {
  const metadata = useSessionHoverMetadata(sessionId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const id = useId();

  const clearTimers = useCallback(() => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);
  const scheduleOpen = (element: HTMLElement, delay: number): void => {
    clearTimers();
    setAnchor(element);
    openTimer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const scheduleClose = (): void => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  const keepOpen = (): void => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(() => clearTimers, [clearTimers]);
  // The setting turned off or the metadata was cleared while open.
  useEffect(() => {
    if (!metadata) close();
  }, [close, metadata]);
  useEffect(() => {
    if (!open || !anchor) return;
    const onScroll = (event: Event): void => {
      if (
        event.target === document ||
        (event.target instanceof Element && event.target.contains(anchor))
      )
        close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", close);
    };
  }, [anchor, close, open]);

  const anchorProps: AnchorProps = {
    onPointerEnter: (event) => {
      if (metadata && event.pointerType !== "touch")
        scheduleOpen(event.currentTarget, OPEN_DELAY_MS);
    },
    onPointerLeave: () => {
      if (metadata) scheduleClose();
    },
    onPointerDown: close,
    // Focus bubbles from a focusable child (a card's inner button) too.
    onFocus: (event) => {
      if (
        metadata &&
        event.target instanceof Element &&
        event.target.matches(":focus-visible")
      )
        scheduleOpen(event.currentTarget, 0);
    },
    onBlur: close,
    "aria-describedby": metadata && open ? id : undefined,
  };

  const card =
    metadata && open && anchor ? (
      <Popover
        anchor={anchor}
        side={side}
        align="start"
        gap={6}
        width={300}
        maxHeight={360}
        role="tooltip"
        id={id}
        onDismiss={close}
        onPointerEnter={keepOpen}
        onPointerLeave={scheduleClose}
        // React bubbles portal events to the anchor's tree: keep clicks in
        // the card (selecting text, a link) from opening or dragging the chat.
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
        onContextMenu={stopPropagation}
        className="overflow-y-auto overscroll-contain px-3 py-2.5"
      >
        <SessionMetadataBody metadata={metadata} title={title} />
      </Popover>
    ) : null;

  return { active: metadata !== null, anchorProps, card };
}

export type SessionMetadataHoverCard = ReturnType<
  typeof useSessionMetadataHoverCard
>;

/**
 * `useSessionMetadataHoverCard` for elements rendered in a list's `map`,
 * where a hook can't be called: `children` gets the hover and renders the
 * anchor, and the card renders after it.
 */
export function SessionMetadataHover({
  sessionId,
  title,
  side,
  children,
}: {
  sessionId: string | null | undefined;
  title: string;
  side?: PopoverSide;
  children: (hover: SessionMetadataHoverCard) => ReactNode;
}): ReactNode {
  const hover = useSessionMetadataHoverCard({ sessionId, title, side });
  return (
    <>
      {children(hover)}
      {hover.card}
    </>
  );
}
