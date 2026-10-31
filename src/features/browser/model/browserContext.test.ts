import { describe, expect, it } from "vitest";
import {
  MAX_BODY_CHARS,
  consoleNote,
  networkNote,
  noteName,
  picksNote,
  shortUrl,
  sourcePath,
  textualMime,
} from "./browserContext";

describe("browser context notes", () => {
  it("keeps origin and path and drops a long query", () => {
    expect(shortUrl("http://localhost:5173/app?tab=1")).toBe("http://localhost:5173/app?tab=1");
    expect(shortUrl(`http://localhost:5173/app?q=${"x".repeat(80)}`)).toBe(
      "http://localhost:5173/app?…",
    );
    expect(shortUrl("not a url")).toBe("not a url");
  });

  it("turns a dev-server source URL into a project path with its line", () => {
    expect(sourcePath("http://localhost:5173/src/App.tsx:12:4")).toBe("/src/App.tsx:12");
    expect(sourcePath("http://localhost:5173/@fs/E:/proj/src/a.ts")).toBe("/E:/proj/src/a.ts");
    expect(sourcePath("App.tsx")).toBe("App.tsx");
  });

  it("writes picks as numbered comments with only what finds the element", () => {
    const note = picksNote({
      kind: "picks",
      url: "http://localhost:5173/",
      title: "Demo",
      viewport: { width: 1280, height: 800 },
      items: [
        {
          tag: "button",
          path: "main > button.save",
          text: "  Save\n changes ",
          components: ["SaveButton", "Toolbar"],
          source: "http://localhost:5173/src/Toolbar.tsx:40:2",
          rect: { x: 10, y: 20, width: 80, height: 32 },
          styles: { "font-size": "14px", "z-index": "3" },
          comment: "Make this blue",
        },
        { tag: "div", path: "#root > div" },
      ],
    });
    expect(note).toContain("Browser feedback on Demo · http://localhost:5173/ · viewport 1280×800");
    expect(note).toContain('1. Make this blue\n   element: <button> "Save changes"');
    expect(note).toContain("   component: SaveButton < Toolbar");
    expect(note).toContain("   source: /src/Toolbar.tsx:40");
    expect(note).toContain("   box: 80×32 at 10,20 · font-size: 14px");
    expect(note).not.toContain("z-index");
    expect(note).toContain("2. (no comment)");
  });

  it("cuts long console text and names its source", () => {
    const note = consoleNote(
      { kind: "console", level: "error", text: "e".repeat(5000), source: "http://localhost:3000/src/x.ts:9" },
      "http://localhost:3000/",
    );
    expect(note.startsWith("Browser console error on http://localhost:3000/:")).toBe(true);
    expect(note).toContain(`${"e".repeat(4000)}…`);
    expect(note.endsWith("at /src/x.ts:9")).toBe(true);
  });

  it("cuts long response bodies and skips binary ones", () => {
    const row = {
      kind: "network" as const,
      id: "1",
      method: "POST",
      url: "http://localhost:3000/api",
      postData: '{"a":1}',
      status: 500,
      statusText: "Server Error",
      mimeType: "application/json",
      size: 12,
      done: true,
    };
    const long = networkNote(row, { body: "b".repeat(MAX_BODY_CHARS + 10) });
    expect(long).toContain("status: 500 Server Error · application/json · 12 bytes");
    expect(long).toContain('request body:\n{"a":1}');
    expect(long).toContain("… (10 more characters cut)");
    expect(networkNote(row, { body: "AAAA", base64Encoded: true })).toContain(
      "response body: binary, not included",
    );
    expect(networkNote({ ...row, status: undefined, error: "net::ERR_FAILED" })).toContain(
      "status: failed: net::ERR_FAILED",
    );
  });

  it("fetches bodies only for text types and keeps chip names short", () => {
    expect(textualMime("application/json")).toBe(true);
    expect(textualMime("text/html")).toBe(true);
    expect(textualMime("image/png")).toBe(false);
    expect(textualMime()).toBe(false);
    expect(noteName("Console", "x".repeat(100)).length).toBe(48);
  });
});
