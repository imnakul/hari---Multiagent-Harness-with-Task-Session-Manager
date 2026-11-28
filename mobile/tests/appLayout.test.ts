import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItemSync: vi.fn(() => null), setItem: vi.fn(() => Promise.resolve()) },
}));

import { resolveLayout, resolveTabBarStyle } from "@/features/settings/appLayout";
import { changeLayout } from "@/features/settings/monoOnly";

describe("resolveLayout (AC-1)", () => {
  it("is classic with nothing stored", () => {
    expect(resolveLayout(null, null)).toBe("classic");
  });
  it("carries the old Monos only switch over", () => {
    expect(resolveLayout(null, "true")).toBe("monos");
    expect(resolveLayout(null, "false")).toBe("classic");
  });
  it("reads layout.app when set, over the old switch", () => {
    expect(resolveLayout("tabs", null)).toBe("tabs");
    expect(resolveLayout("tabs", "true")).toBe("tabs");
    expect(resolveLayout("monos", null)).toBe("monos");
    expect(resolveLayout("classic", "true")).toBe("classic");
  });
  it("reads any other value as classic", () => {
    expect(resolveLayout("garbage", null)).toBe("classic");
    expect(resolveLayout("garbage", "true")).toBe("classic");
  });
});

describe("resolveTabBarStyle (AC-8)", () => {
  it("defaults to floating", () => {
    expect(resolveTabBarStyle(null)).toBe("floating");
    expect(resolveTabBarStyle("other")).toBe("floating");
    expect(resolveTabBarStyle("fixed")).toBe("fixed");
  });
});

describe("changeLayout order (AC-2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("closes, resets, then sets, and ignores a second switch while changing", () => {
    const calls: string[] = [];
    const actions = { close: () => calls.push("close"), reset: () => calls.push("reset") };
    const set = (next: string) => calls.push(`set:${next}`);
    changeLayout("tabs", actions, set);
    changeLayout("monos", actions, set);
    expect(calls).toEqual(["close"]);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(["close", "reset", "set:tabs"]);
    vi.advanceTimersByTime(400);
    changeLayout("classic", actions, set);
    expect(calls.slice(3)).toEqual(["close"]);
    vi.advanceTimersByTime(1000);
  });
});
