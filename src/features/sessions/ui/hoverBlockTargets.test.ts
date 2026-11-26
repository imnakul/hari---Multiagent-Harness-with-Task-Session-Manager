// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  altClickContent,
  hoverTargetAt,
  listContent,
  sectionBlocks,
  sectionContent,
} from "./hoverBlockTargets";

function reply(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "agent-markdown";
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

function element(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

const SOURCE = [
  "Intro line.",
  "",
  "## Key **decisions**",
  "",
  "- One",
  "- Two",
  "",
  "### Detail",
  "",
  "More.",
  "",
  "## Open questions",
  "",
  "None.",
].join("\n");

const HTML = [
  "<p>Intro line.</p>",
  '<div class="agent-markdown-block"><h2>Key <strong>decisions</strong></h2></div>',
  "<ul><li>One</li><li>Two<ul><li>Inner</li></ul></li></ul>",
  "<h3>Detail</h3>",
  "<p>More.</p>",
  "<h2>Open questions</h2>",
  "<p>None.</p>",
  "<pre><code>## not here</code></pre>",
  "<blockquote data-quote-actions><ul><li>quoted</li></ul></blockquote>",
].join("");

describe("hoverTargetAt", () => {
  it("finds the section heading, the outermost list, and nothing on blocks with their own actions", () => {
    const root = reply(HTML);
    expect(hoverTargetAt(element(root, "h2 strong"), root)).toEqual({
      kind: "section",
      element: element(root, "h2"),
    });
    const inner = element(root, "ul ul li");
    expect(hoverTargetAt(inner, root)).toEqual({ kind: "list", element: element(root, "ul") });
    expect(hoverTargetAt(element(root, "pre code"), root)).toBeNull();
    expect(hoverTargetAt(element(root, "blockquote li"), root)).toBeNull();
    expect(hoverTargetAt(element(root, "p"), root)).toBeNull();
  });
});

describe("sectionContent", () => {
  it("copies the heading's Markdown up to the next heading of the same level", () => {
    const root = reply(HTML);
    const heading = element(root, "h2");
    expect(sectionBlocks(heading, root)).toHaveLength(4);
    const content = sectionContent(heading, root, SOURCE);
    expect(content.text).toBe("## Key **decisions**\n\n- One\n- Two\n\n### Detail\n\nMore.");
    expect(content.html).toContain("<strong>decisions</strong>");
    expect(content.html).not.toContain("Open questions");
  });

  it("falls back to the rendered text when the source heading does not match", () => {
    const root = reply(HTML);
    const content = sectionContent(element(root, "h2"), root, "## Something else\n\ntext");
    expect(content.text.startsWith("Key decisions")).toBe(true);
    expect(content.text).toContain("More.");
  });
});

describe("listContent and altClickContent", () => {
  it("copies a list as Markdown with nested items indented", () => {
    const root = reply(HTML);
    expect(listContent(element(root, "ul")).text).toBe("- One\n- Two\n  - Inner");
  });

  it("Alt+click copies one paragraph or one list item without its nested list", () => {
    const root = reply(HTML);
    expect(altClickContent(element(root, "p"), root)?.content.text).toBe("Intro line.");
    const two = root.querySelectorAll("ul > li")[1];
    if (!two) throw new Error("missing item");
    expect(altClickContent(two, root)?.content.text).toBe("Two");
    expect(altClickContent(element(root, "pre code"), root)).toBeNull();
  });
});
