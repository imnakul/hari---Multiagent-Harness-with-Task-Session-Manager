// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { webLinkAt } from "./linkMenu";

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("link menu targets (L-202)", () => {
  it("finds the web link under the pointer, with its text", () => {
    const root = mount('<p><a href="https://example.com/docs"><b>The  docs</b></a></p>');
    const target = root.querySelector("b")!.firstChild!;
    expect(webLinkAt({ target, defaultPrevented: false })).toEqual({
      href: "https://example.com/docs",
      text: "The docs",
    });
  });

  it("uses the address when the link has no text", () => {
    const root = mount('<a href="https://example.com/"></a>');
    expect(webLinkAt({ target: root.querySelector("a"), defaultPrevented: false })?.text).toBe(
      "https://example.com/",
    );
  });

  it("leaves file links, other schemes and claimed clicks alone", () => {
    const root = mount(
      '<a id="file" href="file:///C:/x.txt">x</a><a id="mail" href="mailto:a@b.c">m</a><a id="web" href="https://a.test">w</a>',
    );
    expect(webLinkAt({ target: root.querySelector("#file"), defaultPrevented: false })).toBeNull();
    expect(webLinkAt({ target: root.querySelector("#mail"), defaultPrevented: false })).toBeNull();
    expect(webLinkAt({ target: root.querySelector("#web"), defaultPrevented: true })).toBeNull();
  });

  it("keeps the text menu inside editors and terminals", () => {
    const root = mount(
      '<div class="cm-editor"><a id="a" href="https://a.test">a</a></div><div contenteditable="true"><a id="b" href="https://b.test">b</a></div>',
    );
    expect(webLinkAt({ target: root.querySelector("#a"), defaultPrevented: false })).toBeNull();
    expect(webLinkAt({ target: root.querySelector("#b"), defaultPrevented: false })).toBeNull();
  });

  it("ignores clicks away from links", () => {
    const root = mount("<p>plain</p>");
    expect(webLinkAt({ target: root.querySelector("p"), defaultPrevented: false })).toBeNull();
  });
});
