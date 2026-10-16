import { Modal } from "../../../shared/ui/Modal";
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

/** Mounting/closing this view never spawns or kills the adapter's process. */
export function ClaudeInteractiveTerminal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}): React.JSX.Element {
  useSyncExternalStore(
    subscribeInteractiveTerminals,
    interactiveTerminalRevision,
  );
  const terminal = interactiveTerminalFor(sessionId);
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
      if (element.clientWidth < 100) return;
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
  }, [terminal]);
  return (
    <Modal
      title="Claude native terminal"
      onClose={onClose}
      closeOnEscape={false}
      fitViewport
    >
      <div className="flex items-center gap-3 px-3 py-2 text-[11px]">
        {terminal ? (
          <>
            <button
              type="button"
              className="hover:text-accent"
              onClick={() => {
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
                  .then(() => {
                    setError("");
                    onClose();
                  })
                  .catch((reason: unknown) => setError(String(reason)));
              }}
            >
              Return to chat
            </button>
            <button
              type="button"
              className="hover:text-accent"
              onClick={() => {
                void stopInteractiveClaude(sessionId)
                  .then(onClose)
                  .catch((reason: unknown) => setError(String(reason)));
              }}
            >
              Stop Claude
            </button>
            <span className="ml-auto text-content/50">
              {terminal.stopped
                ? "Process exited"
                : terminal.owner
                  ? "Terminal has input"
                  : "Chat has input"}
            </span>
          </>
        ) : null}
      </div>
      <p className="px-3 pb-2 text-[11px] text-content/60">
        Same conversation as chat. Use this for Claude setup or native commands.
        Close menus and clear terminal drafts, then Return to chat.
      </p>
      {error ? (
        <p role="alert" className="px-3 pb-2 text-[11px] text-amber-400">
          {error}
        </p>
      ) : null}
      <div
        ref={host}
        className={terminal ? "h-80 overflow-hidden px-2 pb-2" : "hidden"}
      />
    </Modal>
  );
}
