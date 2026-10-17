import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import {
  ptyReplayFrom,
  resizePty,
  subscribePty,
  writePty,
} from "../../../../platform/tauri/pty";
import { interactivePromptChecks } from "./claudeInteractiveProtocol";

export type InteractiveReadiness = {
  reason:
    | "starting"
    | "no-output"
    | "stopped"
    | "submitting"
    | "parsing"
    | "settling"
    | "native-dialog"
    | "prompt-mismatch"
    | "ready";
  receivedBytes: number;
  outputAgeMs: number | null;
  pendingParses: number;
  replyFailures: number;
  started: boolean;
  inputOwner: boolean;
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  checks: ReturnType<typeof interactivePromptChecks>;
};

export type InteractiveTerminal = {
  term: Terminal;
  owner: boolean;
  writing: boolean;
  stopped: boolean;
  started: () => Promise<void>;
  ready: () => boolean;
  inspect: () => InteractiveReadiness;
  reclaim: () => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  dispose: () => void;
};

const terminals = new Map<string, InteractiveTerminal>();
const listeners = new Set<() => void>();
let revision = 0;
export function interactiveTerminalRevision(): number {
  return revision;
}

export function interactiveTerminalFor(
  id: string,
): InteractiveTerminal | undefined {
  return terminals.get(id);
}
export function subscribeInteractiveTerminals(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function changed(): void {
  revision++;
  for (const listener of listeners) listener();
}

export async function createInteractiveTerminal(
  id: string,
  onExit: (code: number | null) => void,
): Promise<InteractiveTerminal> {
  const { Terminal } = await import("@xterm/xterm");
  const term = new Terminal({
    cols: 120,
    rows: 40,
    scrollback: 3000,
    allowProposedApi: true,
    fontSize: 12,
  });
  // Public onData merges typing with parser replies. Orca uses this same core
  // signal; keep its contract covered against the installed real xterm build.
  const core = (
    term as unknown as {
      _core?: {
        coreService?: {
          onUserInput?: (listener: () => void) => { dispose: () => void };
        };
      };
    }
  )._core?.coreService;
  if (typeof core?.onUserInput !== "function") {
    term.dispose();
    throw new Error(
      "The terminal parser cannot distinguish typing from automatic replies. Update MonoCode before using Claude Interactive.",
    );
  }
  let pendingUserInput = false;
  const userInput = core.onUserInput(() => {
    pendingUserInput = true;
  });
  const ptyId = `claude-interactive:${id}`;
  let offset = 0;
  let lastWrite = Date.now();
  let owner = false;
  let started = false;
  let pendingParses = 0;
  let replyFailures = 0;
  const accept = (data: Uint8Array, start: number): void => {
    if (start > offset) return; // Replay fills gaps; never parse a broken VT stream.
    const skip = Math.max(0, offset - start);
    if (skip >= data.length) return;
    offset = start + data.length;
    lastWrite = Date.now();
    pendingParses++;
    term.write(data.subarray(skip), () => {
      pendingParses--;
    });
  };
  const unsubscribe = subscribePty(
    ptyId,
    accept,
    (code) => {
      terminal.stopped = true;
      onExit(code);
      changed();
    },
    { fresh: true },
  );
  const input = term.onData((data) => {
    const wasUserInput = pendingUserInput;
    pendingUserInput = false;
    if (terminal.stopped) return;
    // Focus reports and all parser replies keep the CLI alive without taking chat input.
    if (!wasUserInput) {
      void writePty(ptyId, data).catch(() => {
        replyFailures++;
      });
      return;
    }
    terminal.owner = true;
    changed();
    void invoke("claude_interactive_terminal", { sessionId: id, data }).catch(
      (error: unknown) => {
        term.writeln(`\r\n[Input not confirmed: ${String(error)}]`);
      },
    );
  });
  const timer = setInterval(() => {
    void ptyReplayFrom(ptyId, offset)
      .then((replay) => {
        if (replay.start > offset) {
          terminal.owner = true;
          terminal.stopped = true;
          onExit(null);
          changed();
          return;
        }
        accept(replay.data, replay.start);
      })
      .catch(() => undefined);
  }, 1000);
  const terminal: InteractiveTerminal = {
    term,
    get owner(): boolean {
      return owner;
    },
    set owner(value: boolean) {
      if (owner !== value) {
        owner = value;
        changed();
      }
    },
    writing: false,
    stopped: false,
    started: async (): Promise<void> => {
      started = true;
      // A recovery view can open while spawn is in flight. Apply its dimensions
      // only after the backend owns the PTY, keeping both VT screens in sync.
      if (!terminal.stopped && (term.cols !== 120 || term.rows !== 40))
        await resizePty(ptyId, term.cols, term.rows);
      changed();
    },
    ready: (): boolean => terminal.inspect().reason === "ready",
    inspect: (): InteractiveReadiness => {
      const buffer = term.buffer.active;
      const row = buffer.baseY + buffer.cursorY;
      const current = buffer.getLine(row);
      const after = current?.translateToString(true, buffer.cursorX) ?? "";
      let afterIsDim = true;
      for (let x = buffer.cursorX; x < term.cols; x++) {
        const cell = current?.getCell(x);
        if (cell?.getChars().trim() && !cell.isDim()) afterIsDim = false;
      }
      const screen = Array.from(
        { length: 14 },
        (_, i) => buffer.getLine(row + i)?.translateToString(true) ?? "",
      ).join("\n");
      const checks = interactivePromptChecks({
        before: current?.translateToString(false, 0, buffer.cursorX) ?? "",
        after,
        afterIsDim,
        above: buffer.getLine(row - 1)?.translateToString(true) ?? "",
        below: buffer.getLine(row + 1)?.translateToString(true) ?? "",
        screen,
      });
      const age = offset ? Math.max(0, Date.now() - lastWrite) : null;
      const reason = terminal.stopped
        ? "stopped"
        : terminal.writing
          ? "submitting"
          : !offset
            ? started
              ? "no-output"
              : "starting"
            : pendingParses
              ? "parsing"
              : age != null && age < 180
                ? "settling"
                : !checks.dialogFree
                  ? "native-dialog"
                  : Object.values(checks).every(Boolean)
                    ? "ready"
                    : "prompt-mismatch";
      // Deliberately omit terminal text, paths, account identifiers and reply bytes.
      return {
        reason,
        receivedBytes: offset,
        outputAgeMs: age,
        pendingParses,
        replyFailures,
        started,
        inputOwner: owner,
        cols: term.cols,
        rows: term.rows,
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY,
        checks,
      };
    },
    reclaim: async (): Promise<void> => {
      if (!terminal.ready())
        throw new Error(
          "Return to the empty Claude prompt first; close menus and clear drafts in the terminal.",
        );
      await invoke("claude_interactive_terminal", { sessionId: id });
      terminal.owner = false;
      changed();
    },
    resize: async (cols: number, rows: number): Promise<void> => {
      term.resize(cols, rows);
      if (started && !terminal.stopped) await resizePty(ptyId, cols, rows);
    },
    dispose: (): void => {
      clearInterval(timer);
      unsubscribe();
      input.dispose();
      userInput.dispose();
      term.dispose();
      terminals.delete(id);
      changed();
    },
  };
  terminals.set(id, terminal);
  changed();
  return terminal;
}
