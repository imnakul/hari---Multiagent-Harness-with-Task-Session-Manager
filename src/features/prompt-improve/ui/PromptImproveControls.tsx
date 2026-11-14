import { useEffect, useRef, type ReactNode } from "react";
import {
  Check,
  FilePlus,
  LoaderCircle,
  Sparkles,
  Square,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import { improveShortcutLabel, type PromptImprove } from "./usePromptImprove";

/** How long Original must be held before it peeks instead of switching. */
const HOLD_TO_PEEK_MS = 220;

const STRIP_BUTTON =
  "inline-flex h-5.5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-content/65 outline-none transition-[transform,background-color,color] duration-150 hover:bg-selection-hover hover:text-content focus-visible:ring-1 focus-visible:ring-accent active:scale-96 disabled:pointer-events-none disabled:opacity-40";

/** ✨ beside Send: starts a rewrite; while one runs it becomes Stop. */
export function ImprovePromptButton({
  improve,
}: {
  improve: PromptImprove;
}): ReactNode {
  if (!improve.visible) return null;
  const shortcut = improveShortcutLabel();
  const label = improve.running
    ? "Stop improving and keep your text (Esc)"
    : (improve.blockReason ??
      (shortcut ? `Improve prompt (${shortcut})` : "Improve prompt"));
  return (
    <button
      type="button"
      title={label}
      aria-label={improve.running ? "Stop improving" : "Improve prompt"}
      aria-busy={improve.running || undefined}
      disabled={!improve.running && improve.blockReason !== null}
      // Keep the caret in the composer.
      onMouseDown={(event) => event.preventDefault()}
      onClick={improve.trigger}
      className={`relative grid size-6.5 shrink-0 place-items-center rounded-md outline-none transition-[transform,background-color,color] duration-150 focus-visible:ring-1 focus-visible:ring-accent active:scale-96 disabled:opacity-40 disabled:active:scale-100 ${
        improve.running
          ? "bg-selection-emphasis text-content"
          : "text-content/50 hover:bg-selection-hover hover:text-content disabled:hover:bg-transparent disabled:hover:text-content/50"
      }`}
    >
      <Sparkles
        aria-hidden
        strokeWidth={1.7}
        className={`col-start-1 row-start-1 size-3.5 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          improve.running ? "scale-25 opacity-0" : "scale-100 opacity-100"
        }`}
      />
      <LoaderCircle
        aria-hidden
        strokeWidth={1.7}
        className={`col-start-1 row-start-1 size-3.5 transition-opacity duration-200 motion-safe:animate-spin ${
          improve.running ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Stop inside the spinner, like Send while a turn runs. */}
      <Square
        aria-hidden
        strokeWidth={0}
        className={`col-start-1 row-start-1 size-1.5 fill-current transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          improve.running ? "scale-100 opacity-100" : "scale-25 opacity-0"
        }`}
      />
    </button>
  );
}

/** Original: click switches versions; press and hold shows the other one. */
function OriginalToggle({
  improve,
  showing,
}: {
  improve: PromptImprove;
  showing: "rewrite" | "original";
}): ReactNode {
  const timerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const suppressClickRef = useRef(false);
  const { setPeeking } = improve;

  const stopHold = (): boolean => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const held = heldRef.current;
    heldRef.current = false;
    if (held) setPeeking(false);
    return held;
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      aria-pressed={showing === "original"}
      title={
        showing === "rewrite"
          ? "Switch to your original (hold to peek)"
          : "Switch back to the rewrite (hold to peek)"
      }
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        stopHold();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          heldRef.current = true;
          setPeeking(true);
        }, HOLD_TO_PEEK_MS);
      }}
      onPointerUp={() => {
        // A hold only peeks; the click that follows it must not switch.
        suppressClickRef.current = stopHold();
      }}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        improve.toggleOriginal();
      }}
      className={`${STRIP_BUTTON} ${showing === "original" ? "bg-selection text-content" : ""}`}
    >
      {showing === "rewrite" ? "Original" : "Rewrite"}
    </button>
  );
}

function DismissButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`${STRIP_BUTTON} ml-auto px-1`}
    >
      <X aria-hidden className="size-3" strokeWidth={1.8} />
    </button>
  );
}

function RuleStrip({ improve }: { improve: PromptImprove }): ReactNode {
  const offer = improve.ruleOffer;
  if (!offer) return null;
  if (offer.kind === "done" || offer.kind === "error") {
    return (
      <p
        role={offer.kind === "error" ? "alert" : "status"}
        className={`flex items-center gap-1.5 px-3 pt-2 text-[11px] ${
          offer.kind === "error" ? "text-red-400" : "text-content/60"
        }`}
      >
        {offer.kind === "done" ? (
          <Check aria-hidden className="size-3" strokeWidth={1.8} />
        ) : null}
        {offer.message}
      </p>
    );
  }
  const adding = offer.kind === "adding";
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-2 text-[11px] text-content/60">
      <span className="min-w-0 flex-1 basis-48 truncate" title={offer.rule}>
        You keep asking for:{" "}
        <span className="text-content/85">{offer.rule}</span>
      </span>
      <button
        type="button"
        disabled={adding}
        onMouseDown={(event) => event.preventDefault()}
        onClick={improve.addRule}
        className={`${STRIP_BUTTON} text-content/80`}
      >
        {adding ? (
          <LoaderCircle
            aria-hidden
            className="size-3 motion-safe:animate-spin"
            strokeWidth={1.8}
          />
        ) : (
          <FilePlus aria-hidden className="size-3" strokeWidth={1.8} />
        )}
        Add to AGENTS.md
      </button>
      <button
        type="button"
        disabled={adding}
        onMouseDown={(event) => event.preventDefault()}
        onClick={improve.snoozeRule}
        className={STRIP_BUTTON}
      >
        Not now
      </button>
      <button
        type="button"
        disabled={adding}
        onMouseDown={(event) => event.preventDefault()}
        onClick={improve.neverRule}
        className={STRIP_BUTTON}
      >
        Never
      </button>
    </div>
  );
}

/** The row above the text: what the rewrite did and how to undo it. */
export function ImprovePromptStrip({
  improve,
}: {
  improve: PromptImprove;
}): ReactNode {
  if (!improve.visible) return null;
  const { view } = improve;
  let row: ReactNode = null;
  if (view.kind === "running") {
    row = (
      // `data-dialog-popover`: a surrounding Modal leaves Escape to the
      // composer while a rewrite runs, so Esc cancels it instead of closing.
      <div
        role="status"
        data-dialog-popover
        className="flex items-center gap-1.5 px-3 pt-2 text-[11px] text-content/55"
      >
        <Sparkles aria-hidden className="size-3" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">Improving your prompt…</span>
        <button
          type="button"
          title="Stop and keep your text (Esc)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => improve.cancel()}
          className={`${STRIP_BUTTON} text-content/80`}
        >
          <Square aria-hidden className="size-2 fill-current" strokeWidth={0} />
          Stop
        </button>
      </div>
    );
  } else if (view.kind === "failed") {
    row = (
      <div className="flex items-center gap-1 px-3 pt-2">
        <p role="alert" className="min-w-0 flex-1 text-[11px] text-red-400">
          {view.message}
        </p>
        <DismissButton onClick={improve.dismiss} label="Dismiss" />
      </div>
    );
  } else if (view.kind === "applied") {
    row = (
      <div
        role="status"
        className="flex items-center gap-1 px-3 pt-2 text-[11px] text-content/55"
      >
        <Sparkles aria-hidden className="size-3 shrink-0" strokeWidth={1.7} />
        <span
          className="mr-1 truncate"
          title={
            view.showing === "rewrite" && view.fallbackReason
              ? `Used ${view.helper} because ${view.fallbackReason}.`
              : undefined
          }
        >
          {view.showing === "rewrite"
            ? `Rewritten by ${view.helper}${view.fallbackReason ? ` · ${view.fallbackReason}` : ""}`
            : "Showing your original"}
        </span>
        <OriginalToggle improve={improve} showing={view.showing} />
        <button
          type="button"
          title="Put your first draft back and close this"
          onMouseDown={(event) => event.preventDefault()}
          onClick={improve.restoreOriginal}
          className={STRIP_BUTTON}
        >
          <Undo2 aria-hidden className="size-3" strokeWidth={1.8} />
          Restore original
        </button>
        <DismissButton
          onClick={improve.dismiss}
          label="Keep this text and close"
        />
      </div>
    );
  } else if (view.kind === "stale") {
    row = (
      <div
        role="status"
        className="flex items-center gap-1 px-3 pt-2 text-[11px] text-content/55"
      >
        <Sparkles aria-hidden className="size-3 shrink-0" strokeWidth={1.7} />
        <span className="mr-1 truncate">
          Rewrite ready. You kept typing, so your text stayed.
        </span>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={improve.acceptRewrite}
          className={`${STRIP_BUTTON} text-content/80`}
        >
          Use rewrite
        </button>
        <DismissButton onClick={improve.dismiss} label="Discard the rewrite" />
      </div>
    );
  }
  return (
    <>
      {row}
      <RuleStrip improve={improve} />
    </>
  );
}
