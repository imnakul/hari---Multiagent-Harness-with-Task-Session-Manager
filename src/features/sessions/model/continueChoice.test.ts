import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContinueChoice } from "./continueCard";
import { loadContinueChoice, parseContinueChoice, saveContinueChoice } from "./continueChoice";

const choice: ContinueChoice = {
  target: { harness: "codex", model: "gpt", modelSettings: { effort: "high" } },
  preset: "thorough",
  helper: { provider: "claude", model: "sonnet" },
  passes: 1,
  context: "long",
};

describe("continue choice (L-189)", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the last choice per project folder", () => {
    saveContinueChoice("/repo/a", choice);
    saveContinueChoice("/repo/b", { ...choice, preset: "quick" });
    expect(loadContinueChoice("/repo/a")).toEqual(choice);
    expect(loadContinueChoice("/repo/b")?.preset).toBe("quick");
    expect(loadContinueChoice("/repo/c")).toBeNull();
  });

  it("drops unknown or broken fields", () => {
    expect(
      parseContinueChoice({
        target: { harness: "codex", model: "gpt", modelSettings: { effort: 3 } },
        preset: "huge",
        helper: { provider: "cursor" },
        passes: 5,
        context: "medium",
      }),
    ).toEqual({ target: { harness: "codex", model: "gpt", modelSettings: {} }, preset: "balanced" });
    expect(parseContinueChoice({ target: { harness: "nope", model: "x" } })).toBeNull();
    expect(parseContinueChoice("bad")).toBeNull();
  });

  it("survives corrupt storage", () => {
    storage.set("monocode.continueChoice", "{not json");
    expect(loadContinueChoice("/repo/a")).toBeNull();
    saveContinueChoice("/repo/a", choice);
    expect(loadContinueChoice("/repo/a")).toEqual(choice);
  });
});
