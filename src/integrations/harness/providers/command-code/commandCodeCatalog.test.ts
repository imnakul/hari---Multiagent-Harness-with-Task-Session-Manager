import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  commandCodeModelsFromCatalog,
  commandCodePlanLock,
} from "./commandCodeCatalog";

const model = (
  id: string,
  group: string,
  order: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name: id,
  context_length: 200_000,
  minimumPlan: "individual-go",
  display: { group, label: id.toUpperCase(), order, badge: null },
  ...extra,
});

const catalog = (data: unknown[], defaultId = "glm") =>
  JSON.stringify({
    cacheVersion: 1,
    body: { data, roles: { default: defaultId } },
  });

describe("commandCodeModelsFromCatalog", () => {
  it("lists visible models with groups, efforts, Free badges and plan locks", () => {
    const models = commandCodeModelsFromCatalog(
      catalog([
        model("opus", "Anthropic", 1, { minimumPlan: "individual-provider" }),
        model("sonnet", "Anthropic", 2, { minimumPlan: "individual-pro" }),
        model("glm", "Open Source", 3, {
          reasoningEfforts: ["low", "medium", "xhigh"],
        }),
        model("free-one", "Open Source", 4, {
          display: { group: "Open Source", label: "Free One", order: 4, badge: "free" },
        }),
        model("ultrafast", "Open Source", 5, { minimumPlan: "individual-goat" }),
        model("secret", "Open Source", 6, { hidden: true }),
        { name: "no id" },
      ]),
    );

    expect(models.map((item) => item.id)).toEqual([
      "command-code:default",
      "command-code:glm",
      "command-code:free-one",
      "command-code:ultrafast",
      "command-code:opus",
      "command-code:sonnet",
    ]);
    expect(models[0]!.name).toBe("Account default (GLM)");
    const glm = models[1]!;
    expect(glm).toMatchObject({
      nativeId: "glm",
      provider: { id: "open-source", name: "Open Source" },
      contextWindow: 200_000,
    });
    expect(glm.locked).toBeUndefined();
    expect(glm.settings?.[0]?.options).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "xhigh", label: "Extra high" },
    ]);
    expect(models[2]!.badge).toBe("free");
    expect(models[3]!.locked).toEqual({ reason: "Needs Goat plan" });
    expect(models[4]!.locked).toEqual({ reason: "Pay per use" });
    expect(models[5]!.locked).toEqual({ reason: "Needs Pro plan" });
  });

  it("returns nothing for a broken or unexpected file", () => {
    expect(commandCodeModelsFromCatalog("{oops")).toEqual([]);
    expect(commandCodeModelsFromCatalog(JSON.stringify({ body: {} }))).toEqual([]);
  });
});

describe("commandCodePlanLock", () => {
  it("unlocks Go models and models without a plan", () => {
    expect(commandCodePlanLock("individual-go")).toBeUndefined();
    expect(commandCodePlanLock(undefined)).toBeUndefined();
    expect(commandCodePlanLock("individual-max")).toEqual({ reason: "Needs Max plan" });
  });
});
