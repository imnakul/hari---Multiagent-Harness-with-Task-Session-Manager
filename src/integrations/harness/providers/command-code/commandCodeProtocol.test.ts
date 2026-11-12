import { describe, expect, it } from "vitest";
import {
  COMMAND_CODE_AUTH_HELP,
  commandCodeConfigOptions,
  commandCodeCurrentModeId,
  commandCodeEffortSetting,
  commandCodeModeId,
  commandCodeSessionId,
  commandCodeStartupError,
  commandCodeTurnError,
  modelsFromCommandCodeSession,
} from "./commandCodeProtocol";

/** Trimmed `session/new` result recorded from cmdc 1.88.5. */
const SESSION_NEW = {
  sessionId: "146ce358-d5d1-4b59-996e-0ac9fdca9203",
  modes: {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Standard" },
      { id: "auto-accept", name: "Accept Edits" },
      { id: "plan", name: "Plan" },
      { id: "dont-ask", name: "Don't Ask" },
      { id: "bypass", name: "Bypass Permissions" },
    ],
  },
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "stealth/glyph-cluster:free",
      options: [{ value: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }],
    },
    {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "low",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
        { value: "xhigh", name: "Xhigh" },
      ],
    },
  ],
  models: {
    currentModelId: "stealth/glyph-cluster:free",
    availableModels: [
      { modelId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { modelId: "gpt-6-astra", name: "GPT-6 Astra" },
      { modelId: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { modelId: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
      { modelId: "stealth/glyph-cluster:free", name: "Glyph Cluster (free)" },
      { modelId: "claude-sonnet-5-5", name: "Duplicate row" },
    ],
  },
};

describe("commandCodeModeId", () => {
  it("maps each access level to a Command Code mode", () => {
    expect(commandCodeModeId("supervised")).toBe("default");
    expect(commandCodeModeId("auto-accept-edits")).toBe("auto-accept");
    expect(commandCodeModeId("auto")).toBe("dont-ask");
    expect(commandCodeModeId("full-access")).toBe("bypass");
  });

  it("uses plan mode for plan turns at any access level", () => {
    expect(commandCodeModeId("full-access", true)).toBe("plan");
    expect(commandCodeModeId("supervised", true)).toBe("plan");
  });
});

describe("session setup parsing", () => {
  it("reads the session id and current mode", () => {
    expect(commandCodeSessionId(SESSION_NEW)).toBe(SESSION_NEW.sessionId);
    expect(commandCodeSessionId({})).toBeUndefined();
    expect(commandCodeCurrentModeId(SESSION_NEW)).toBe("default");
  });

  it("reads select config options with their choices", () => {
    expect(commandCodeConfigOptions(SESSION_NEW)).toEqual([
      {
        id: "model",
        currentValue: "stealth/glyph-cluster:free",
        choices: ["claude-sonnet-5-5"],
      },
      {
        id: "effort",
        currentValue: "low",
        choices: ["low", "medium", "high", "xhigh"],
      },
    ]);
    expect(commandCodeConfigOptions({ sessionUpdate: "config_option_update", configOptions: [] })).toEqual([]);
  });

  it("offers the effort select as a model setting", () => {
    expect(commandCodeEffortSetting(SESSION_NEW.configOptions)).toEqual({
      id: "effort",
      label: "Effort",
      kind: "select",
      value: "low",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra high" },
      ],
    });
    expect(commandCodeEffortSetting([])).toBeUndefined();
  });

  it("lists models once, current model first, grouped by vendor", () => {
    const models = modelsFromCommandCodeSession(SESSION_NEW);
    expect(models.map((model) => model.nativeId)).toEqual([
      "stealth/glyph-cluster:free",
      "claude-sonnet-5-5",
      "gpt-6-astra",
      "google/gemini-3.8-flash",
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(models[0]).toMatchObject({
      id: "command-code:stealth/glyph-cluster:free",
      harness: "command-code",
      name: "Glyph Cluster (free)",
      provider: { id: "stealth", name: "Stealth" },
    });
    expect(models.map((model) => model.provider?.name)).toEqual([
      "Stealth",
      "Anthropic",
      "OpenAI",
      "Google",
      "DeepSeek",
    ]);
    expect(models.every((model) => model.settings?.[0]?.id === "effort")).toBe(true);
  });

  it("returns no models when the session has no model list", () => {
    expect(modelsFromCommandCodeSession({ sessionId: "x" })).toEqual([]);
  });
});

describe("errors", () => {
  it("adds the cmdc sign-in hint to login failures", () => {
    const error = commandCodeStartupError(new Error("Authentication required"));
    expect(error.message).toContain(COMMAND_CODE_AUTH_HELP);
    expect(error.message).toContain("cmdc login");
    expect(commandCodeTurnError(new Error("Not logged in"))).toContain("cmdc login");
  });

  it("leaves unrelated failures alone", () => {
    expect(commandCodeTurnError(new Error("Rate limit reached"))).toBe("Rate limit reached");
    expect(commandCodeStartupError(new Error("spawn failed")).message).toBe(
      "Command Code did not start. spawn failed",
    );
  });
});
