// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_URL,
  addressFromInput,
  isWebUrl,
  loadLastBrowserUrl,
  nextBrowserRequest,
  openInMonoBrowser,
  overlapsPage,
  saveLastBrowserUrl,
  subscribeOpenInBrowser,
} from "./browserRequest";

afterEach(() => localStorage.clear());

describe("Browser tab requests (L-203)", () => {
  it("turns address-bar text into an address or a search", () => {
    expect(addressFromInput("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(addressFromInput("  example.com/docs ")).toBe("https://example.com/docs");
    expect(addressFromInput("localhost:5173")).toBe("http://localhost:5173");
    expect(addressFromInput("127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
    expect(addressFromInput("tauri multiwebview")).toBe(`${SEARCH_URL}tauri%20multiwebview`);
    expect(addressFromInput("hello")).toBe(`${SEARCH_URL}hello`);
    expect(addressFromInput("   ")).toBeNull();
  });

  it("opens only web pages", () => {
    expect(isWebUrl("http://a.test")).toBe(true);
    expect(isWebUrl("file:///C:/x")).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });

  it("makes each request distinct, even for the same page", () => {
    const first = nextBrowserRequest(null, "https://a.test");
    const again = nextBrowserRequest(first, "https://a.test");
    expect(again.id).not.toBe(first.id);
  });

  it("delivers web links to the subscriber and drops anything else", () => {
    const onOpen = vi.fn();
    const stop = subscribeOpenInBrowser(onOpen);
    openInMonoBrowser("https://a.test/");
    openInMonoBrowser("file:///etc/passwd");
    stop();
    openInMonoBrowser("https://b.test/");
    expect(onOpen.mock.calls).toEqual([["https://a.test/"]]);
  });

  it("remembers the last web page only", () => {
    saveLastBrowserUrl("https://a.test/");
    saveLastBrowserUrl("about:blank");
    expect(loadLastBrowserUrl()).toBe("https://a.test/");
  });

  it("hides the page only when a layer really covers it", () => {
    const page = { left: 100, top: 50, right: 900, bottom: 700 };
    expect(overlapsPage(page, { left: 120, top: 60, right: 300, bottom: 200 })).toBe(true);
    expect(overlapsPage(page, { left: 0, top: 0, right: 100, bottom: 50 })).toBe(false);
    expect(overlapsPage(page, { left: 200, top: 200, right: 200, bottom: 400 })).toBe(false);
  });
});
