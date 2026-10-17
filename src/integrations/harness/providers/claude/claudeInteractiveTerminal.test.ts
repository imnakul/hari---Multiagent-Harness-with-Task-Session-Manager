import fixture from "./fixtures/interactive-cli-2.1.301.json";
import conpty from "./fixtures/interactive-conpty-2.1.302.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInteractiveTerminal } from "./claudeInteractiveTerminal";

const mocks = vi.hoisted(() => ({
  data: undefined as ((data: Uint8Array, start: number) => void) | undefined,
  invoke: vi.fn(async () => undefined),
  write: vi.fn(async () => undefined),
  resize: vi.fn(async () => undefined),
  windows: false,
}));
vi.mock("../../../../platform/tauri/platform", () => ({
  get IS_WIN(): boolean {
    return mocks.windows;
  },
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
  resizePty: mocks.resize,
}));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.windows = false;
});

describe("real VT parser input gate", () => {
  it.each([false, true])(
    "fails closed on a parked cursor without one unique Windows frame (Windows %s)",
    async (windows) => {
      mocks.windows = windows;
      const terminal = await createInteractiveTerminal(
        "frame-identity",
        vi.fn(),
      );
      cleanup = terminal.dispose;
      // On Unix the physical cursor stays authoritative. On Windows, add a second
      // framed prompt and park the cursor in it: ambiguity must still block sends.
      const extra = windows
        ? "\x1b[34;1H────────────────────\x1b[35;1H❯ \x1b[36;1H────────────────────\x1b[35;3H"
        : "";
      mocks.data?.(new TextEncoder().encode(conpty.empty + extra), 0);
      await new Promise<void>((resolve) => terminal.term.write("", resolve));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(200);
      expect(terminal.ready()).toBe(false);
    },
  );
  it.each(["default", "empty"] as const)(
    "checks the complete captured ConPTY %s input while its output cursor is elsewhere",
    async (stage) => {
      mocks.windows = true;
      const terminal = await createInteractiveTerminal(
        "conpty-screen",
        vi.fn(),
      );
      cleanup = terminal.dispose;
      mocks.data?.(new TextEncoder().encode(conpty[stage]), 0);
      await new Promise<void>((resolve) => terminal.term.write("", resolve));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(200);
      expect(terminal.inspect()).toMatchObject({
        promptSource: "conpty-frame",
        cursorX: 119,
        checks: { cursorAtPrompt: true, emptyDraft: stage === "empty" },
      });
      expect(terminal.ready()).toBe(stage === "empty");
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["unfinished", "? for shortcuts"],
    ["\x1b[2munfinished\x1b[22m", "? for shortcuts"],
    ["", "Enter to select · Esc to cancel"],
    ["", "esc to interrupt"],
  ])(
    "rejects a ConPTY draft/menu even with a parked output cursor (%s / %s)",
    async (draft, footer) => {
      mocks.windows = true;
      const terminal = await createInteractiveTerminal("conpty-guard", vi.fn());
      cleanup = terminal.dispose;
      mocks.data?.(
        new TextEncoder().encode(
          conpty.empty +
            `\x1b[38;1H\x1b[2K❯ ${draft}\x1b[40;1H\x1b[2K${footer}\x1b[40;120H`,
        ),
        0,
      );
      await new Promise<void>((resolve) => terminal.term.write("", resolve));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(200);
      expect(terminal.inspect().promptSource).toBe("conpty-frame");
      expect(terminal.ready()).toBe(false);
      await expect(terminal.reclaim()).rejects.toThrow("empty Claude prompt");
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );
  it("distinguishes missing output from an incomplete prompt without exporting terminal text", async () => {
    const terminal = await createInteractiveTerminal(
      "diagnostic-test",
      vi.fn(),
    );
    cleanup = terminal.dispose;
    await terminal.started();
    expect(terminal.inspect()).toMatchObject({
      reason: "no-output",
      receivedBytes: 0,
    });
    const partial = new TextEncoder().encode(
      "\x1b[2J\x1b[HPRIVATE ACCOUNT TEXT\r\n────────────────────\r\n❯ ",
    );
    mocks.data?.(partial, 0);
    await new Promise<void>((resolve) => terminal.term.write("", resolve));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(200);
    const blocked = terminal.inspect();
    expect(blocked).toMatchObject({
      reason: "prompt-mismatch",
      pendingParses: 0,
      checks: { cursorAtPrompt: true, frameAbove: true, frameBelow: false },
    });
    expect(JSON.stringify(blocked)).not.toContain("PRIVATE");
    vi.useRealTimers();
    mocks.data?.(
      new TextEncoder().encode("\r\n────────────────────\x1b[3;3H"),
      partial.length,
    );
    await new Promise<void>((resolve) => terminal.term.write("", resolve));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(200);
    expect(terminal.inspect().reason).toBe("ready");
    expect(blocked.reason).toBe("prompt-mismatch");
  });
  it("preserves real input provenance even when typed data resembles a parser reply", async () => {
    const terminal = await createInteractiveTerminal("input-source", vi.fn());
    cleanup = terminal.dispose;
    terminal.term.input("\x1b[I\x1b[?1;2c", false);
    terminal.term.input("\x1b[?997;1n", false);
    expect(terminal.owner).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    terminal.term.input("\x1b[1;2R", true);
    expect(terminal.owner).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("claude_interactive_terminal", {
      sessionId: "input-source",
      data: "\x1b[1;2R",
    });
  });
  it("defers view resizing until the native process acknowledges startup", async () => {
    const terminal = await createInteractiveTerminal("resize-start", vi.fn());
    cleanup = terminal.dispose;
    await terminal.resize(80, 24);
    expect(mocks.resize).not.toHaveBeenCalled();
    await terminal.started();
    expect(mocks.resize).toHaveBeenCalledWith(
      "claude-interactive:resize-start",
      80,
      24,
    );
  });
  it.each(["startup", "completed"] as const)(
    "accepts the actual CLI 2.1.301 %s prompt with an undimmed stock placeholder",
    async (stage) => {
      const terminal = await createInteractiveTerminal("captured-vt", vi.fn());
      cleanup = terminal.dispose;
      mocks.data?.(new TextEncoder().encode(fixture[stage]), 0);
      await new Promise<void>((resolve) => terminal.term.write("", resolve));
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(200);
      expect(terminal.ready()).toBe(true);
      // The real startup enables focus reporting and emits CSI O through onData.
      expect(terminal.owner).toBe(false);
      expect(mocks.write).toHaveBeenCalledWith(
        "claude-interactive:captured-vt",
        "\x1b[O",
      );
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );
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
