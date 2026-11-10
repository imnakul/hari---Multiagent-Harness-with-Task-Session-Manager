import { useRef, useState, type ReactElement } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { Popover } from "../../../shared/ui/Popover";
import { Toggle } from "../../../shared/ui/Toggle";
import { ChevronDown, Copy, RefreshCw, Settings } from "../../../shared/ui/icons";
import {
  formatClock,
  notesMissing,
  saveAiNotesEnabled,
  type AgentStatus,
} from "../model/activity";

type Tone = "live" | "busy" | "warn" | "muted";

const DOT: Record<Tone, string> = {
  live: "bg-accent",
  busy: "bg-accent motion-safe:animate-pulse",
  warn: "bg-skill",
  muted: "bg-content/30",
};

function describe(status: AgentStatus | null): { label: string; tone: Tone; hint: string } {
  if (!status) return { label: "Checking…", tone: "muted", hint: "Checking the notes agent" };
  if (status.phase !== "off" && notesMissing(status)) {
    return {
      label: "No notes",
      tone: "warn",
      hint: "agy ran today but wrote no notes. Open this menu for the last run's output.",
    };
  }
  switch (status.phase) {
    case "off":
      return { label: "Off", tone: "muted", hint: "AI notes are turned off" };
    case "idle":
      return {
        label: "Live",
        tone: "live",
        hint: status.lastNoteAt
          ? `Last note at ${formatClock(status.lastNoteAt)}.`
          : "Waiting for your next prompt.",
      };
    case "queued":
      return { label: "Queued", tone: "busy", hint: "New activity; a note is coming up" };
    case "writing":
      return { label: "Writing…", tone: "busy", hint: "agy is writing a note" };
    case "backoff":
      return {
        label: status.retryAt ? `Retry ${formatClock(status.retryAt)}` : "Retrying",
        tone: "warn",
        hint: status.lastError ?? "The last note failed; retrying automatically",
      };
    case "paused":
      return { label: "Paused", tone: "warn", hint: status.lastError ?? "Notes need attention" };
  }
}

const ROW_BUTTON =
  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-content/75 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40";

/**
 * The header's agy status pill. Clicking it opens a small menu: AI notes on
 * or off, today's counts, what the last agy run returned (with Copy details),
 * Retry, and a link to the Activity settings.
 */
export function AgentStatusPill({
  status,
  aiNotes,
  onRetry,
  onOpenSettings,
}: {
  status: AgentStatus | null;
  aiNotes: boolean;
  onRetry: () => void;
  onOpenSettings?: () => void;
}): ReactElement {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { label, tone, hint } = describe(status);
  const today = status?.today;
  const lastRun = status?.lastRun;
  const canRetry =
    aiNotes &&
    (status?.phase === "paused" || status?.phase === "backoff" || lastRun?.ok === false);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`AI notes: ${label}. ${hint}`}
        title={hint}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-stroke px-2 text-[11px] leading-none text-content/70 transition-colors hover:bg-content/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <span aria-hidden className={`size-1.5 rounded-full ${DOT[tone]}`} />
        <span className="font-medium text-content/80">agy</span>
        <span role="status" aria-live="polite" className="text-content/50">
          {label}
        </span>
        <ChevronDown aria-hidden className="size-3 text-content/40" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="end"
          width={320}
          onDismiss={() => setOpen(false)}
        >
          <div role="dialog" aria-label="AI notes" className="flex flex-col gap-3 p-3 text-[12px]">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-content">AI notes</div>
                <p className="mt-0.5 leading-snug text-content/50">
                  Antigravity CLI writes a short note after each prompt or finished turn.
                </p>
              </div>
              <Toggle label="AI notes" on={aiNotes} onChange={saveAiNotesEnabled} />
            </div>

            <dl className="grid grid-cols-3 gap-2 rounded-md bg-content/[0.04] px-2.5 py-2 text-center">
              {(
                [
                  ["Notes", today?.notes ?? 0],
                  ["agy calls", today?.calls ?? 0],
                  ["Failed", today?.failures ?? 0],
                ] as const
              ).map(([name, value]) => (
                <div key={name}>
                  <dd className="text-[15px] font-semibold tabular-nums text-content">{value}</dd>
                  <dt className="text-[10.5px] text-content/45">{name} today</dt>
                </div>
              ))}
            </dl>

            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-content/45">
                Last agy run
              </div>
              {lastRun ? (
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${lastRun.ok ? "bg-accent" : "bg-skill"}`}
                  />
                  <p className="min-w-0 flex-1 break-words leading-snug text-content/75">
                    <span className="tabular-nums text-content/45">{formatClock(lastRun.at)} · </span>
                    {lastRun.summary}
                  </p>
                  <button
                    type="button"
                    className={ROW_BUTTON}
                    title="Copy exit code and the start of agy's output"
                    onClick={() => {
                      copyText(lastRun.output).then(
                        () => setCopied(true),
                        (err: unknown) => console.warn("activity: copy failed", err),
                      );
                    }}
                  >
                    <Copy className="size-3" strokeWidth={1.75} />
                    {copied ? "Copied" : "Copy details"}
                  </button>
                </div>
              ) : (
                <p className="text-content/45">
                  {aiNotes ? "agy has not run since Hari started." : "Notes are off."}
                </p>
              )}
              {status?.lastError && !lastRun?.ok ? (
                <p className="mt-1.5 break-words leading-snug text-content/55">{status.lastError}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-stroke pt-2">
              {onOpenSettings ? (
                <button
                  type="button"
                  className={ROW_BUTTON}
                  onClick={() => {
                    setOpen(false);
                    onOpenSettings();
                  }}
                >
                  <Settings className="size-3" strokeWidth={1.75} />
                  Activity settings
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={!canRetry}
                className={ROW_BUTTON}
                onClick={onRetry}
              >
                <RefreshCw className="size-3" strokeWidth={1.75} />
                Retry now
              </button>
            </div>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
