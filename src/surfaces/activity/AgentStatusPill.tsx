import type { ReactElement } from "react";
import { formatClock, type AgentStatus } from "../../lib/activity";

type Tone = "live" | "busy" | "warn" | "muted";

const DOT: Record<Tone, string> = {
  live: "bg-accent",
  busy: "bg-accent zen-thinking-pulse",
  warn: "bg-skill",
  muted: "bg-content/30",
};

function describe(status: AgentStatus | null): { label: string; tone: Tone; hint: string } {
  if (!status) return { label: "Checking…", tone: "muted", hint: "Checking the notes agent" };
  switch (status.phase) {
    case "off":
      return { label: "Notes off", tone: "muted", hint: "AI notes are turned off" };
    case "idle":
      return {
        label: "Live",
        tone: "live",
        hint: status.lastNoteAt
          ? `Antigravity notes are on. Last note at ${formatClock(status.lastNoteAt)}.`
          : "Antigravity notes are on and waiting for your next prompt.",
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

/** Compact live status of the Antigravity notes worker for the header. */
export function AgentStatusPill({ status }: { status: AgentStatus | null }): ReactElement {
  const { label, tone, hint } = describe(status);
  return (
    <span
      role="status"
      aria-live="polite"
      title={hint}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-content/10 px-2 text-[11px] leading-none text-content/70"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[tone]}`} />
      <span className="font-medium text-content/80">agy</span>
      <span className="text-content/50">{label}</span>
    </span>
  );
}
