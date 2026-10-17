import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/interactive-cli-2.1.301.json";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

// Keep the production adapter, VT parser and PTY subscriptions together. Only the
// desktop IPC boundary is replaced; neither readiness nor input ownership is mocked.
const host = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  output: "",
  sequence: 0,
  hooks: [] as Record<string, unknown>[],
  lines: [] as string[],
  starts: [] as Record<string, unknown>[],
  sends: [] as string[],
  nativeInput: [] as string[],
  replies: [] as string[],
  terminalOwner: false,
  running: false,
  startup: "",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    callback: (event: { payload: unknown }) => void,
  ) => {
    host.listeners.set(name, callback);
    return (): void => {
      host.listeners.delete(name);
    };
  },
}));
vi.mock("../../core/child", () => ({
  hasHeadlessChildBackend: () => false,
  resolveClaudeBinary: async () => ({ path: "/fixture/claude" }),
  killChild: async () => undefined,
  unwatchChild: () => undefined,
}));
import {
  forgetInteractiveClaude,
  sendInteractiveClaude,
  stopInteractiveClaude,
  interactiveClaudeDiagnostics,
  hasInteractiveClaudeDiagnostics,
} from "./claudeInteractive";
import { interactiveTerminalFor } from "./claudeInteractiveTerminal";
import { claudeAdapter } from "./claudeAdapter";
import {
  HARNESS_IDLE_PARK_MS,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
} from "../../core/registry";

const id = "whole-bridge";
const events: HarnessEvent[] = [];
const accepted = vi.fn();
function input(text: string): SendTurnInput {
  return {
    sessionId: id,
    cwd: "/fixture",
    model: "claude:sonnet-5",
    modelSettings: { claudeExecution: "interactive" },
    runtimeMode: "full-access",
    text,
    onEvent: (event): void => {
      events.push(event);
    },
    onAccepted: accepted,
  };
}
function output(data: string): void {
  host.output += data;
  host.listeners.get("pty-data")?.({
    payload: {
      id: `claude-interactive:${id}`,
      data: Buffer.from(data).toString("base64"),
    },
  });
}
async function waitFor(condition: () => boolean, budget = 1000): Promise<void> {
  await vi.dynamicImportSettled();
  for (let spent = 0; spent < budget && !condition(); spent += 50)
    await vi.advanceTimersByTimeAsync(50);
  expect(condition()).toBe(true);
}
beforeEach(() => {
  vi.useFakeTimers();
  host.output = "";
  host.sequence = 0;
  host.hooks = [];
  host.lines = [];
  host.starts = [];
  host.sends = [];
  host.nativeInput = [];
  host.replies = [];
  host.running = false;
  host.startup = fixture.startup;
  host.terminalOwner = false;
  events.length = 0;
  accepted.mockClear();
  host.invoke
    .mockReset()
    .mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        switch (command) {
          case "harness_stop_confirmed":
          case "control_authorize_turn":
          case "control_turn_finished":
            return;
          case "claude_interactive_start":
            host.running = true;
            host.terminalOwner = false;
            host.output = "";
            host.starts.push(args.input as Record<string, unknown>);
            output(host.startup);
            return;
          case "pty_write":
            host.replies.push(String(args.data));
            return;
          case "pty_resize":
            return;
          case "pty_replay": {
            const bytes = Buffer.from(host.output);
            const offset = Number(args.offset);
            return {
              start: offset,
              total: bytes.length,
              data: bytes.subarray(offset).toString("base64"),
            };
          }
          case "claude_interactive_terminal":
            if (args.data != null) {
              host.nativeInput.push(String(args.data));
              host.terminalOwner = true;
            } else host.terminalOwner = false;
            return;
          case "claude_interactive_poll":
            return {
              phase: "ready",
              terminalOwner: host.terminalOwner,
              sequence: host.sequence,
              events: host.hooks.splice(0),
              lines: host.lines.splice(0),
              more: false,
            };
          case "claude_interactive_send": {
            if (!host.running || host.terminalOwner)
              throw new Error("Native input is unavailable");
            host.sends.push(String(args.text));
            host.hooks.push({
              hook_event_name: "UserPromptSubmit",
              bridgeId: ++host.sequence,
              prompt: args.text,
            });
            const row = structuredClone(fixture.transcript[1]);
            row.uuid = `assistant-${host.sends.length}`;
            host.lines.push(JSON.stringify(row));
            output(fixture.completed.slice(fixture.startup.length));
            host.hooks.push({
              hook_event_name: "Stop",
              bridgeId: ++host.sequence,
            });
            return;
          }
          case "claude_interactive_stop":
            host.running = false;
            return;
          default:
            throw new Error(`Unexpected IPC command: ${command}`);
        }
      },
    );
});
afterEach(async () => {
  resetHarnessIdlePark();
  await forgetInteractiveClaude(id);
  await vi.advanceTimersByTimeAsync(600); // Release the real PTY event bridge.
  vi.useRealTimers();
});

