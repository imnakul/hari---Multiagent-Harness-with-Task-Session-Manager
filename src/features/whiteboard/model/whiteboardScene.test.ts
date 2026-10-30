import { describe, expect, it } from "vitest";
import type { SceneElementLike, WhiteboardOps } from "./whiteboardAgent";
import { applyWhiteboardOps, edgePoint, type SceneDeps, type WhiteboardSkeleton } from "./whiteboardScene";

type El = SceneElementLike & Record<string, unknown>;

/** Stand-ins for convertToExcalidrawElements / newElementWith. */
const deps: SceneDeps<El> & { batches: WhiteboardSkeleton[][] } = {
  batches: [],
  convert(skeletons) {
    deps.batches.push(skeletons);
    const out: El[] = [];
    for (const skeleton of skeletons) {
      const { label, ...rest } = skeleton as WhiteboardSkeleton & { label?: { text: string } };
      const element: El = {
        width: 10,
        height: 10,
        ...rest,
        boundElements: null,
      } as El;
      out.push(element);
      if (label) {
        const text: El = {
          id: `${skeleton.id}-text`,
          type: "text",
          x: skeleton.x,
          y: skeleton.y,
          width: 40,
          height: 20,
          text: label.text,
          containerId: skeleton.id,
        };
        element.boundElements = [{ id: text.id, type: "text" }];
        out.push(text);
      }
    }
    return out;
  },
  withChanges: (element, changes) => ({ ...element, ...changes }),
};

const ops = (patch: Partial<WhiteboardOps>): WhiteboardOps => ({
  clear: false,
  remove: [],
  update: [],
  add: [],
  ...patch,
});

const rect = (id: string, x: number, y: number): El => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 100,
  height: 50,
  boundElements: [{ id: `${id}-text`, type: "text" }],
});
const label = (id: string, x: number, y: number): El => ({
  id: `${id}-text`,
  type: "text",
  x: x + 30,
  y: y + 15,
  width: 40,
  height: 20,
  text: "old",
  containerId: id,
});

describe("applyWhiteboardOps", () => {
  it("adds shapes and renames ids that clash", () => {
    const result = applyWhiteboardOps(
      [rect("a", 0, 0), label("a", 0, 0)],
      ops({
        add: [
          { type: "rectangle", id: "a", x: 300, y: 0, width: 100, height: 50, label: "New" },
          { type: "text", x: 0, y: 200, text: "Title", fontSize: 28 },
        ],
      }),
      deps,
      { fontFamily: 101 },
    );
    expect(result.ids.get("a")).toBe("a-2");
    expect(result.added).toBe(2);
    const batch = deps.batches.at(-1)!;
    expect(batch[0]).toMatchObject({ id: "a-2", label: { text: "New", fontFamily: 101 } });
    expect(batch[1]).toMatchObject({ id: "text", type: "text", fontSize: 28, fontFamily: 101 });
    expect(result.elements.map((element) => element.id)).toEqual([
      "a",
      "a-text",
      "a-2",
      "a-2-text",
      "text",
    ]);
  });

  it("joins new shapes with a bound arrow and existing ones with a placed arrow", () => {
    const result = applyWhiteboardOps(
      [rect("old", 0, 300), label("old", 0, 300)],
      ops({
        add: [
          { type: "rectangle", id: "p", x: 0, y: 0, width: 100, height: 50 },
          { type: "rectangle", id: "q", x: 300, y: 0, width: 100, height: 50 },
          { type: "arrow", from: "p", to: "q", label: "go" },
          { type: "arrow", from: "p", to: "old" },
          { type: "arrow", from: "p", to: "nowhere" },
        ],
      }),
      deps,
    );
    const batch = deps.batches.at(-1)!;
    const [, , bound, placed] = batch;
    expect(bound).toMatchObject({
      type: "arrow",
      start: { id: "p" },
      end: { id: "q" },
      x: 108,
      y: 25,
      points: [
        [0, 0],
        [184, 0],
      ],
      label: { text: "go" },
    });
    expect(placed).toMatchObject({ type: "arrow", x: 50, y: 58 });
    expect(placed!.start).toBeUndefined();
    expect(placed!.end).toBeUndefined();
    expect(result.skipped).toBe(1);
  });

  it("moves, restyles and relabels, keeping the label centred", () => {
    const result = applyWhiteboardOps(
      [rect("a", 0, 0), label("a", 0, 0)],
      ops({ update: [{ id: "a", x: 200, width: 200, label: "Renamed", backgroundColor: "#b2f2bb" }] }),
      deps,
    );
    const [box, text] = result.elements;
    expect(box).toMatchObject({ x: 200, y: 0, width: 200, backgroundColor: "#b2f2bb" });
    expect(text).toMatchObject({ text: "Renamed", originalText: "Renamed", x: 280, y: 15 });
    expect(result.changed).toBe(1);
  });

  it("adds a bound label to a shape that had none", () => {
    const plain: El = { id: "b", type: "ellipse", x: 0, y: 0, width: 100, height: 60, boundElements: null };
    const result = applyWhiteboardOps([plain], ops({ update: [{ id: "b", label: "Hi" }] }), deps);
    const text = result.elements.find((element) => element.type === "text")!;
    expect(text).toMatchObject({ containerId: "b", text: "Hi", x: 45, y: 25 });
    expect(result.elements[0]!.boundElements).toEqual([{ id: text.id, type: "text" }]);
    expect(result.added).toBe(0);
  });

  it("removes shapes with their labels and clears the sheet", () => {
    const scene = [rect("a", 0, 0), label("a", 0, 0), rect("b", 0, 100)];
    const removed = applyWhiteboardOps(scene, ops({ remove: ["a", "missing"] }), deps);
    expect(removed.elements.filter((element) => element.isDeleted).map((element) => element.id)).toEqual([
      "a",
      "a-text",
    ]);
    expect(removed.removed).toBe(1);
    expect(removed.skipped).toBe(1);
    const cleared = applyWhiteboardOps(scene, ops({ clear: true }), deps);
    expect(cleared.elements.every((element) => element.isDeleted)).toBe(true);
    expect(cleared.removed).toBe(2);
  });
});

describe("edgePoint", () => {
  it("leaves the box toward the target with a gap", () => {
    expect(edgePoint({ x: 0, y: 0, width: 100, height: 50 }, { x: 50, y: 500 }, 0)).toEqual({ x: 50, y: 50 });
    expect(edgePoint({ x: 0, y: 0, width: 100, height: 50 }, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });
});
