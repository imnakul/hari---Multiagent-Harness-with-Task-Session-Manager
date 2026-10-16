import { afterEach, describe, expect, it, vi } from "vitest";
import { createInteractiveTerminal } from "./claudeInteractiveTerminal";

const mocks = vi.hoisted(() => ({
  data: undefined as ((data: Uint8Array, start: number) => void) | undefined,
  invoke: vi.fn(async () => undefined),
  write: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../../platform/tauri/pty", () => ({
  subscribePty: (
    _id: string,
    data: (data: Uint8Array, start: number) => void,
  ) => {
    mocks.data = data;
    return () => undefined;
  },
  ptyReplayFrom: async () => ({ start: 0, data: new Uint8Array(), total: 0 }),
  writePty: mocks.write,
  resizePty: async () => undefined,
}));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("real VT parser input gate", () => {
  it("recognizes a native prompt, rejects dialogs and does not replay duplicate bytes", async () => {
    const terminal = await createInteractiveTerminal("vt-test", vi.fn());
    cleanup = terminal.dispose;
    const prompt =
      "\x1b[2J\x1b[H────────────────────────\r\n❯ \r\n────────────────────────\x1b[2;3H";
    const bytes = new TextEncoder().encode(prompt);
    mocks.data?.(bytes, 0);
    await new Promise<void>((resolve) => terminal.term.write("", resolve));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(200);
    expect(terminal.ready()).toBe(true);
    // Backend replay overlapping a delivered event must not duplicate terminal text.
    mocks.data?.(bytes, 0);
    expect(terminal.ready()).toBe(true);
    vi.useRealTimers();
    const dialog = new TextEncoder().encode(
      "\x1b[4;1HEnter to select · Esc to cancel\x1b[2;3H",
    );
    mocks.data?.(dialog, bytes.length);
    await new Promise<void>((resolve) => terminal.term.write("", resolve));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(200);
    expect(terminal.ready()).toBe(false);
    await expect(terminal.reclaim()).rejects.toThrow("empty Claude prompt");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
