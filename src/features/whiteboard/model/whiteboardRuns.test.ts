import { describe, expect, it, vi } from "vitest";
import type { WhiteboardChatMessage, WhiteboardOps } from "./whiteboardAgent";
import {
  WAITING_NOTE,
  drawOrQueue,
  endRun,
  forgetSheet,
  isRunning,
  publishChat,
  publishedChat,
  registerCanvas,
  startRun,
  stopRun,
  subscribeRuns,
  takePending,
  withDrawnNote,
} from "./whiteboardRuns";

const OPS = { add: [] } as unknown as WhiteboardOps;

describe("whiteboard runs (L-223)", () => {
  it("keeps a run going until it ends or is stopped", () => {
    const heard = vi.fn();
    const unsubscribe = subscribeRuns(heard);
    const first = new AbortController();
    startRun("a", first);
    expect(isRunning("a")).toBe(true);
    endRun("a", new AbortController());
    expect(isRunning("a")).toBe(true);
    endRun("a", first);
    expect(isRunning("a")).toBe(false);

    const second = new AbortController();
    startRun("a", second);
    stopRun("a");
    expect(second.signal.aborted).toBe(true);
    expect(isRunning("a")).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("draws on an open sheet and keeps the changes for a closed one", () => {
    const draw = vi.fn(() => "Drew 2");
    const unregister = registerCanvas("open", draw);
    expect(drawOrQueue("open", OPS, 1)).toBe("Drew 2");
    expect(draw).toHaveBeenCalledWith(OPS);
    expect(takePending("open")).toBeUndefined();
    unregister();

    expect(drawOrQueue("open", OPS, 2)).toBe(WAITING_NOTE);
    expect(takePending("open")).toEqual({ ops: OPS, at: 2 });
    expect(takePending("open")).toBeUndefined();
  });

  it("says when nothing changed", () => {
    const unregister = registerCanvas("same", () => null);
    expect(drawOrQueue("same", OPS, 1)).toBe("Nothing to change");
    unregister();
  });

  it("only removes its own canvas", () => {
    const older = registerCanvas("s", () => "old");
    registerCanvas("s", () => "new");
    older();
    expect(drawOrQueue("s", OPS, 1)).toBe("new");
  });

  it("replaces the waiting note on the right reply", () => {
    const chat: WhiteboardChatMessage[] = [
      { role: "user", text: "draw", at: 1 },
      { role: "assistant", text: "", at: 2, note: WAITING_NOTE },
      { role: "assistant", text: "", at: 3, note: WAITING_NOTE },
    ];
    const next = withDrawnNote(chat, 2, "Drew 3");
    expect(next[1]!.note).toBe("Drew 3");
    expect(next[2]!.note).toBe(WAITING_NOTE);
  });

  it("forgets a deleted sheet", () => {
    const controller = new AbortController();
    startRun("gone", controller);
    drawOrQueue("gone", OPS, 1);
    publishChat("gone", []);
    forgetSheet("gone");
    expect(controller.signal.aborted).toBe(true);
    expect(takePending("gone")).toBeUndefined();
    expect(publishedChat("gone")).toBeUndefined();
  });
});
