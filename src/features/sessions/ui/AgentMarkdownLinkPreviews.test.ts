import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMarkdown, isBareLink } from "./AgentMarkdown";
import { saveLinkPreviewMode } from "../../settings/model/linkPreviewSettings";

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
    // The hover card still wraps each chip.
    expect(markup).toContain('<span><a href="https://example.org/guide"');
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

describe("isBareLink", () => {
  it("matches a link whose text is its own address", () => {
    expect(isBareLink("https://example.com/blog", "https://example.com/blog")).toBe(true);
    expect(isBareLink("example.com/blog", "https://example.com/blog/")).toBe(true);
    expect(isBareLink("", "https://example.com")).toBe(true);
    expect(isBareLink("the guide", "https://example.org/guide")).toBe(false);
  });
});
