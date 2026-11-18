import { describe, expect, it, vi } from "vitest";

import { blockCopyText, parseMarkdown } from "@/features/sessions/markdownParser";
import { selectableRuns } from "@/features/sessions/selectableText";
import { bookmarkLine } from "@/features/tools/tools";

vi.mock("expo-sqlite/kv-store", () => ({ default: { getItemSync: () => null, setItemSync: () => undefined } }));
vi.mock("@/features/link/linkStream", () => ({}));

describe("select text page (L-351)", () => {
  it("drops markers and keeps code as its own runs", () => {
    const runs = selectableRuns("Use **bold** and `npm test`.\n\n- one\n- two\n\n```sh\nls\n```");
    expect(runs.map((run) => run.text).join("")).toBe("Use bold and npm test.\n\n• one\n• two\n\nls");
    expect(runs.filter((run) => run.code).map((run) => run.text)).toEqual(["npm test", "ls"]);
  });

  it("reads a table's rows as plain lines", () => {
    const runs = selectableRuns("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(runs).toEqual([{ text: "A  |  B\n1  |  2", code: false }]);
  });
});

describe("block actions' text (L-352)", () => {
  it("copies code, a table as Markdown, and a quote's words", () => {
    const [code, table, quote] = parseMarkdown(
      "```ts\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| x **y** | z |\n\n> Keep **this**\n>\n> and that",
    );
    expect(blockCopyText(code)).toBe("const a = 1;");
    expect(blockCopyText(table)).toBe("| A | B |\n| --- | --- |\n| x y | z |");
    expect(blockCopyText(quote)).toBe("Keep this\n\nand that");
  });
});

describe("bookmark line (L-354)", () => {
  it("is the first line, capped as the desktop's", () => {
    expect(bookmarkLine("\n  Fixed it  \nmore")).toBe("Fixed it");
    expect(bookmarkLine("x".repeat(100))).toBe(`${"x".repeat(89)}…`);
  });
});
