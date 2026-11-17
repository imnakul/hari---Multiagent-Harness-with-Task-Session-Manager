// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWindowWidth } from "./useWindowWidth";

describe("window width (L-335)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("holds the last real width while the window is minimised or hidden", () => {
    vi.stubGlobal("innerWidth", 1600);
    expect(readWindowWidth()).toBe(1600);
    vi.stubGlobal("innerWidth", 0);
    expect(readWindowWidth()).toBe(1600);
    vi.stubGlobal("innerWidth", 160);
    expect(readWindowWidth()).toBe(1600);
    vi.stubGlobal("innerWidth", 1200);
    expect(readWindowWidth()).toBe(1200);
  });
});
