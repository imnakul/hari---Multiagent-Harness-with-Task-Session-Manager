import { describe, expect, it } from "vitest";
import { comparableText, listMarkdown, markdownSections } from "./markdownSections";

describe("markdownSections", () => {
  it("ends a section at the next heading of the same or a higher level", () => {
    const sections = markdownSections(
      ["# Plan", "intro", "## One", "a", "### Deep", "b", "## Two", "c", "# Next", "d"].join("\n"),
    );
    expect(sections.map((section) => section.title)).toEqual(["Plan", "One", "Deep", "Two", "Next"]);
    expect(sections[1]?.markdown).toBe("## One\na\n### Deep\nb");
    expect(sections[0]?.markdown).toBe(
      ["# Plan", "intro", "## One", "a", "### Deep", "b", "## Two", "c"].join("\n"),
    );
    expect(sections[4]?.markdown).toBe("# Next\nd");
  });

  it("ignores # lines inside code fences and closing # runs", () => {
    const sections = markdownSections(
      ["## Setup ##", "```sh", "# not a heading", "```", "~~~", "## still code", "~~~", "done"].join("\n"),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe("Setup");
    expect(sections[0]?.markdown.endsWith("done")).toBe(true);
  });

  it("compares headings by letters and digits only", () => {
    expect(comparableText("**Key** decisions: 2")).toBe(comparableText("Key decisions 2"));
  });
});

describe("listMarkdown", () => {
  it("numbers from the list start and indents nested lists under their item", () => {
    expect(
      listMarkdown({
        ordered: true,
        start: 3,
        items: [
          { text: "First\nmore", children: { ordered: false, start: 1, items: [{ text: "inner", children: null }] } },
          { text: "Second", children: null },
        ],
      }),
    ).toBe("3. First\n   more\n   - inner\n4. Second");
  });
});
