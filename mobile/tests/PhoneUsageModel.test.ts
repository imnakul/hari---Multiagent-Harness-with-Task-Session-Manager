import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE,
  MAX_LOOKBACK_MS,
  chunk,
  newDeviceId,
  parseCursor,
  parseIntervals,
  readSince,
} from "@/features/phoneUsage/usageModel";

describe("phone usage model", () => {
  it("keeps well-formed intervals and drops the rest", () => {
    const json = JSON.stringify([
      { package: "com.chat", label: "Chat", start: 1000, end: 9000 },
      { package: "com.bad pkg", label: "x", start: 1000, end: 9000 },
      { package: "com.back", label: "x", start: 9000, end: 1000 },
      { package: "com.nolabel", start: 1000, end: 9000 },
      { package: "com.long", label: "x", start: 1, end: 1 + 25 * 60 * 60 * 1000 },
      "nope",
    ]);
    const out = parseIntervals(json);
    expect(out.map((item) => item.package)).toEqual(["com.chat", "com.nolabel"]);
    expect(out[1]?.label).toBe("com.nolabel");
    expect(parseIntervals("{not json")).toEqual([]);
    expect(parseIntervals("{}")).toEqual([]);
  });

  it("splits into chunks of 500", () => {
    const items = Array.from({ length: 1201 }, (_, index) => index);
    const parts = chunk(items);
    expect(parts.map((part) => part.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 201]);
    expect(chunk([])).toEqual([]);
  });

  it("starts at the cursor, never before 7 days ago, and a new phone gets 7 days", () => {
    const now = 100 * 24 * 60 * 60 * 1000;
    expect(readSince(null, now)).toBe(now - MAX_LOOKBACK_MS);
    expect(readSince(now - 1000, now)).toBe(now - 1000);
    expect(readSince(5, now)).toBe(now - MAX_LOOKBACK_MS);
  });

  it("reads the cursor reply defensively", () => {
    expect(parseCursor({ since: 42 })).toBe(42);
    expect(parseCursor({ since: null })).toBeNull();
    expect(parseCursor("x")).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });

  it("makes a device id the computer accepts", () => {
    expect(newDeviceId()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(newDeviceId(() => 0.5)).toBe("8000" + "8000-8000-8000-8000-800080008000");
  });
});
