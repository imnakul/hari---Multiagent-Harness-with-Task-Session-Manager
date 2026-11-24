import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseWhiteboardDrawInput,
  requestWhiteboardDraw,
  serveWhiteboardDraws,
  whiteboardToolContext,
  type WhiteboardDrawInput,
} from "./whiteboardTool";

const BOX = { type: "rectangle", id: "a", x: 0, y: 0, width: 180, height: 70, label: "Start" };
const RESULT = { sheetId: "s1", name: "Flow", created: true, note: "Drew 1" };

describe("whiteboard.draw input (L-394)", () => {
  it("accepts a named new sheet with at least one change", () => {
    const input = parseWhiteboardDrawInput({ name: "  Flow ", ops: { add: [BOX] } });
    expect(input.name).toBe("Flow");
    expect(input.sheetId).toBeUndefined();
    expect(input.ops.add).toHaveLength(1);
  });

  it("keeps a sheet id and drops the name with it", () => {
    const input = parseWhiteboardDrawInput({ name: "x", sheetId: "s_1-a", ops: { clear: true } });
    expect(input).toMatchObject({ sheetId: "s_1-a" });
    expect(input.name).toBeUndefined();
  });

  it("refuses empty, malformed or unsafe input with a usable message", () => {
    expect(() => parseWhiteboardDrawInput({ ops: { add: [] } })).toThrow(/at least one valid change/);
    expect(() => parseWhiteboardDrawInput({})).toThrow(/ops must be/);
    expect(() => parseWhiteboardDrawInput({ sheetId: "../x", ops: { add: [BOX] } })).toThrow(/sheetId/);
    expect(() => parseWhiteboardDrawInput({ name: 3, ops: { add: [BOX] } })).toThrow(/name/);
  });

  it("tells the agent the command to run", () => {
    expect(whiteboardToolContext("mono app")).toContain("`mono app whiteboard.draw`");
  });
});

describe("whiteboard.draw delivery (L-394)", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });
  const input: WhiteboardDrawInput = { name: "Flow", ops: { clear: true, add: [], update: [], remove: [] } };

  it("waits for the Whiteboard to open, then draws", async () => {
    const pending = requestWhiteboardDraw(input, 1000);
    const handler = vi.fn(async () => RESULT);
    stops.push(serveWhiteboardDraws(handler));
    await expect(pending).resolves.toEqual(RESULT);
    expect(handler).toHaveBeenCalledWith(input);
  });

  it("draws at once while the Whiteboard is serving and passes on its errors", async () => {
    stops.push(serveWhiteboardDraws(async () => { throw new Error("That sheet is locked."); }));
    await expect(requestWhiteboardDraw(input, 1000)).rejects.toThrow("That sheet is locked.");
  });

  it("gives up when the Whiteboard never opens", async () => {
    vi.useFakeTimers();
    const pending = requestWhiteboardDraw(input, 1000);
    const assertion = expect(pending).rejects.toThrow(/didn't open in time/);
    vi.advanceTimersByTime(1000);
    await assertion;
    const handler = vi.fn(async () => RESULT);
    stops.push(serveWhiteboardDraws(handler));
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops serving after unmount", async () => {
    vi.useFakeTimers();
    serveWhiteboardDraws(async () => RESULT)();
    const pending = requestWhiteboardDraw(input, 500);
    const assertion = expect(pending).rejects.toThrow(/didn't open in time/);
    vi.advanceTimersByTime(500);
    await assertion;
  });
});
