import { describe, expect, it } from "vitest";
import {
  cliModels,
  cliModelSlug,
  cliSpawnArgs,
  cliUsage,
  nativeConversationId,
  reportArgs,
  usageDelta,
  userMessage,
  validateCliPrompt,
} from "./antigravityCliProtocol";
import {
  harnessSupportsAttachments,
  runtimeModeLabel,
  runtimeModesForHarness,
} from "../../../../features/sessions/model/session";

const id = "055a398f-db14-4c5f-abbb-1bf03f8120a7";
const LISTED = [
  "Fetching available models...",
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
].join("\n");
const input = {
  sessionId: "one",
  cwd: "/repo",
  model: "antigravity-cli:gemini-3.8-flash-high",
  runtimeMode: "supervised" as const,
  onEvent: (): void => {},
};

describe("official agy headless protocol", () => {
  it("sends the full prompt once over stdin, never as a -p argument", () => {
    const text = 'hello\n"quoted" $()';
    const args = cliSpawnArgs(input, id);
    expect(args).toContain("--input-format");
    expect(args).toContain("--conversation");
    expect(args).toContain(id);
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--continue");
    expect(JSON.parse(userMessage(text))).toEqual({
      event: "user",
      message: { content: text },
    });
  });
  it("uses only explicit Full access for bypassing CLI permissions", () => {
    expect(cliSpawnArgs(input)).not.toContain("--dangerously-skip-permissions");
    expect(cliSpawnArgs({ ...input, runtimeMode: "full-access" })).toContain(
      "--dangerously-skip-permissions",
    );
  });
  it("never sends --effort beside a named model; only the configured default takes it", () => {
    // agy 1.4.11 exits 1 for "--model gemini-3.8-flash-high --effort medium".
    expect(
      cliSpawnArgs({ ...input, modelSettings: { effort: "medium" } }),
    ).not.toContain("--effort");
    const fallback = cliSpawnArgs({
      ...input,
      model: "antigravity-cli:default",
      modelSettings: { effort: "low" },
    });
    expect(fallback).not.toContain("--model");
    expect(fallback.slice(fallback.indexOf("--effort"), fallback.indexOf("--effort") + 2)).toEqual(["--effort", "low"]);
  });
  it("maps the Reasoning choice to the listed variant slug", () => {
    const models = cliModels(LISTED);
    expect(cliModelSlug("gemini-3.8-flash-high", "medium", models)).toBe("gemini-3.8-flash-medium");
    expect(cliModelSlug("gemini-3.8-flash-low", "high", models)).toBe("gemini-3.8-flash-high");
    expect(cliModelSlug("gemini-3.8-flash-high", undefined, models)).toBe("gemini-3.8-flash-high");
    // A single listed level, or no catalog yet, keeps the saved slug instead of inventing one.
    expect(cliModelSlug("gpt-oss-120b-medium", "high", models)).toBe("gpt-oss-120b-medium");
    expect(cliModelSlug("gemini-3.8-flash-high", "low", [])).toBe("gemini-3.8-flash-high");
    expect(cliModelSlug("claude-sonnet-4-6", "high", models)).toBe("claude-sonnet-4-6");
  });
  it("groups reasoning variants into one model with a Reasoning setting", () => {
    const models = cliModels(LISTED);
    expect(models.map((model) => [model.id, model.name])).toEqual([
      ["antigravity-cli:gemini-3.8-flash-high", "Gemini 3.8 Flash"],
      ["antigravity-cli:claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"],
      ["antigravity-cli:gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"],
    ]);
    expect(models[0].settings?.[0]).toMatchObject({
      id: "effort",
      value: "high",
      options: [{ value: "low" }, { value: "medium" }, { value: "high" }],
    });
    expect(models[1].settings).toBeUndefined();
    expect(models[2].settings).toBeUndefined();
  });
  it("rejects ACP native IDs and hides unsupported attachment/approval controls", () => {
    expect(nativeConversationId(id)).toBe(id);
    expect(() => cliSpawnArgs(input, "agy-acp:v1:one")).toThrow();
    expect(harnessSupportsAttachments("antigravity-cli")).toBe(false);
    expect(harnessSupportsAttachments("antigravity")).toBe(true);
    expect(runtimeModesForHarness("antigravity-cli")).toEqual([
      "supervised",
      "full-access",
    ]);
    expect(runtimeModeLabel("auto", "antigravity-cli")).toBe("CLI policy");
  });
  it("discovers CLI models without borrowing or replacing the ACP catalog", () => {
    expect(
      cliModels(
        "Model  Name\ngemini-3.8-flash-high     Gemini 3.8 Flash (High)\ngemini-3.8-flash-high     duplicate\n",
      ),
    ).toMatchObject([
      {
        id: "antigravity-cli:gemini-3.8-flash-high",
        harness: "antigravity-cli",
        nativeId: "gemini-3.8-flash-high",
      },
    ]);
  });
  it("normalizes cumulative tokens and computes turn differences without context guesses", () => {
    const previous = cliUsage({
      input_tokens: 100,
      output_tokens: 10,
      cache_read_tokens: 50,
    })!;
    const next = cliUsage({
      input_tokens: 120,
      output_tokens: 17,
      cache_read_tokens: 60,
      thinking_tokens: 3,
    })!;
    expect(usageDelta(next, previous)).toMatchObject({
      total: 27,
      input: 20,
      output: 7,
      cachedInput: 10,
      reasoning: 3,
    });
    expect(
      cliUsage({ input_tokens: -1, output_tokens: Infinity }),
    ).toMatchObject({ input: 0, output: 0 });
  });
  it("keeps read-only reports outside the stream and rejects terminal-only commands", () => {
    expect(reportArgs("/usage")).toEqual(["--print", "/usage", "--print-timeout", "30s"]);
    expect(reportArgs("/models")).toEqual(["models"]);
    expect(reportArgs("hello")).toBeUndefined();
    expect(() => validateCliPrompt("/remote-control on")).toThrow(
      "interactive",
    );
    expect(() => validateCliPrompt("/compact")).toThrow();
  });
});

it("passes a custom agent as a separate argument and rejects paths or option injection", () => {
  const args = cliSpawnArgs({ ...input, modelSettings: { antigravityAgent: "reviewer" } }, id);
  expect(args.slice(args.indexOf("--agent"), args.indexOf("--agent") + 2)).toEqual(["--agent", "reviewer"]);
  expect(cliSpawnArgs({ ...input, modelSettings: { antigravityAgent: "default" } })).not.toContain("--agent");
  for (const agent of ["../other", "--dangerously-skip-permissions", "bad name", ""]) {
    expect(() => cliSpawnArgs({ ...input, modelSettings: { antigravityAgent: agent } })).toThrow("Invalid");
  }
});
