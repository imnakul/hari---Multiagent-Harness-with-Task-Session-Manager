import { describe, expect, it } from "vitest";
import { quoteText } from "./quoteContent";

const text = (value: string) => ({ type: "text", value });
const el = (
  tagName: string,
  children: unknown[] = [],
  properties: Record<string, unknown> = {},
) => ({ type: "element", tagName, properties, children });

describe("quoteText (L-188)", () => {
  it("keeps paragraphs, inline marks, code fences and lists", () => {
    const node = el("blockquote", [
      text("\n"),
      el("p", [
        text("Send "),
        el("strong", [text("this")]),
        text(" with "),
        el("code", [text("POST")]),
        text(" to "),
        el("a", [text("docs")], { href: "https://x.test" }),
      ]),
      text("\n"),
      el("pre", [el("code", [text('{ "a": 1 }\n')], { className: ["language-json"] })]),
      el("ol", [el("li", [text("one")]), el("li", [el("p", [text("two")]), el("ul", [el("li", [text("nested")])])])], { start: 3 }),
      el("blockquote", [el("p", [text("inner")]), el("p", [text("more")])]),
    ]);
    expect(quoteText(node)).toBe(
      [
        "Send **this** with `POST` to [docs](https://x.test)",
        "",
        "```json",
        '{ "a": 1 }',
        "```",
        "",
        "3. one",
        "4. two",
        "",
        "   - nested",
        "",
        "> inner",
        ">",
        "> more",
      ].join("\n"),
    );
  });

  it("reads a quote that holds bare text and handles missing nodes", () => {
    expect(quoteText(el("blockquote", [text(" plain words ")]))).toBe("plain words");
    expect(quoteText(undefined)).toBe("");
    expect(quoteText({})).toBe("");
  });
});
