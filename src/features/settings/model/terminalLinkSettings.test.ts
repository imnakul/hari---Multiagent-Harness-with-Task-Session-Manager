import { beforeEach, describe, expect, it } from "vitest";
import {
  TERMINAL_LINK_TARGET_KEY,
  loadTerminalLinkTarget,
  saveTerminalLinkTarget,
} from "./terminalLinkSettings";

describe("terminal link target", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    });
  });

  it("defaults to MonoCode's browser and ignores unknown values", () => {
    expect(loadTerminalLinkTarget()).toBe("monocode");
    data.set(TERMINAL_LINK_TARGET_KEY, "firefox");
    expect(loadTerminalLinkTarget()).toBe("monocode");
  });

  it("saves the default browser choice", () => {
    saveTerminalLinkTarget("default");
    expect(data.get(TERMINAL_LINK_TARGET_KEY)).toBe("default");
    expect(loadTerminalLinkTarget()).toBe("default");
    saveTerminalLinkTarget("monocode");
  });
});