it("keeps the native recovery terminal and blocked snapshot past the idle parking deadline", async () => {
  // An actual draft must block chat; no attempt to guess or erase its origin.
  host.startup += "c";
  registerHarness(claudeAdapter);
  const turn = sendHarnessTurn({ ...input("First"), harness: "claude" }).catch(
    (error: unknown) => error,
  );
  await waitFor(() => host.running);
  await vi.advanceTimersByTimeAsync(21000);
  expect(String(await turn)).toContain("No prompt was sent");
  const terminal = interactiveTerminalFor(id);
  const blocked = interactiveClaudeDiagnostics(id)?.lastBlocked;
  expect(blocked?.terminal.reason).toBe("prompt-mismatch");
  await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS * 2);
  expect(host.running).toBe(true);
  expect(interactiveTerminalFor(id)).toBe(terminal);
  expect(interactiveClaudeDiagnostics(id)?.lastBlocked).toEqual(blocked);
  expect(host.sends).toEqual([]);
  expect(host.nativeInput).toEqual([]);
  await stopInteractiveClaude(id);
  expect(host.running).toBe(false);
  expect(interactiveTerminalFor(id)).toBeUndefined();
  expect(hasInteractiveClaudeDiagnostics(id)).toBe(true);
  expect(interactiveClaudeDiagnostics(id)).toMatchObject({
    status: "stopped",
    current: { phase: "stopped", terminal: { reason: "stopped" } },
    lastBlocked: blocked,
  });
  await forgetInteractiveClaude(id);
  expect(hasInteractiveClaudeDiagnostics(id)).toBe(false);
});

it("retains the terminal and failure report when the native process exits", async () => {
  host.startup += "c";
  const turn = sendInteractiveClaude(input("First")).catch(
    (error: unknown) => error,
  );
  await waitFor(() => host.running);
  await vi.advanceTimersByTimeAsync(21000);
  expect(String(await turn)).toContain("No prompt was sent");
  const terminal = interactiveTerminalFor(id);
  const blocked = interactiveClaudeDiagnostics(id)?.lastBlocked;
  host.running = false;
  host.listeners.get("pty-exit")?.({
    payload: { id: `claude-interactive:${id}`, code: 1 },
  });
  expect(interactiveTerminalFor(id)).toBe(terminal);
  expect(terminal?.stopped).toBe(true);
  expect(interactiveClaudeDiagnostics(id)).toMatchObject({
    status: "exited",
    current: { terminal: { reason: "stopped" } },
    lastBlocked: blocked,
  });
  expect(host.sends).toEqual([]);
});

it("sends two GUI turns without mounting a terminal or losing input to focus reports", async () => {
  for (const text of ["Radhe Radhe", "Second line\nAnother line"]) {
    const turn = sendInteractiveClaude(input(text));
    await waitFor(() => host.sends.includes(text));
    await vi.advanceTimersByTimeAsync(1000);
    await turn;
    expect(interactiveTerminalFor(id)?.term.element).toBeUndefined();
    expect(interactiveTerminalFor(id)?.owner).toBe(false);
  }
  expect(host.sends).toEqual(["Radhe Radhe", "Second line\nAnother line"]);
  expect(host.nativeInput).toEqual([]);
  expect(host.replies).toContain("\x1b[O");
  expect(accepted).toHaveBeenCalledTimes(2);
  expect(events.filter((event) => event.type === "message.delta")).toHaveLength(
    2,
  );
});

it("keeps real terminal typing separate until explicitly returning to chat", async () => {
  const first = sendInteractiveClaude(input("First"));
  await waitFor(() => accepted.mock.calls.length === 1);
  await vi.advanceTimersByTimeAsync(1000);
  await first;
  const terminal = interactiveTerminalFor(id)!;
  terminal.term.input("native draft", true);
  await expect(sendInteractiveClaude(input("Must not send"))).rejects.toThrow(
    "No prompt was sent",
  );
  expect(host.sends).toEqual(["First"]);
  expect(host.nativeInput).toEqual(["native draft"]);
  await terminal.reclaim();
  const next = sendInteractiveClaude(input("After reclaim"));
  await waitFor(() => accepted.mock.calls.length === 2);
  await vi.advanceTimersByTimeAsync(1000);
  await next;
});

it("receives fresh PTY output immediately after Stop and native resume", async () => {
  const first = sendInteractiveClaude(input("First"));
  await waitFor(() => accepted.mock.calls.length === 1);
  await vi.advanceTimersByTimeAsync(1000);
  await first;
  const nativeId = host.starts[0].nativeId;
  await stopInteractiveClaude(id);
  const resumed = sendInteractiveClaude(input("After restart"));
  const settled = resumed.catch((error: unknown) => error);
  try {
    await waitFor(() => accepted.mock.calls.length === 2, 800);
    await vi.advanceTimersByTimeAsync(1000);
    await resumed;
    expect(host.starts[1]).toMatchObject({ nativeId, resume: true });
  } finally {
    await stopInteractiveClaude(id);
    await settled;
  }
});
