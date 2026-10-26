import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { activeLinesFor, collectLiveSpecs, type LiveSpec } from "./markdownLive";

function stateFor(doc: string, cursor?: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: cursor === undefined ? undefined : EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, doc.length, 5_000);
  return state;
}

/** Specs for the whole document with the given lines (1-based) active. */
function specs(doc: string, active: number[] = []): LiveSpec[] {
  const state = stateFor(doc);
  return collectLiveSpecs(state, [{ from: 0, to: doc.length }], new Set(active));
}

/** The text each `hide` spec removes, in order. */
function hiddenText(doc: string, active: number[] = []): string[] {
  return specs(doc, active)
    .filter((spec) => spec.kind === "hide")
    .map((spec) => doc.slice(spec.from, spec.to));
}

describe("collectLiveSpecs", () => {
  it("styles a heading line and hides its hashes until the line is active", () => {
    const doc = "## Plan ##\ntext";
    expect(specs(doc)).toContainEqual({ kind: "line", at: 0, className: "cm-live-h2" });
    expect(hiddenText(doc)).toEqual(["## ", " ##"]);
    expect(hiddenText(doc, [1])).toEqual([]);
  });

  it("formats emphasis and hides only the marks", () => {
    const doc = "a **bold** and *em* and ~~gone~~ and `code`";
    const kinds = specs(doc).filter((spec) => spec.kind === "mark");
    expect(kinds.map((spec) => spec.kind === "mark" && spec.className)).toEqual(
      expect.arrayContaining(["cm-live-strong", "cm-live-em", "cm-live-strike", "cm-live-code"]),
    );
    expect(hiddenText(doc)).toEqual(["**", "**", "*", "*", "~~", "~~", "`", "`"]);
  });

  it("keeps marks visible, dimmed, on the active line", () => {
    const doc = "**bold**";
    expect(hiddenText(doc, [1])).toEqual([]);
    expect(specs(doc, [1])).toContainEqual({
      kind: "mark",
      from: 0,
      to: 2,
      className: "cm-live-syntax",
    });
  });

  it("shows a link's text with its URL and hides the brackets and target", () => {
    const doc = "see [docs](https://x.dev) now";
    expect(specs(doc)).toContainEqual({
      kind: "mark",
      from: 5,
      to: 9,
      className: "cm-live-link",
      url: "https://x.dev",
    });
    expect(hiddenText(doc)).toEqual(["[", "](https://x.dev)"]);
  });

  it("marks bare and angle-bracket URLs as links", () => {
    const doc = "go https://a.dev or <https://b.dev>";
    const links = specs(doc).filter(
      (spec): spec is Extract<LiveSpec, { kind: "mark" }> =>
        spec.kind === "mark" && spec.className === "cm-live-link",
    );
    expect(links.map((link) => link.url)).toEqual(["https://a.dev", "https://b.dev"]);
    expect(hiddenText(doc)).toEqual(["<", ">"]);
  });

  it("turns bullets into dots and task markers into checkboxes", () => {
    const doc = "- item\n- [ ] todo\n- [x] done\n1. first";
    const all = specs(doc);
    expect(all).toContainEqual({ kind: "bullet", from: 0, to: 1 });
    expect(all).toContainEqual({ kind: "task", from: 9, to: 12, checked: false });
    expect(all).toContainEqual({ kind: "task", from: 20, to: 23, checked: true });
    expect(all).toContainEqual({ kind: "mark", from: 23, to: 28, className: "cm-live-task-done" });
    // Task items hide their "- " so only the checkbox shows; numbers stay.
    expect(hiddenText(doc)).toEqual(["- ", "- "]);
    expect(all).toContainEqual({ kind: "mark", from: 29, to: 31, className: "cm-live-list-mark" });
  });

  it("shows raw list syntax on the active line", () => {
    const all = specs("- [ ] todo", [1]);
    expect(all.some((spec) => spec.kind === "task" || spec.kind === "bullet")).toBe(false);
  });

  it("styles quotes per line and hides the quote mark", () => {
    const doc = "> one\n> two";
    expect(specs(doc).filter((spec) => spec.kind === "line")).toEqual([
      { kind: "line", at: 0, className: "cm-live-quote" },
      { kind: "line", at: 6, className: "cm-live-quote" },
    ]);
    expect(hiddenText(doc)).toEqual(["> ", "> "]);
  });

  it("replaces a rule and an image only off the active line", () => {
    const doc = "---\n\n![logo](note-assets/a/b.png)";
    expect(specs(doc)).toContainEqual({ kind: "rule", from: 0, to: 3 });
    expect(specs(doc)).toContainEqual({
      kind: "image",
      from: 5,
      to: 33,
      url: "note-assets/a/b.png",
      alt: "logo",
    });
    expect(specs(doc, [1, 3]).some((spec) => spec.kind === "rule" || spec.kind === "image")).toBe(
      false,
    );
  });

  it("leaves code blocks unformatted inside, with fence lines dimmed", () => {
    const doc = "```ts\nconst **a** = 1;\n```";
    const all = specs(doc);
    expect(all.filter((spec) => spec.kind === "line" && spec.className === "cm-live-codeblock"))
      .toHaveLength(3);
    expect(all.filter((spec) => spec.kind === "line" && spec.className === "cm-live-fence"))
      .toEqual([
        { kind: "line", at: 0, className: "cm-live-fence" },
        { kind: "line", at: 23, className: "cm-live-fence" },
      ]);
    expect(hiddenText(doc)).toEqual([]);
  });

  it("only formats the requested range and never repeats a spec", () => {
    const doc = "# One\n\n# Two";
    const state = stateFor(doc);
    const firstOnly = collectLiveSpecs(state, [{ from: 0, to: 5 }], new Set());
    expect(firstOnly.filter((spec) => spec.kind === "line")).toEqual([
      { kind: "line", at: 0, className: "cm-live-h1" },
    ]);
    const twice = collectLiveSpecs(
      state,
      [
        { from: 0, to: 5 },
        { from: 0, to: doc.length },
      ],
      new Set(),
    );
    const keys = twice.map((spec) => JSON.stringify(spec));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("activeLinesFor", () => {
  it("is empty while blurred and lists selected lines while focused", () => {
    const state = stateFor("a\nb\nc", 2);
    expect(activeLinesFor(state, false).size).toBe(0);
    expect([...activeLinesFor(state, true)]).toEqual([2]);
    const range = state.update({ selection: EditorSelection.range(0, 4) }).state;
    expect([...activeLinesFor(range, true)]).toEqual([1, 2, 3]);
  });
});
