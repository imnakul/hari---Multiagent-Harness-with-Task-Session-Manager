import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { saveLinkPreviewMode } from "../../settings/model/linkPreviewSettings";

// Node has no localStorage, so a saved mode is held in memory for these tests.
const text = [
  "Read [the guide](https://example.org/guide) and https://example.com/blog.",
  "",
  "Also https://news.example.net/today and https://fourth.example.dev/.",
  "",
  "`https://code.example.com` is only an example.",
].join("\n");

function render(props: { localMedia?: boolean; streaming?: boolean } = {}) {
  return renderToStaticMarkup(
    createElement(AgentMarkdown, { text, localMedia: true, ...props }),
  );
}

function cardUrls(markup: string): string[] {
  return [...markup.matchAll(/data-link-card="([^"]+)"/g)].map((m) => m[1]);
}

describe("AgentMarkdown link previews", () => {
  afterEach(() => saveLinkPreviewMode("hover"));

  it("wraps chat links in a hover card by default, without inline cards", () => {
    const markup = render();
    expect(markup).toContain('<span><a href="https://example.org/guide"');
    expect(cardUrls(markup)).toEqual([]);
  });

  it("leaves links plain when previews are off", () => {
    saveLinkPreviewMode("off");
    const markup = render();
    expect(markup).not.toContain('<span><a href="https://example.org/guide"');
    expect(markup).toContain('href="https://example.org/guide"');
    expect(cardUrls(markup)).toEqual([]);
  });

  it("adds up to three cards under a finished reply when always on", () => {
    saveLinkPreviewMode("always");
    expect(cardUrls(render())).toEqual([
      "https://example.org/guide",
      "https://example.com/blog",
      "https://news.example.net/today",
    ]);
  });

  it("lets a card grow with its text instead of clipping it", () => {
    saveLinkPreviewMode("always");
    const card = render().match(/<a[^>]*data-link-card="[^"]+"[^>]*>/)?.[0];
    expect(card).toContain("min-h-[5.5rem]");
    expect(card).not.toMatch(/(?:^|s)h-[5.5rem]/);
  });

  it("waits for the reply to finish, and only in chats", () => {
    saveLinkPreviewMode("always");
    expect(cardUrls(render({ streaming: true }))).toEqual([]);
    expect(cardUrls(render({ localMedia: false }))).toEqual([]);
  });
});
