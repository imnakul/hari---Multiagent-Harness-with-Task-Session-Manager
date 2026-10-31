import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMarkdown, isBareLink } from "./AgentMarkdown";
import {
  saveLinkCardStyle,
  saveLinkPreviewMode,
} from "../../settings/model/linkPreviewSettings";

// Node has no localStorage, so a saved mode is held in memory for these tests.
const text = [
  "Read [the guide](https://example.org/guide) and https://example.com/blog.",
  "",
  "Also https://news.example.net/today and https://fourth.example.dev/.",
  "",
  "`https://code.example.com` is only an example.",
].join("\n");

function render(
  props: { localMedia?: boolean; linkPreviews?: boolean; streaming?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(AgentMarkdown, { text, localMedia: true, ...props }),
  );
}

function chipUrls(markup: string): string[] {
  return [...markup.matchAll(/data-link-chip="([^"]+)"/g)].map((m) => m[1]!);
}

describe("AgentMarkdown link previews", () => {
  afterEach(() => saveLinkPreviewMode("hover"));

  it("wraps chat links in a hover card by default, without chips", () => {
    const markup = render();
    expect(markup).toContain('<span><a href="https://example.org/guide"');
    expect(chipUrls(markup)).toEqual([]);
  });

  it("leaves links plain when previews are off", () => {
    saveLinkPreviewMode("off");
    const markup = render();
    expect(markup).not.toContain('<span><a href="https://example.org/guide"');
    expect(markup).toContain('href="https://example.org/guide"');
    expect(chipUrls(markup)).toEqual([]);
  });

  it("turns every web link into a chip when always on, but not code (L-212)", () => {
    saveLinkPreviewMode("always");
    const markup = render();
    expect(chipUrls(markup)).toEqual([
      "https://example.org/guide",
      "https://example.com/blog",
      "https://news.example.net/today",
      "https://fourth.example.dev/",
    ]);
    // Each chip's card is under its line, so no hover card wraps it (L-224).
    expect(markup).not.toContain('<span><a href="https://example.org/guide"');
    expect(markup.match(/link-cards-below/g)).toHaveLength(2);
  });

  it("keeps a link's own words and shows the site name for a bare URL until the title loads", () => {
    saveLinkPreviewMode("always");
    const markup = render();
    expect(markup).toMatch(/data-link-chip="https:\/\/example\.org\/guide".*?the guide/);
    expect(markup).toMatch(/data-link-chip="https:\/\/news\.example\.net\/today".*?news\.example\.net</);
  });

  it("waits for the reply to finish, and only in chat text", () => {
    saveLinkPreviewMode("always");
    expect(chipUrls(render({ streaming: true }))).toEqual([]);
    expect(chipUrls(render({ localMedia: false }))).toEqual([]);
    // Text between steps and Mono reports opt in without local media.
    expect(chipUrls(render({ localMedia: false, linkPreviews: true }))).toHaveLength(4);
    expect(chipUrls(render({ linkPreviews: false }))).toEqual([]);
  });
});

describe("AgentMarkdown link cards (L-217)", () => {
  afterEach(() => saveLinkPreviewMode("hover"));

  const lines = [
    "See this:",
    "",
    "https://solo.example.com/post",
    "",
    "- [Docs](https://docs.example.com/start)",
    "- Read https://inline.example.com/a for more",
    "",
    "Mixed https://mixed.example.com/x text.",
  ].join("\n");

  function cards(markup: string): string[] {
    return [...markup.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]!);
  }

  it("shows a link alone in its paragraph or list item as a card when always on", () => {
    saveLinkPreviewMode("always");
    const markup = renderToStaticMarkup(createElement(AgentMarkdown, { text: lines, localMedia: true }));
    expect(cards(markup)).toEqual([
      "https://solo.example.com/post",
      "https://docs.example.com/start",
      "https://inline.example.com/a",
      "https://mixed.example.com/x",
    ]);
    // Links inside prose stay chips, with their cards under the line (L-224).
    expect(chipUrls(markup)).toEqual(["https://inline.example.com/a", "https://mixed.example.com/x"]);
  });

  it("shows a labelled link as its card, and cards under a line of text (L-224)", () => {
    saveLinkPreviewMode("always");
    const text = [
      "- **GitHub:** [owner/repo](https://github.com/owner/repo)",
      "- See [one](https://one.example.com/) and [two](https://two.example.com/), or [one](https://one.example.com/) again.",
    ].join("\n");
    const markup = renderToStaticMarkup(createElement(AgentMarkdown, { text, localMedia: true }));
    expect(cards(markup)).toEqual([
      "https://github.com/owner/repo",
      "https://one.example.com/",
      "https://two.example.com/",
    ]);
    expect(chipUrls(markup)).toEqual([
      "https://one.example.com/",
      "https://two.example.com/",
      "https://one.example.com/",
    ]);
    expect(markup).toContain("GitHub:");
    // The copies under the line are left out of the tab order.
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it("draws every card, under a line too, in the chosen card style (L-229)", () => {
    saveLinkPreviewMode("always");
    const styles = (markup: string) =>
      [...markup.matchAll(/data-card-style="([^"]+)"/g)].map((m) => m[1]!);
    const render = () =>
      renderToStaticMarkup(createElement(AgentMarkdown, { text: lines, localMedia: true }));
    expect(styles(render())).toEqual(["compact", "compact", "compact", "compact"]);
    saveLinkCardStyle("large-side");
    try {
      expect(styles(render())).toEqual(["large-side", "large-side", "large-side", "large-side"]);
    } finally {
      saveLinkCardStyle("compact");
    }
  });

  it("shows no cards in hover mode", () => {
    const markup = renderToStaticMarkup(createElement(AgentMarkdown, { text: lines, localMedia: true }));
    expect(cards(markup)).toEqual([]);
    expect(markup).not.toContain("data-link-card");
  });
});

describe("isBareLink", () => {
  it("matches a link whose text is its own address", () => {
    expect(isBareLink("https://example.com/blog", "https://example.com/blog")).toBe(true);
    expect(isBareLink("example.com/blog", "https://example.com/blog/")).toBe(true);
    expect(isBareLink("", "https://example.com")).toBe(true);
    expect(isBareLink("the guide", "https://example.org/guide")).toBe(false);
  });
});
