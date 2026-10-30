import { describe, expect, it } from "vitest";
import {
  createSheet,
  emptyWhiteboardIndex,
  exportFileName,
  markSheetSaved,
  newSheetId,
  nextSheetName,
  openSheet,
  parseWhiteboardIndex,
  removeSheet,
  renameSheet,
  serializeWhiteboardIndex,
  setSheetLocked,
  sheetScenePath,
  sortedSheets,
} from "./sheets";

describe("whiteboard sheets", () => {
  it("reads a broken or missing index as empty and drops bad rows", () => {
    expect(parseWhiteboardIndex(undefined)).toEqual(emptyWhiteboardIndex());
    expect(parseWhiteboardIndex("{nope")).toEqual(emptyWhiteboardIndex());
    const index = parseWhiteboardIndex(
      JSON.stringify({
        sheets: [
          { id: "a", name: "  First   sheet ", createdAt: 1, updatedAt: 2 },
          { id: "a", name: "Duplicate", createdAt: 1, updatedAt: 2 },
          { id: "../evil", name: "Bad id", createdAt: 1, updatedAt: 2 },
          { id: "b", name: "", createdAt: 1, updatedAt: 3, locked: true, saved: false },
        ],
        lastOpenedId: "missing",
      }),
    );
    expect(index.sheets).toEqual([
      { id: "a", name: "First sheet", createdAt: 1, updatedAt: 2, locked: false, saved: true },
      { id: "b", name: "Untitled", createdAt: 1, updatedAt: 3, locked: true, saved: false },
    ]);
    expect(index.lastOpenedId).toBeUndefined();
  });

  it("round-trips through JSON", () => {
    const { index } = createSheet(emptyWhiteboardIndex(), "s1", 10);
    expect(parseWhiteboardIndex(serializeWhiteboardIndex(index))).toEqual(index);
  });

  it("names new sheets with the next free number", () => {
    let { index } = createSheet(emptyWhiteboardIndex(), "s1", 1);
    ({ index } = createSheet(index, "s2", 2));
    expect(index.sheets.map((sheet) => sheet.name)).toEqual(["Sheet 1", "Sheet 2"]);
    index = renameSheet(index, "s1", "Plan", 3);
    expect(nextSheetName(index.sheets)).toBe("Sheet 1");
    expect(createSheet(index, "s3", 4, "  Ideas ").sheet.name).toBe("Ideas");
  });

  it("renames, but keeps the old name when the new one is empty", () => {
    const { index } = createSheet(emptyWhiteboardIndex(), "s1", 1);
    expect(renameSheet(index, "s1", "   ", 2)).toBe(index);
    const renamed = renameSheet(index, "s1", "x".repeat(200), 2);
    expect(renamed.sheets[0]!.name).toHaveLength(80);
    expect(renamed.sheets[0]!.updatedAt).toBe(2);
  });

  it("locks, marks saved and opens", () => {
    const { index } = createSheet(emptyWhiteboardIndex(), "s1", 1);
    const locked = setSheetLocked(index, "s1", true);
    expect(locked.sheets[0]!.locked).toBe(true);
    expect(setSheetLocked(locked, "s1", true)).toBe(locked);
    expect(markSheetSaved(index, "s1", 5).sheets[0]).toMatchObject({ saved: true, updatedAt: 5 });
    expect(openSheet(index, "nope")).toBe(index);
  });

  it("removes a sheet and picks the next one to show", () => {
    let { index } = createSheet(emptyWhiteboardIndex(), "s1", 1);
    ({ index } = createSheet(index, "s2", 5));
    ({ index } = createSheet(index, "s3", 3));
    const result = removeSheet(index, "s3");
    expect(result.index.sheets.map((sheet) => sheet.id)).toEqual(["s1", "s2"]);
    expect(result.nextId).toBe("s2");
    const other = removeSheet(openSheet(index, "s1"), "s2");
    expect(other.nextId).toBe("s1");
    expect(removeSheet(removeSheet(result.index, "s1").index, "s2").nextId).toBeUndefined();
  });

  it("sorts by last edit, builds paths and safe export names", () => {
    let { index } = createSheet(emptyWhiteboardIndex(), "s1", 1);
    ({ index } = createSheet(index, "s2", 9));
    expect(sortedSheets(index.sheets).map((sheet) => sheet.id)).toEqual(["s2", "s1"]);
    expect(sheetScenePath("C:/Users/me/.monocode/whiteboards", "s1")).toBe(
      "C:/Users/me/.monocode/whiteboards/s1.excalidraw",
    );
    expect(exportFileName('Plan: A/B <v2>? ', "png")).toBe("Plan AB v2.png");
    expect(exportFileName("...", "svg")).toBe("Whiteboard.svg");
  });

  it("makes ids the index accepts", () => {
    const id = newSheetId(() => 0.5, 1_700_000_000_000);
    expect(id).toMatch(/^wb-[a-z0-9]+-[a-z0-9]{6}$/);
    const { index } = createSheet(emptyWhiteboardIndex(), id, 1);
    expect(parseWhiteboardIndex(serializeWhiteboardIndex(index)).sheets).toHaveLength(1);
  });
});
