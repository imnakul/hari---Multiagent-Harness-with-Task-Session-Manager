import { newTabClick } from "../../settings/model/openingBehavior";
import type { MouseEvent, ReactNode } from "react";
import { projectName } from "../../../shared/lib/paths";
import {
  Check,
  CircleAlert,
  GitBranch,
  Pencil,
  Play,
  Square,
  X,
  Zap,
} from "../../../shared/ui/icons";
import { RemoteControlIndicator } from "../../provider-sessions/ui/RemoteControlIndicator";
import { isHarnessId, resolveModel } from "../../sessions/model/models";
import {
  sessionDisplayTitle,
  type HarnessId,
} from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { formatRelative } from "../../sessions/ui/SessionCard";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import {
  boardCardTag,
  type BoardCard,
  type BoardLane,
  type BoardTagTone,
} from "../sessionBoard";

const TAG_TONE: Record<BoardTagTone, string> = {
  draft: "text-content/50",
  working: "text-accent",
  attention: "text-amber-400",
  done: "text-emerald-400",
  muted: "text-content/50",
};

const iconAction =
  "relative inline-flex size-6 items-center justify-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/12 hover:text-content focus-visible:bg-content/12 focus-visible:text-content focus-visible:outline-none disabled:opacity-40";

/** Unsent Todo drafts can be started, edited or deleted from the board. */
export function isDraftTodo(card: BoardCard): boolean {
  return card.status === "todo" && card.runId.startsWith("draft:");
}

/**
 * One Session Manager card. Live lanes use three lines (title and time,
 * where it runs, model and state) plus an inset reason when a run needs you;
 * finished runs collapse to two lines. Hover or keyboard focus swaps the time
 * for the card's actions in the same slot, so nothing overlaps.
 */
