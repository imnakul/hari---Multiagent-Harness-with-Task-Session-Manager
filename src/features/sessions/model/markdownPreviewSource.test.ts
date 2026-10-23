import { describe, expect, it } from "vitest";
import {
  lineAtOffset,
  plainMarkdownLine,
  sourceOffsetForPreviewClick,
  type PreviewClickTarget,
} from "./markdownPreviewSource";

function click(partial: Partial<PreviewClickTarget>): PreviewClickTarget {
  return { blockText: "", occurrence: 0, lineInBlock: 0, word: "", ...partial };
}

/** The `[line, column]` the caret lands on, for readable assertions. */
function caret(source: string, target: PreviewClickTarget): [number, number] | null {
  const offset = sourceOffsetForPreviewClick(source, target);
  if (offset === null) return null;
  const line = lineAtOffset(source, offset);
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return [line, offset - lineStart];
}

describe("plainMarkdownLine", () => {
  it("drops block syntax, emphasis and link targets", () => {
    expect(plainMarkdownLine("## **Plan** for `v2`")).toBe("plan for v2");
    expect(plainMarkdownLine("> - [x] Ship [docs](https://x.dev)")).toBe("ship docs");
    expect(plainMarkdownLine("12. ![logo](a.png) text")).toBe("logo text");
    expect(plainMarkdownLine("| a | b |")).toBe("a b");
  });
});

describe("sourceOffsetForPreviewClick", () => {
  const doc = [
    "# Release plan", // 0
    "", // 1
    "Ship the **Windows** build", // 2
    "then tell the team", // 3
    "", // 4
    "- [ ] Fix", // 5
    "- [ ] Fix the tray icon", // 6
    "", // 7
    "```ts", // 8
    "const a = 1;", // 9
    "const b = 2;", // 10
    "```", // 11
  ].join("\n");

  it("finds a heading and puts the caret after its hashes", () => {
    expect(caret(doc, click({ blockText: "Release plan" }))).toEqual([0, 2]);
  });

  it("places the caret on the clicked word, inside emphasis", () => {
    expect(
      caret(doc, click({ blockText: "Ship the Windows build", word: "Windows" })),
    ).toEqual([2, 11]);
  });

  it("follows hard breaks to the clicked line of a paragraph", () => {
    expect(
      caret(
        doc,
        click({ blockText: "Ship the Windows build", lineInBlock: 1, word: "team" }),
      ),
    ).toEqual([3, 14]);
  });

  it("prefers the exact line over one that only starts the same", () => {
    expect(caret(doc, click({ blockText: "Fix" }))).toEqual([5, 6]);
    expect(caret(doc, click({ blockText: "Fix the tray icon" }))).toEqual([6, 6]);
  });

  it("counts lines inside a code block", () => {
    expect(
      caret(doc, click({ blockText: "const a = 1;", lineInBlock: 1, word: "b" })),
    ).toEqual([10, 6]);
  });

  it("uses the occurrence to pick between identical blocks", () => {
    const repeated = "- Todo\n\ntext\n\n- Todo";
    expect(caret(repeated, click({ blockText: "Todo", occurrence: 1 }))).toEqual([4, 2]);
    // More occurrences than lines: the last match, not nothing.
    expect(caret(repeated, click({ blockText: "Todo", occurrence: 5 }))).toEqual([4, 2]);
  });

  it("matches a table cell to its row", () => {
    const table = "| Name | Size |\n| --- | --- |\n| tray | 12 |";
    expect(caret(table, click({ blockText: "tray", word: "tray" }))).toEqual([2, 2]);
  });

  it("falls back to the clicked word when the block text is not found", () => {
    expect(caret(doc, click({ blockText: "rendered only", word: "team" }))).toEqual([
      3, 14,
    ]);
  });

  it("returns null when nothing matches", () => {
    expect(sourceOffsetForPreviewClick(doc, click({ blockText: "zzz" }))).toBeNull();
    expect(sourceOffsetForPreviewClick("", click({}))).toBeNull();
  });

  it("keeps the line index inside the document", () => {
    expect(caret("only line", click({ blockText: "only line", lineInBlock: 4 }))).toEqual([
      0, 0,
    ]);
  });
});

describe("lineAtOffset", () => {
  it("counts newlines before the offset and clamps", () => {
    expect(lineAtOffset("a\nb\nc", 0)).toBe(0);
    expect(lineAtOffset("a\nb\nc", 2)).toBe(1);
    expect(lineAtOffset("a\nb\nc", 99)).toBe(2);
    expect(lineAtOffset("a\nb", -3)).toBe(0);
  });
});
