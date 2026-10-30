import { describe, expect, it } from "vitest";
import {
  buildWhiteboardPrompt,
  describeOps,
  describeScene,
  parseChatHistory,
  parseWhiteboardOps,
  parseWhiteboardReply,
  serializeChatHistory,
  type SceneElementLike,
} from "./whiteboardAgent";

const box = (id: string, extra: Partial<SceneElementLike> = {}): SceneElementLike => ({
  id,
  type: "rectangle",
  x: 10.4,
  y: 20.6,
  width: 180,
  height: 70,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  ...extra,
});

const FENCE = "```";

describe("describeScene", () => {
  it("lists visible elements with labels from bound text", () => {
    const lines = describeScene([
      box("a", { backgroundColor: "#a5d8ff" }),
      { id: "t1", type: "text", x: 0, y: 0, width: 10, height: 10, containerId: "a", text: "Login\npage" },
      { id: "gone", type: "ellipse", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
      {
        id: "arr",
        type: "arrow",
        x: 0,
        y: 0,
        width: 5,
        height: 0,
        startBinding: { elementId: "a" },
        endBinding: { elementId: "b" },
        strokeColor: "#e03131",
      },
      { id: "note", type: "text", x: 1, y: 2, width: 3, height: 4, text: "Hello" },
    ]);
    expect(lines).toEqual([
      'a rectangle x=10 y=21 w=180 h=70 "Login page" fill=#a5d8ff',
      "arr arrow from=a to=b x=0 y=0 w=5 h=0 stroke=#e03131",
      'note text x=1 y=2 w=3 h=4 "Hello"',
    ]);
  });

  it("stops at the limit and says how many are left", () => {
    const lines = describeScene([box("a"), box("b"), box("c")], 2);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("… and 1 more");
  });
});

describe("buildWhiteboardPrompt", () => {
  it("includes the sheet, the recent chat and the message", () => {
    const prompt = buildWhiteboardPrompt({
      message: "  add a logout box ",
      history: [
        { role: "user", text: "draw login", at: 1 },
        { role: "assistant", text: "Done.", at: 2, note: "Drew 2 items" },
        { role: "assistant", text: "Codex failed.", at: 3, error: true },
      ],
      scene: [box("a")],
    });
    expect(prompt).toContain("```whiteboard");
    expect(prompt).toContain('a rectangle x=10 y=21 w=180 h=70');
    expect(prompt).toContain("User: draw login\nYou: Done. (Drew 2 items)");
    expect(prompt).not.toContain("Codex failed.");
    expect(prompt.endsWith("User: add a logout box")).toBe(true);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it("tells the agent not to draw on a locked sheet", () => {
    const prompt = buildWhiteboardPrompt({ message: "hi", history: [], scene: [], locked: true });
    expect(prompt).toContain("The sheet is locked");
    expect(prompt).toContain("The sheet is empty.");
  });
});

describe("parseWhiteboardReply", () => {
  it("splits text from the whiteboard block", () => {
    const reply = parseWhiteboardReply(
      [
        "Here is a login flow.",
        `${FENCE}whiteboard`,
        JSON.stringify({
          add: [
            { type: "rectangle", id: "login", x: 0, y: 0, width: 160, height: 60, label: "Login" },
            { type: "arrow", from: "login", to: "home" },
            { type: "star", x: 0, y: 0 },
          ],
        }),
        FENCE,
      ].join("\n"),
    );
    expect(reply.text).toBe("Here is a login flow.");
    expect(reply.ops?.add).toEqual([
      { type: "rectangle", id: "login", x: 0, y: 0, width: 160, height: 60, label: "Login" },
      { type: "arrow", from: "login", to: "home" },
    ]);
  });

  it("accepts a json block shaped like changes and leaves other code alone", () => {
    const raw = [
      "Moved it.",
      `${FENCE}ts`,
      "const x = 1;",
      FENCE,
      `${FENCE}json`,
      '{"update":[{"id":"a","x":"40","label":"Hi"}]}',
      FENCE,
    ].join("\n");
    const reply = parseWhiteboardReply(raw);
    expect(reply.ops?.update).toEqual([{ id: "a", x: 40, label: "Hi" }]);
    expect(reply.text).toContain("const x = 1;");
    expect(reply.text).not.toContain('"update"');
  });

  it("returns text only when the block is broken", () => {
    const reply = parseWhiteboardReply(`Sure.\n${FENCE}whiteboard\n{ not json\n${FENCE}`);
    expect(reply).toEqual({ text: "Sure.", ops: null });
    expect(parseWhiteboardReply("Just words.")).toEqual({ text: "Just words.", ops: null });
  });
});

describe("parseWhiteboardOps", () => {
  it("validates and clamps values", () => {
    const ops = parseWhiteboardOps({
      clear: true,
      remove: ["a", "bad id!", 7],
      add: [
        {
          type: "Ellipse",
          x: 1,
          y: 2,
          width: -9000,
          height: 0.2,
          strokeColor: "red",
          backgroundColor: "#ffec99",
          fillStyle: "solid",
          strokeStyle: "wavy",
          fontSize: 500,
          label: "Hi",
        },
        { type: "text", x: 0, y: 0, text: "   " },
        { type: "line", x: 0, y: 0, endX: 50, endY: 10 },
      ],
    });
    expect(ops).toEqual({
      clear: true,
      remove: ["a", "7"],
      update: [],
      add: [
        {
          type: "ellipse",
          x: 1,
          y: 2,
          width: 4000,
          height: 1,
          backgroundColor: "#ffec99",
          fillStyle: "solid",
          fontSize: 120,
          label: "Hi",
        },
        { type: "line", x: 0, y: 0, endX: 50, endY: 10 },
      ],
    });
  });

  it("treats a bare array as additions and an empty object as nothing", () => {
    expect(parseWhiteboardOps([{ type: "diamond", x: 0, y: 0 }])?.add[0]).toMatchObject({
      type: "diamond",
      width: 180,
      height: 70,
    });
    expect(parseWhiteboardOps({})).toBeNull();
    expect(parseWhiteboardOps({ update: [{ id: "a" }] })).toBeNull();
  });
});

describe("chat history and summaries", () => {
  it("round-trips and drops bad messages", () => {
    const messages = [
      { role: "user" as const, text: "hi", at: 1 },
      { role: "assistant" as const, text: "hello", at: 2, note: "Drew 1 item" },
    ];
    expect(parseChatHistory(serializeChatHistory(messages))).toEqual(messages);
    expect(parseChatHistory('{"messages":[{"role":"system","text":"x","at":1}]}')).toEqual([]);
    expect(parseChatHistory("nope")).toEqual([]);
  });

  it("describes what a reply changed", () => {
    expect(
      describeOps({
        clear: false,
        remove: ["a"],
        update: [{ id: "b", x: 1 }],
        add: [{ type: "text", x: 0, y: 0, text: "t" }],
      }),
    ).toBe("Drew 1 item, changed 1, removed 1");
    expect(describeOps({ clear: true, remove: [], update: [], add: [] })).toBe("Cleared the sheet");
  });
});