export function BoardSessionCard({
  card,
  lane,
  now,
  preserveHover,
  busy,
  onOpen,
  onStart,
  onEdit,
  onDelete,
  onRemove,
  remoteControl = false,
}: {
  card: BoardCard;
  lane: BoardLane;
  now: number;
  /** Keep the gliding hover on the card whose session is open beside the board. */
  preserveHover: boolean;
  busy: boolean;
  /** `newTab`: the Shift/Alt new-tab click (see `newTabClick`). */
  onOpen: (newTab: boolean) => void;
  onStart?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRemove: () => void;
  /** Remote Control is turned on for this chat. */
  remoteControl?: boolean;
}): ReactNode {
  const harness = isHarnessId(card.harness) ? card.harness : null;
  // Same labels as the session list: no "Provider · " title prefix, and the
  // model's display name rather than its raw provider id.
  const title = harness ? sessionDisplayTitle(card.title, harness) : card.title;
  const model = boardModelLabel(harness, card.model);
  const draft = isDraftTodo(card);
  const finished = lane === "done";
  const tag = boardCardTag(card);
  const time = formatRelative(card.updatedAt, now);
  const project = projectName(card.cwd);
  const showReason = lane === "needs_attention" && Boolean(card.reason);
  const canDelete = draft && Boolean(onDelete);
  const actions: ReactNode[] = [];
  if (draft && onStart)
    actions.push(
      <button
        key="start"
        type="button"
        disabled={busy}
        aria-label={`Start ${title}`}
        title="Start"
        onClick={onStart}
        className={iconAction}
      >
        <Play aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>,
    );
  if (draft && onStart && onEdit)
    actions.push(
      <button
        key="edit"
        type="button"
        disabled={busy}
        aria-label={`Edit ${title}`}
        title="Edit"
        onClick={onEdit}
        className={iconAction}
      >
        <Pencil aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>,
    );
  actions.push(
    <button
      key="remove"
      type="button"
      disabled={busy}
      aria-label={
        canDelete ? `Delete Todo ${title}` : `Remove ${title} from board`
      }
      title={canDelete ? "Delete draft" : "Remove from board"}
      onClick={canDelete ? onDelete : onRemove}
      className={`${iconAction} hover:text-red-400`}
    >
      <X aria-hidden className="size-3.5" strokeWidth={1.75} />
    </button>,
  );

  // The whole card opens the session; its own buttons act alone.
  const openFromCard = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button"))
      return;
    onOpen(newTabClick(event));
  };

  return (
    <div
      data-board-card={card.sessionId}
      data-board-lane={lane}
      data-shared-hover-item
      data-shared-hover-preserve={preserveHover ? "" : undefined}
      onClick={openFromCard}
      className="surface-tint group/board-card relative mb-1.5 flex cursor-default flex-col gap-1 rounded-md px-2.5 py-2 transition-colors duration-100"
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          data-session-card={card.sessionId}
          title={title}
          onClick={(event) => onOpen(newTabClick(event))}
          className="line-clamp-2 min-w-0 flex-1 rounded-sm text-left text-[13px] font-medium leading-[18px] text-content outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        >
          {title}
        </button>
        {/* Time and actions share one grid cell: the slot keeps its width. */}
        <div
          className={`-my-0.5 grid shrink-0 justify-items-end ${
            actions.length > 1 ? "min-w-[72px]" : "min-w-11"
          }`}
        >
          <span
            className="col-start-1 row-start-1 self-center text-[11px] tabular-nums text-content/45 transition-opacity duration-100 group-focus-within/board-card:opacity-0 group-hover/board-card:opacity-0"
            aria-hidden={!time}
          >
            {time}
          </span>
          <div className="col-start-1 row-start-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-focus-within/board-card:opacity-100 group-hover/board-card:opacity-100">
            {actions}
          </div>
        </div>
      </div>
      {finished ? null : (
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-content/50">
          <span className="min-w-0 truncate" title={card.cwd}>
            {project}
          </span>
          {card.branch ? (
            <>
              <span aria-hidden className="text-content/30">
                ·
              </span>
              <span
                className="flex min-w-0 items-center gap-1"
                title={card.branch}
              >
                <GitBranch
                  aria-hidden
                  className="size-3 shrink-0"
                  strokeWidth={1.75}
                />
                <span className="truncate">{card.branch}</span>
              </span>
            </>
          ) : null}
          {card.queuedCount ? (
            <>
              <span aria-hidden className="text-content/30">
                ·
              </span>
              <span className="shrink-0 tabular-nums">
                {card.queuedCount} queued
              </span>
            </>
          ) : null}
        </p>
      )}
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        {finished ? (
          <span className="min-w-0 truncate text-content/50">
            <span title={card.cwd}>{project}</span>
            <span aria-hidden className="text-content/30">
              {" · "}
            </span>
            {model}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-content/55">
            {harness ? (
              <HarnessIcon harness={harness} className="size-3 shrink-0" />
            ) : null}
            <span className="truncate" title={card.model}>
              {model}
            </span>
          </span>
        )}
        {card.automation && lane === "in_progress" ? (
          <span
            role="img"
            aria-label="Automation run"
            title="Automation run"
            className="inline-flex shrink-0 text-accent"
          >
            <Zap aria-hidden className="size-3" strokeWidth={1.75} />
          </span>
        ) : null}
        {remoteControl && !finished ? <RemoteControlIndicator /> : null}
        <BoardCardTag
          label={tag.label}
          tone={tag.tone}
          title={showReason ? undefined : card.reason}
        />
      </div>
      {showReason ? (
        <p
          title={card.reason}
          className="line-clamp-2 rounded-sm border-l-2 border-amber-400/50 bg-amber-400/8 px-2 py-1 text-[11px] leading-4 text-content/70"
        >
          {card.reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Display name for a stored model. Cards usually store the name already; a raw
 * provider id ("opencode:opencode/space-bunny-free") resolves through the
 * catalog only on an exact match, otherwise its last segment is shown, so an
 * unknown id never borrows another model's name.
 */
export function boardModelLabel(
  harness: HarnessId | null,
  stored: string,
): string {
  if (!stored.includes(":")) return stored;
  if (harness) {
    const resolved = resolveModel(harness, stored);
    if (resolved.id === stored) return resolved.name;
  }
  return (
    stored.slice(
      Math.max(stored.lastIndexOf("/"), stored.lastIndexOf(":")) + 1,
    ) || stored
  );
}

export function BoardCardTag({
  label,
  tone,
  title,
}: {
  label: string;
  tone: BoardTagTone;
  title?: string;
}): ReactNode {
  return (
    <span
      data-board-tag={label}
      title={title}
      className={`ml-auto flex shrink-0 items-center gap-1 tabular-nums ${TAG_TONE[tone]}`}
    >
      {tone === "working" && label === "Working…" ? (
        <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none" />
      ) : tone === "attention" ? (
        <CircleAlert aria-hidden className="size-3" strokeWidth={1.75} />
      ) : tone === "done" ? (
        <Check aria-hidden className="size-3" strokeWidth={2.25} />
      ) : tone === "muted" ? (
        <Square aria-hidden className="size-2.5" strokeWidth={2} />
      ) : null}
      {label}
    </span>
  );
}
