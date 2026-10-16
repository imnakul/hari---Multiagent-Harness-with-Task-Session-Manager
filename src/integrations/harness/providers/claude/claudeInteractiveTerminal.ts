import type { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import {
  ptyReplayFrom,
  resizePty,
  subscribePty,
  writePty,
} from "../../../../platform/tauri/pty";
import {
  isEmptyInteractivePrompt,
  isInteractiveTerminalReply,
} from "./claudeInteractiveProtocol";

export type InteractiveTerminal = {
  term: Terminal;
  owner: boolean;
  writing: boolean;
  stopped: boolean;
  started: () => Promise<void>;
  ready: () => boolean;
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
  const ptyId = `claude-interactive:${id}`;
  let offset = 0;
  let lastWrite = Date.now();
  let owner = false;
  let started = false;
  const accept = (data: Uint8Array, start: number): void => {
    if (start > offset) return; // Replay fills gaps; never parse a broken VT stream.
    const skip = Math.max(0, offset - start);
    if (skip >= data.length) return;
    offset = start + data.length;
    lastWrite = Date.now();
    term.write(data.subarray(skip));
  };
  const unsubscribe = subscribePty(ptyId, accept, (code) => {
    terminal.stopped = true;
    onExit(code);
    changed();
  });
  const input = term.onData((data) => {
    if (terminal.stopped) return;
    // Terminal query responses are not human input and cannot submit a prompt.
    if (isInteractiveTerminalReply(data)) {
      void writePty(ptyId, data).catch(() => undefined);
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
    ready: (): boolean => {
      if (terminal.stopped || terminal.writing || Date.now() - lastWrite < 180)
        return false;
      const buffer = term.buffer.active;
      const row = buffer.baseY + buffer.cursorY;
      const current = buffer.getLine(row);
      if (!current) return false;
      const after = current.translateToString(true, buffer.cursorX);
      let afterIsDim = true;
      for (let x = buffer.cursorX; x < term.cols; x++) {
        const cell = current.getCell(x);
        if (cell?.getChars().trim() && !cell.isDim()) afterIsDim = false;
      }
      const screen = Array.from(
        { length: 14 },
        (_, i) => buffer.getLine(row + i)?.translateToString(true) ?? "",
      ).join("\n");
      return isEmptyInteractivePrompt({
        before: current.translateToString(false, 0, buffer.cursorX),
        after,
        afterIsDim,
        above: buffer.getLine(row - 1)?.translateToString(true) ?? "",
        below: buffer.getLine(row + 1)?.translateToString(true) ?? "",
        screen,
      });
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
      term.dispose();
      terminals.delete(id);
      changed();
    },
  };
  terminals.set(id, terminal);
  changed();
  return terminal;
}
