import { describe, expect, it } from "vitest";
import { parsePhoneSummary } from "./activity";

describe("parsePhoneSummary", () => {
  it("keeps well-formed rows and drops the rest", () => {
    const data = parsePhoneSummary({
      available: true,
      devices: [{ name: "Pixel", lastSync: 5 }, { name: 3 }],
      apps: [{ app: "Chat", ms: 10 }, { app: "x", ms: "n" }, null],
      activeSpans: [{ start: 1, end: 2 }, { start: 5, end: 5 }],
    });
    expect(data).toEqual({
      available: true,
      devices: [{ name: "Pixel", lastSync: 5 }],
      apps: [{ app: "Chat", ms: 10 }],
      activeSpans: [{ start: 1, end: 2 }],
    });
  });

  it("reads anything unexpected as no phone", () => {
    for (const raw of [null, "x", 4, undefined]) {
      expect(parsePhoneSummary(raw).available).toBe(false);
    }
    expect(parsePhoneSummary({}).apps).toEqual([]);
  });
});
