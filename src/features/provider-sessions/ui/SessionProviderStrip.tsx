import type { ReactElement } from "react";
import {
  RemoteControlButton,
  type RemoteControlControls,
} from "./RemoteControlButton";

export type SessionProviderStripProps = {
  /** Earlier-history status for a chat bound to a native conversation. */
  history?: {
    status: "error" | "ready";
    sourceLabel?: "Claude Code" | "Codex";
    message?: string;
    canShowEarlier: boolean;
    loadingEarlier: boolean;
    onShowEarlier: () => void;
    onRetry: () => void;
  };
  remoteControl?: RemoteControlControls;
};

/**
 * Slim strip above a session's transcript: the "older messages are not shown"
 * note for chats opened from a provider conversation, and the per-chat Claude
 * Remote Control chip. The chip shows the confirmed state; the menu changes the
 * saved choice. Neither touches a running turn.
 */
export function SessionProviderStrip({
  history,
  remoteControl,
}: SessionProviderStripProps): ReactElement | null {
  const showHistory =
    !!history &&
    (history.status === "error" ||
      history.canShowEarlier ||
      !!history.message ||
      !!history.sourceLabel);
  if (!showHistory && !remoteControl) return null;
  return (
    <div
      data-session-provider-strip
      className="flex min-h-7 shrink-0 items-center gap-2 px-3 py-1 text-[11px] text-content/55"
    >
      {showHistory && history ? (
        <p className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 truncate">
            {history.status === "error"
              ? `Earlier messages could not be loaded: ${history.message ?? "unknown error"}. You can still continue this conversation.`
              : history.message
                ? `Older messages could not be loaded: ${history.message}`
                : history.sourceLabel
                  ? `Native ${history.sourceLabel} history${history.canShowEarlier ? " · older messages not shown yet" : ""}`
                  : "Showing recent earlier messages."}
          </span>
          {history.status === "error" ? (
            <button
              type="button"
              onClick={history.onRetry}
              className="shrink-0 rounded px-1.5 py-0.5 text-content/70 hover:bg-content/10 hover:text-content"
            >
              Retry
            </button>
          ) : history.canShowEarlier ? (
            <button
              type="button"
              disabled={history.loadingEarlier}
              onClick={history.onShowEarlier}
              className="shrink-0 rounded px-1.5 py-0.5 text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-60"
            >
              {history.loadingEarlier ? "Loading…" : "Show earlier"}
            </button>
          ) : null}
        </p>
      ) : (
        <span className="flex-1" />
      )}
      {remoteControl ? <RemoteControlButton remoteControl={remoteControl} /> : null}
    </div>
  );
}
