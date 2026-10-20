import { afterEach, describe, expect, it, vi } from "vitest";
import {
  killPty,
  markUnsupportedNotified,
  PTY_SUPPORTED,
  PTY_UNSUPPORTED_MESSAGE,
  stopPty,
  subscribePty,
  trimReplay,
} from "./pty";
import { decodePtyChunk } from "./pty";

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    eventName: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    listeners.set(eventName, handler);
    return () => listeners.delete(eventName);
  },
}));

// The listeners stay registered between tests: pty.ts keeps its event bridge
// for 500ms after the last view leaves, and its unlisten removes them.
afterEach(() => {
  vi.useRealTimers();
});

const KB = 1024;

describe("decodePtyChunk", () => {
  it("decodes a valid base64 payload", () => {
    // "hi" in base64
    const chunk = decodePtyChunk("aGk=");
    expect(chunk).not.toBeNull();
    expect(Array.from(chunk!)).toEqual([104, 105]);
  });

  it("returns null instead of throwing on a malformed payload", () => {
    expect(() => decodePtyChunk("not valid base64!!!")).not.toThrow();
    expect(decodePtyChunk("not valid base64!!!")).toBeNull();
  });
});

describe("PTY output offsets and lazy replay", () => {
  it("preserves byte offsets across live delivery and an unmounted view", async () => {
    const id = `term-${Date.now()}-${Math.random()}`;
    const live: number[] = [];
    const unsubscribe = subscribePty(
      id,
      (_chunk, start) => live.push(start),
      () => undefined,
    );
    const emit = listeners.get("pty-data");
    expect(emit).toBeTypeOf("function");
    emit?.({ payload: { id, data: "aGk=" } }); // "hi", bytes 0–1
    unsubscribe();
    emit?.({ payload: { id, data: "eHk=" } }); // "xy", bytes 2–3

    const replay: number[] = [];
    const stopReplay = subscribePty(
      id,
      (_chunk, start) => replay.push(start),
      () => undefined,
    );

    expect(live).toEqual([0]);
    expect(replay).toEqual([2]);
    stopReplay();
    emit?.({ payload: { id, data: "bGF0ZQ==" } }); // Late bytes from the stopped owner.
    const restarted: number[] = [];
    const stopFresh = subscribePty(
      id,
      (_chunk, start) => restarted.push(start),
      () => undefined,
      { fresh: true },
    );
    expect(restarted).toEqual([]); // Never replay the previous process into its replacement.
    emit?.({ payload: { id, data: "bmV3" } });
    expect(restarted).toEqual([0]);
    stopFresh();
    await killPty(id);
  });
});

describe("stopping a PTY", () => {
  it("still tells an open view its shell exited after a process-monitor stop (L-125)", async () => {
    const id = `term-${Date.now()}-${Math.random()}`;
    const exits: (number | null)[] = [];
    const unsubscribe = subscribePty(
      id,
      () => undefined,
      (code) => exits.push(code),
    );
    await stopPty(id);
    listeners.get("pty-exit")?.({ payload: { id, code: null } });
    expect(exits).toEqual([null]);
    unsubscribe();
    await killPty(id);
  });

  it("drops a closing view's handlers before the kill reports the exit", async () => {
    const id = `term-${Date.now()}-${Math.random()}`;
    const exits: (number | null)[] = [];
    const unsubscribe = subscribePty(
      id,
      () => undefined,
      (code) => exits.push(code),
    );
    await killPty(id);
    listeners.get("pty-exit")?.({ payload: { id, code: null } });
    expect(exits).toEqual([]);
    unsubscribe();
  });
});

describe("trimReplay", () => {
  it("keeps a small buffer whole", () => {
    const sizes = [KB, KB, KB];
    expect(trimReplay(sizes, 3 * KB)).toEqual({ drop: 0, bytes: 3 * KB });
  });

  it("drops oldest chunks once the byte budget is exceeded", () => {
    // Ten 32KB chunks is 320KB, over the 256KB budget.
    const sizes = Array(10).fill(32 * KB);
    const { drop, bytes } = trimReplay(sizes, 320 * KB);
    expect(drop).toBe(2);
    expect(bytes).toBe(256 * KB);
  });

  it("bounds a flood of tiny chunks by count", () => {
    const sizes = Array(250).fill(4);
    const { drop } = trimReplay(sizes, 1000);
    expect(sizes.length - drop).toBe(200);
  });

  it("keeps the newest chunk even when it alone exceeds the budget", () => {
    const sizes = [KB, 512 * KB];
    const { drop, bytes } = trimReplay(sizes, 513 * KB);
    expect(drop).toBe(1);
    expect(bytes).toBe(512 * KB);
  });

  it("never drops the only chunk", () => {
    const sizes = [512 * KB];
    expect(trimReplay(sizes, 512 * KB)).toEqual({ drop: 0, bytes: 512 * KB });
  });
});

describe("PTY platform support", () => {
  it("is supported on every platform the Rust backend implements", () => {
    // Unix (fork/openpty) + Windows (ConPTY). Flip this back only if a
    // backend platform is ever dropped.
    expect(PTY_SUPPORTED).toBe(true);
  });

  it("keeps the unsupported message identical to the Rust backend rejection", () => {
    // Must match pty_spawn/pty_resize in src-tauri/src/pty.rs; TerminalView
    // compares backend errors against this string to stop retrying.
    expect(PTY_UNSUPPORTED_MESSAGE).toBe(
      "Terminals are supported on macOS and Linux.",
    );
  });

  it("notifies unsupported only once per terminal id", () => {
    const id = `term-${Date.now()}-${Math.random()}`;
    expect(markUnsupportedNotified(id)).toBe(true);
    expect(markUnsupportedNotified(id)).toBe(false);
    expect(markUnsupportedNotified(`${id}-other`)).toBe(true);
  });
});
