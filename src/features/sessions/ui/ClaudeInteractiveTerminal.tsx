import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FitAddon } from "@xterm/addon-fit";
import {
  interactiveTerminalFor,
  interactiveTerminalRevision,
  subscribeInteractiveTerminals,
} from "../../../integrations/harness/providers/claude/claudeInteractiveTerminal";
import {
  releaseInteractiveApprovals,
  stopInteractiveClaude,
} from "../../../integrations/harness/providers/claude/claudeInteractive";
import "@xterm/xterm/css/xterm.css";

/** Attaches a view to the adapter's terminal. It never spawns or kills a process. */
export function ClaudeInteractiveTerminal({
  sessionId,
}: {
  sessionId: string;
}): React.JSX.Element {
  useSyncExternalStore(
    subscribeInteractiveTerminals,
    interactiveTerminalRevision,
  );
  const terminal = interactiveTerminalFor(sessionId);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!terminal || !element) return;
    if (terminal.term.element) element.appendChild(terminal.term.element);
    else terminal.term.open(element);
    const fit = new FitAddon();
    terminal.term.loadAddon(fit);
    const observer = new ResizeObserver(() => {
      if (!open || element.clientWidth < 100) return;
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      void terminal
        .resize(Math.max(40, dimensions.cols), Math.max(8, dimensions.rows))
        .catch((reason: unknown) => setError(String(reason)));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      fit.dispose();
      terminal.term.element?.remove();
    };
  }, [terminal, open]);
  return (
    <div className="mx-auto w-full max-w-4xl shrink-0 rounded-md border border-border bg-background-base text-content">
      <div className="flex items-center gap-3 px-3 py-2 text-[11px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="font-medium hover:text-accent"
        >
          {open ? "Hide" : "Show"} Claude native terminal
        </button>
        {terminal ? (
          <>
            <button
              type="button"
              className="hover:text-accent"
              onClick={() => {
                setOpen(true);
                void releaseInteractiveApprovals(sessionId).catch(
                  (reason: unknown) => setError(String(reason)),
                );
                terminal.term.focus();
              }}
            >
              Use terminal
            </button>
            <button
              type="button"
              className="hover:text-accent"
              onClick={() => {
                void terminal
                  .reclaim()
                  .then(() => setError(""))
                  .catch((reason: unknown) => setError(String(reason)));
              }}
            >
              Return to chat
            </button>
            <button
              type="button"
              className="hover:text-accent"
              onClick={() => {
                void stopInteractiveClaude(sessionId).catch((reason: unknown) =>
                  setError(String(reason)),
                );
              }}
            >
              Stop Claude
            </button>
            <span className="ml-auto text-content/50">
              {terminal.owner ? "Terminal has input" : "Chat has input"}
            </span>
          </>
        ) : null}
      </div>
      <p className="px-3 pb-2 text-[11px] text-content/60">
        {terminal
          ? "Same Claude process as this chat. Close menus and clear terminal drafts before returning to chat. Model, effort and Fast selections apply on the next turn; the native terminal shows their applied state."
          : "The native CLI starts with your first message. Automatic AI titles are off. Use its terminal for setup, slash commands and attachments."}
      </p>
      {error ? (
        <p role="alert" className="px-3 pb-2 text-[11px] text-amber-400">
          {error}
        </p>
      ) : null}
      <div
        ref={host}
        className={
          open && terminal ? "h-64 overflow-hidden px-2 pb-2" : "hidden"
        }
      />
    </div>
  );
}
