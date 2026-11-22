import { describe, expect, it } from "vitest";
import { makeTask } from "../model/clickupTestKit";
import { splitWidths } from "./ClickupTaskViews";
import { linksIn, taskLinks } from "./ClickupTaskDetails";

describe("ClickUp task links (L-381)", () => {
  it("finds web links in text without trailing punctuation or Markdown brackets", () => {
    expect(linksIn("See [prod](https://app.example.com/a?b=1). Also http://x.io/y, and ftp://no")).toEqual([
      "https://app.example.com/a?b=1",
      "http://x.io/y",
    ]);
  });

  it("lists URL fields, then description, then comment links, once each", () => {
    const task = makeTask("1", {
      markdownDescription: "https://b.example and https://a.example",
      customFields: [
        { id: "u", name: "Related Links", type: "url", text: "https://a.example", color: null },
        { id: "j", name: "Script", type: "url", text: "javascript:alert(1)", color: null },
      ],
    });
    expect(taskLinks(task, [{ text: "also https://c.example" }])).toEqual([
      { url: "https://a.example", source: "Related Links" },
      { url: "https://b.example", source: "Description" },
      { url: "https://c.example", source: "Comment" },
    ]);
  });
});

describe("ClickUp board dividers (L-381)", () => {
  it("moves width between two neighbours only, keeping the row's total and a minimum", () => {
    expect(splitWidths([300, 300, 300], 0, 400)).toEqual([400, 200, 300]);
    expect(splitWidths([300, 300, 300], 1, 900)).toEqual([300, 460, 140]);
    expect(splitWidths([300, 300, 300], 0, 10)).toEqual([140, 460, 300]);
    expect(splitWidths([100, 100], 0, 180)).toEqual([100, 100]);
    expect(splitWidths([300, 300], 1, 500)).toEqual([300, 300]);
  });
});
