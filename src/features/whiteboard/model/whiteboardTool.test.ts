import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeSheetForAgent,
  parseWhiteboardDrawInput,
  parseWhiteboardReadInput,
  requestWhiteboardDraw,
  requestWhiteboardRead,
  sceneElementsFromJson,
  serveWhiteboard,
  whiteboardSheetChatContext,
  whiteboardToolContext,
  type WhiteboardDrawInput,
  type WhiteboardDrawResult,
} from "./whiteboardTool";

const BOX = { type: "rectangle", id: "a", x: 0, y: 0, width: 180, height: 70, label: "Start" };
const RESULT = { sheetId: "s1", name: "Flow", created: true, note: "Drew 1" };

/** A Whiteboard that only draws; reads list no sheets. */
function drawOnly(draw: (input: WhiteboardDrawInput) => Promise<WhiteboardDrawResult>) {
  return { draw, read: async () => ({ sheets: [] }) };
}

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
    stops.push(serveWhiteboard(drawOnly(handler)));
    await expect(pending).resolves.toEqual(RESULT);
    expect(handler).toHaveBeenCalledWith(input);
  });

  it("draws at once while the Whiteboard is serving and passes on its errors", async () => {
    stops.push(serveWhiteboard(drawOnly(async () => { throw new Error("That sheet is locked."); })));
    await expect(requestWhiteboardDraw(input, 1000)).rejects.toThrow("That sheet is locked.");
  });

  it("gives up when the Whiteboard never opens", async () => {
    vi.useFakeTimers();
    const pending = requestWhiteboardDraw(input, 1000);
    const assertion = expect(pending).rejects.toThrow(/didn't open in time/);
    vi.advanceTimersByTime(1000);
    await assertion;
    const handler = vi.fn(async () => RESULT);
    stops.push(serveWhiteboard(drawOnly(handler)));
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops serving after unmount", async () => {
    vi.useFakeTimers();
    serveWhiteboard(drawOnly(async () => RESULT))();
    const pending = requestWhiteboardDraw(input, 500);
    const assertion = expect(pending).rejects.toThrow(/didn't open in time/);
    vi.advanceTimersByTime(500);
    await assertion;
  });
});

describe("whiteboard.read and sheet chats (L-403)", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  it("validates the sheet id and allows none (a sheet list)", () => {
    expect(parseWhiteboardReadInput({})).toEqual({});
    expect(parseWhiteboardReadInput({ sheetId: "s_1" })).toEqual({ sheetId: "s_1" });
    expect(() => parseWhiteboardReadInput({ sheetId: "../x" })).toThrow(/sheetId/);
  });

  it("reads saved scenes and describes them, empty or unreadable as an empty sheet", () => {
    const json = JSON.stringify({ elements: [{ ...BOX, type: "rectangle", isDeleted: false }, { nope: 1 }] });
    const elements = sceneElementsFromJson(json);
    expect(elements).toHaveLength(1);
    expect(describeSheetForAgent(elements)[0]).toContain("a rectangle x=0 y=0 w=180 h=70");
    expect(sceneElementsFromJson("not json")).toEqual([]);
    expect(describeSheetForAgent([])).toEqual(["(the sheet is empty)"]);
  });

  it("serves reads through the same Whiteboard as draws", async () => {
    const read = vi.fn(async () => ({ sheetId: "s1", name: "Flow", locked: false, elements: ["a rectangle"] }));
    stops.push(serveWhiteboard({ draw: async () => RESULT, read }));
    await expect(requestWhiteboardRead({ sheetId: "s1" }, 1000)).resolves.toMatchObject({ name: "Flow" });
    expect(read).toHaveBeenCalledWith({ sheetId: "s1" });
  });

  it("tells a sheet's chat its sheet and both commands", () => {
    const text = whiteboardSheetChatContext("mono app", "s_9");
    expect(text).toContain('sheetId "s_9"');
    expect(text).toContain("`mono app whiteboard.read`");
    expect(text).toContain("`mono app whiteboard.draw`");
  });
});
