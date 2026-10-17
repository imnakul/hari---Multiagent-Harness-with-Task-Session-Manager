import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { IS_WIN } from "../../../../platform/tauri/platform";
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
  promptSource: "cursor" | "conpty-frame";
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
  repaint?: () => Promise<void>;
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
  // spawn_windows already answers ConPTY's inherited-cursor handshake before
  // its reader starts. Its echoed query must not elicit a second response into
  // the running CLI. Later application cursor queries keep the normal handler.
  let conptyDsrAnswered = false;
  const conptyDsr = IS_WIN
    ? term.parser.registerCsiHandler({ final: "n" }, (params): boolean => {
        if (conptyDsrAnswered || params.length !== 1 || params[0] !== 6)
          return false;
        conptyDsrAnswered = true;
        return true;
      })
    : undefined;
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
  let repainted = false;
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
    repaint: async (): Promise<void> => {
      if (
        !IS_WIN ||
        repainted ||
        !started ||
        terminal.stopped ||
        terminal.writing ||
        owner
      )
        return;
      repainted = true;
      const { cols, rows } = term;
      // ConPTY may omit the input row after its initial long-history paint.
      // A real resize asks the CLI for a redraw without changing its input.
      try {
        await terminal.resize(Math.max(20, cols - 1), rows);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      } finally {
        // A visible terminal may have been resized by the user in the meantime.
        if (
          !terminal.stopped &&
          term.cols === Math.max(20, cols - 1) &&
          term.rows === rows
        )
          await terminal.resize(cols, rows);
      }
    },
    inspect: (): InteractiveReadiness => {
      const buffer = term.buffer.active;
      let row = buffer.baseY + buffer.cursorY;
      let column = buffer.cursorX;
      let promptSource: InteractiveReadiness["promptSource"] = "cursor";
      if (IS_WIN) {
        // ConPTY paints Claude's software caret, then parks the VT output cursor
        // on a status row. Inspect the entire unique framed input line instead.
        // A draft (including text before that painted caret) must remain blocked.
        const candidates: { row: number; column: number }[] = [];
        const isFrame = (line: string): boolean =>
          /^[─━]{8,}$/.test(line.trim()) && line.trim().length >= term.cols - 2;
        for (let y = 1; y < term.rows - 1; y++) {
          const absolute = buffer.baseY + y;
          const line = buffer.getLine(absolute)?.translateToString(true) ?? "";
          const prefix = /^\s*❯\s*/.exec(line);
          if (
            prefix &&
            isFrame(
              buffer.getLine(absolute - 1)?.translateToString(true) ?? "",
            ) &&
            isFrame(buffer.getLine(absolute + 1)?.translateToString(true) ?? "")
          )
            candidates.push({ row: absolute, column: prefix[0].length });
        }
        if (candidates.length === 1) {
          row = candidates[0].row;
          column = candidates[0].column;
          promptSource = "conpty-frame";
        }
      }
      const current = buffer.getLine(row);
      const after = current?.translateToString(true, column) ?? "";
      let afterIsDim = true;
      for (let x = column; x < term.cols; x++) {
        const cell = current?.getCell(x);
        if (cell?.getChars().trim() && !cell.isDim()) afterIsDim = false;
      }
      const screen = Array.from(
        { length: IS_WIN ? term.rows - (row - buffer.baseY) : 14 },
        (_, i) => buffer.getLine(row + i)?.translateToString(true) ?? "",
      ).join("\n");
      const checks = interactivePromptChecks({
        before: current?.translateToString(false, 0, column) ?? "",
        after,
        afterIsDim: promptSource === "cursor" && afterIsDim,
        above: buffer.getLine(row - 1)?.translateToString(true) ?? "",
        below: buffer.getLine(row + 1)?.translateToString(true) ?? "",
        screen,
      });
      if (IS_WIN && promptSource !== "conpty-frame")
        checks.cursorAtPrompt = false;
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
        promptSource,
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
      conptyDsr?.dispose();
      term.dispose();
      terminals.delete(id);
      changed();
    },
  };
  terminals.set(id, terminal);
  changed();
  return terminal;
}
