import { describe, expect, it } from "vitest";
import { clipboardJson, clipboardSelection } from "./whiteboardClipboard";

describe("whiteboard clipboard (L-199)", () => {
  const elements = [
    { id: "box" },
    { id: "label", containerId: "box" },
    { id: "frame" },
    { id: "inside", frameId: "frame" },
    { id: "other" },
    { id: "gone", isDeleted: true },
  ];

  it("takes the selection with its bound text and frame children", () => {
    const picked = clipboardSelection(elements, { box: true, frame: true, gone: true });
    expect(picked.map((element) => element.id)).toEqual(["box", "label", "frame", "inside"]);
  });

  it("writes Excalidraw's clipboard JSON with only the files in use", () => {
    const json = JSON.parse(
      clipboardJson([{ id: "img", fileId: "f1" }], { f1: { id: "f1" }, f2: { id: "f2" } }),
    );
    expect(json.type).toBe("excalidraw/clipboard");
    expect(Object.keys(json.files)).toEqual(["f1"]);
  });
});
