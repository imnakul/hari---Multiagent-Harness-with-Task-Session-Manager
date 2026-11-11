import { describe, expect, it } from "vitest";
import { wrapLines } from "./RewriteReveal";

/** One unit per character keeps the expected breaks easy to read. */
const measure = (value: string): number => value.length;

describe("wrapLines (L-252 reveal)", () => {
  it("breaks at spaces like a pre-wrap box", () => {
    expect(wrapLines("fix the header spacing", 10, 0, measure)).toEqual([
      "fix the ",
      "header ",
      "spacing",
    ]);
  });

  it("keeps blank lines and explicit line breaks", () => {
    expect(wrapLines("one\n\ntwo", 10, 0, measure)).toEqual(["one", "", "two"]);
  });

  it("leaves room for the first-line indent only", () => {
    expect(wrapLines("abc def ghi", 8, 4, measure)).toEqual([
      "abc ",
      "def ghi",
    ]);
  });

  it("breaks a word wider than the box anywhere", () => {
    expect(wrapLines("abcdefghij", 4, 0, measure)).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });
});
