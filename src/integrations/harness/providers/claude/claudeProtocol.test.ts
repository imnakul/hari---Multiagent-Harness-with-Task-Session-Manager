import { parseClaudeContextUsage } from "./claudeProtocol";
import { describe, expect, it } from "vitest";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import {
  modelsForClaudeVersion,
  modelsFromClaudeListModels,
} from "./claudeCatalog";
import {
  applyClaudePromptEffortPrefix,
  applyClaudeTaskTool,
  askUserQuestionAllowInput,
  buildClaudeSpawnArgs,
  buildSetModelRequest,
  buildSetPermissionModeRequest,
  buildRemoteControlRequest,
  buildClaudeUserMessage,
  claudeLiveKey,
  claudeSessionRules,
  claudeMcpServerGrant,
  contextFromResult,
  contextUsedFromAssistant,
  extractExitPlanModePlan,
  isClaudeInitMessage,
  isSubagentMessage,
  isTodoTool,
  listModelsFromControlResponse,
  normalizeClaudeCliEffort,
  parseBackgroundTasks,
  parseClaudeVersion,
  parseControlRequest,
  parseControlResponse,
  parseRemoteControlResponse,
  isRemoteControlConsentError,
  parseTaskNotification,
  parseTaskProgress,
  parseTaskStarted,
  parseTaskUpdated,
  parseToolProgress,
  planClaudeLiveSwitch,
  taskListFromTodos,
  resolveClaudeApiModelId,
  runtimeModeToPermission,
  sessionIdFromMessage,
  statusTextFromSystem,
  streamDeltaFromEvent,
  toClaudePermissionResult,
  toolKindFromName,
  toolStartFromEvent,
  toolTitle,
  turnStatusFromResult,
  turnMetricsFromResult,
  isUsageLimitResult,
  usageLimitFromRateLimitEvent,
  isReplayedTaskNotificationResult,
} from "./claudeProtocol";

function liveKey(
  options: {
    model?: string;
    effort?: string;
    fast?: string;
    thinking?: string;
    context?: string;
    runtimeMode?: RuntimeMode;
    intent?: "chat" | "plan";
    providerAccountId?: string;
    hooks?: boolean;
  } = {},
) {
  return claudeLiveKey(
    {
      model: options.model ?? "claude:claude-sonnet-4-6",
      modelSettings: {
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        ...(options.fast === undefined ? {} : { fast: options.fast }),
        ...(options.thinking === undefined
          ? {}
          : { thinking: options.thinking }),
        ...(options.context === undefined ? {} : { context: options.context }),
      },
      runtimeMode: options.runtimeMode ?? "supervised",
      intent: options.intent,
      providerAccountId: options.providerAccountId,
    },
    options.hooks ?? true,
  );
}

describe("planClaudeLiveSwitch", () => {
  it("sends permission mode before the model when both can change live", () => {
    expect(
      planClaudeLiveSwitch(
        liveKey(),
        liveKey({
          model: "claude:claude-opus-4-7",
          runtimeMode: "auto-accept-edits",
        }),
      ),
    ).toEqual({
      kind: "switch",
      steps: [
        { type: "set_permission_mode", mode: "acceptEdits" },
        { type: "set_model", model: "claude-opus-4-7" },
      ],
    });
  });

  it("uses plan permission for plan intent and restarts around full access", () => {
    expect(
      planClaudeLiveSwitch(liveKey(), liveKey({ intent: "plan" })),
    ).toEqual({
      kind: "switch",
      steps: [{ type: "set_permission_mode", mode: "plan" }],
    });
    expect(
      planClaudeLiveSwitch(liveKey(), liveKey({ runtimeMode: "full-access" })),
    ).toMatchObject({ kind: "restart" });
    expect(
      planClaudeLiveSwitch(liveKey({ runtimeMode: "full-access" }), liveKey()),
    ).toMatchObject({ kind: "restart" });
  });

  it.each([
    ["account", liveKey({ providerAccountId: "other-account" })],
    ["hooks", liveKey({ hooks: false })],
    ["context", liveKey({ context: "1m" })],
    ["thinking", liveKey({ thinking: "true" })],
    ["fast", liveKey({ fast: "true" })],
    ["normalized effort", liveKey({ effort: "low" })],
  ])("restarts when %s changes", (_label, next) => {
    expect(
      planClaudeLiveSwitch(liveKey({ effort: "high" }), next),
    ).toMatchObject({
      kind: "restart",
    });
  });

  it("reuses Claude when raw effort changes without changing its CLI flags", () => {
    expect(
      planClaudeLiveSwitch(
        liveKey({ model: "claude:claude-sonnet-4-6", effort: "high" }),
        liveKey({ model: "claude:claude-sonnet-4-6", effort: "max" }),
      ),
    ).toEqual({ kind: "reuse" });
    expect(
      planClaudeLiveSwitch(liveKey(), liveKey({ effort: "ultrathink" })),
    ).toEqual({ kind: "reuse" });
  });

  it("builds only the requested read-safe live control bodies", () => {
    expect(buildSetPermissionModeRequest("plan")).toEqual({
      subtype: "set_permission_mode",
      mode: "plan",
    });
    expect(buildSetModelRequest("claude-opus-4-7[1m]")).toEqual({
      subtype: "set_model",
      model: "claude-opus-4-7[1m]",
    });
  });
});

describe("runtimeModeToPermission", () => {
  it("maps runtime modes onto Claude permission flags", () => {
    expect(runtimeModeToPermission("supervised")).toBe("default");
    expect(runtimeModeToPermission("auto-accept-edits")).toBe("acceptEdits");
    expect(runtimeModeToPermission("auto")).toBe("auto");
    expect(runtimeModeToPermission("full-access")).toBe("bypassPermissions");
  });

  it("sends supervised as a flag so settings cannot lower it", () => {
    const args = buildClaudeSpawnArgs({
      permissionMode: runtimeModeToPermission("supervised"),
      sessionId: "sess-supervised",
    });
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "default"]),
    );
  });
});

describe("normalizeClaudeCliEffort", () => {
  it("drops ultrathink and maps ultracode to xhigh", () => {
    expect(
      normalizeClaudeCliEffort("ultrathink", "claude-sonnet-5"),
    ).toBeUndefined();
    expect(normalizeClaudeCliEffort("ultracode", "claude-opus-5")).toBe(
      "xhigh",
    );
  });

  it("maps xhigh to max on older models", () => {
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-4-6")).toBe("max");
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-5")).toBe("xhigh");
    expect(normalizeClaudeCliEffort("xhigh", "sonnet")).toBe("xhigh");
  });

  it("maps max to high on sonnet 4.6", () => {
    expect(normalizeClaudeCliEffort("max", "claude-sonnet-4-6")).toBe("high");
  });
});

describe("applyClaudePromptEffortPrefix", () => {
  it("prefixes ultrathink on the prompt", () => {
    expect(
      applyClaudePromptEffortPrefix("Investigate the edge cases", "ultrathink"),
    ).toBe("Ultrathink:\nInvestigate the edge cases");
    expect(applyClaudePromptEffortPrefix("hello", "high")).toBe("hello");
  });
});

describe("resolveClaudeApiModelId", () => {
  it("appends [1m] for the 1M context window", () => {
    expect(resolveClaudeApiModelId("claude-opus-5", "1m")).toBe(
      "claude-opus-5[1m]",
    );
    expect(resolveClaudeApiModelId("claude-sonnet-5", "200k")).toBe(
      "claude-sonnet-5",
    );
  });
});

describe("buildClaudeSpawnArgs", () => {
  it("combines resume and a new session id only for a native fork", () => {
    const args = buildClaudeSpawnArgs({
      resume: "source",
      sessionId: "new",
      forkSession: true,
      resumeSessionAt: "uuid",
      allowedTools: ["Read"],
    });
    expect(args.slice(args.indexOf("--resume"))).toEqual([
      "--resume",
      "source",
      "--session-id",
      "new",
      "--fork-session",
      "--resume-session-at",
      "uuid",
    ]);
    expect(args).toContain("--allowedTools");
    expect(
      buildClaudeSpawnArgs({ resume: "source", sessionId: "new" }),
    ).not.toContain("--session-id");
    expect(
      buildClaudeSpawnArgs({
        resume: "source",
        sessionId: "new",
        forkSession: true,
      }),
    ).not.toContain("--resume-session-at");
  });
  it("speaks stream-json with stdio permissions like the Agent SDK", () => {
    const args = buildClaudeSpawnArgs({
      model: "claude-sonnet-5",
      effort: "high",
      permissionMode: "acceptEdits",
      sessionId: "sess-1",
    });
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--input-format");
    expect(args).toContain("--permission-prompt-tool");
    expect(args).toContain("stdio");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--setting-sources=user,project,local");
    expect(args).toEqual(
      expect.arrayContaining([
        "--model",
        "claude-sonnet-5",
        "--effort",
        "high",
      ]),
    );
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "acceptEdits"]),
    );
    expect(args).toEqual(expect.arrayContaining(["--session-id", "sess-1"]));
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings).disableAllHooks).toBeUndefined();
  });

  it("only disables hooks for interactive sessions when asked", () => {
    const args = buildClaudeSpawnArgs({ settings: { disableAllHooks: true } });
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings)).toMatchObject({ disableAllHooks: true });
  });

  it("skips permissions and MCP for isolated text sessions", () => {
    const args = buildClaudeSpawnArgs({
      isolated: true,
      maxTurns: 1,
      model: "claude-haiku-4-5",
    });
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toEqual(expect.arrayContaining(["--max-turns", "1"]));
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings)).toMatchObject({ disableAllHooks: true });
    expect(args).not.toContain("--permission-prompt-tool");
  });

  it("locks isolated read-only prompts to plan mode", () => {
    const args = buildClaudeSpawnArgs({
      isolated: true,
      permissionMode: "plan",
      maxTurns: 1,
      model: "claude-haiku-4-5",
    });
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "plan", "--max-turns", "1"]),
    );
  });

  it("adds bypass flag for full-access", () => {
    const args = buildClaudeSpawnArgs({
      permissionMode: "bypassPermissions",
    });
    expect(args).toContain("--allow-dangerously-skip-permissions");
  });

  it("puts each replayed tool rule after --allowedTools and before setting sources", () => {
    const args = buildClaudeSpawnArgs({
      allowedTools: ["Bash(npm test:*)", "Read"],
    });
    const allowedToolsIndex = args.indexOf("--allowedTools");
    expect(args.slice(allowedToolsIndex, allowedToolsIndex + 3)).toEqual([
      "--allowedTools",
      "Bash(npm test:*)",
      "Read",
    ]);
    expect(allowedToolsIndex).toBeLessThan(
      args.indexOf("--setting-sources=user,project,local"),
    );
  });
});

describe("buildClaudeUserMessage", () => {
  it("embeds vision images as base64 source blocks", () => {
    const message = buildClaudeUserMessage({
      text: "look",
      attachments: [
        {
          id: "a1",
          name: "diagram.png",
          mimeType: "image/png",
          kind: "image",
          size: 4,
          data: "AQIDBA==",
        },
      ],
    });
    const content = (message.message as { content: unknown[] }).content;
    expect(content[0]).toEqual({ type: "text", text: "look" });
    expect(content[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "AQIDBA==",
      },
    });
  });

  it("marks only user-typed turns with a human origin", () => {
    expect(
      buildClaudeUserMessage({ text: "hi", humanAuthored: true }).origin,
    ).toEqual({ kind: "human" });
    expect(buildClaudeUserMessage({ text: "hi" })).not.toHaveProperty("origin");
    expect(
      buildClaudeUserMessage({ text: "hi", humanAuthored: false }),
    ).not.toHaveProperty("origin");
  });
});

describe("control protocol", () => {
  it("builds Remote Control requests with a trimmed, bounded optional name", () => {
    expect(buildRemoteControlRequest(true, "  Work session  ")).toEqual({
      subtype: "remote_control",
      enabled: true,
      name: "Work session",
    });
    expect(buildRemoteControlRequest(false, "  ")).toEqual({
      subtype: "remote_control",
      enabled: false,
    });
    expect(buildRemoteControlRequest(true, "n".repeat(90)).name).toHaveLength(
      80,
    );
  });

  it("accepts only HTTPS Remote Control session URLs", () => {
    expect(
      parseRemoteControlResponse({
        session_url: "https://claude.ai/code/session",
        bridge_session_id: " bridge-1 ",
      }),
    ).toEqual({
      sessionUrl: "https://claude.ai/code/session",
      bridgeSessionId: "bridge-1",
    });
    expect(parseRemoteControlResponse({})).toBeNull();
    expect(parseRemoteControlResponse({ session_url: "http://example.com" })).toBeNull();
    expect(parseRemoteControlResponse({ session_url: "https://" })).toBeNull();
  });

  it("recognizes the headless one-time consent failure", () => {
    expect(
      isRemoteControlConsentError(
        "Remote Control asks for a one-time confirmation before enabling.",
      ),
    ).toBe(true);
    expect(isRemoteControlConsentError("Not signed in")).toBe(false);
  });

  it("parses can_use_tool requests", () => {
    const parsed = parseControlRequest({
      type: "control_request",
      request_id: "req_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "ls" },
      },
    });
    expect(parsed).toMatchObject({
      requestId: "req_1",
      subtype: "can_use_tool",
      toolName: "Bash",
      input: { command: "ls" },
    });
  });

  it("maps allow/deny onto SDK permission results", () => {
    expect(toClaudePermissionResult("allow", { command: "ls" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "ls" },
    });
    expect(toClaudePermissionResult("deny", {})).toMatchObject({
      behavior: "deny",
    });
  });

  it("preserves suggested permission updates only when supplied", () => {
    const updates = claudeSessionRules("Bash", [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
        behavior: "allow",
        destination: "localSettings",
      },
    ])!.updates;
    expect(
      toClaudePermissionResult("allow", { command: "npm test" }, updates),
    ).toEqual({
      behavior: "allow",
      updatedInput: { command: "npm test" },
      updatedPermissions: updates,
    });
    expect(toClaudePermissionResult("allow", { command: "npm test" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "npm test" },
    });
  });

  it("preserves raw permission suggestions from can_use_tool", () => {
    const permissionSuggestions = [{ type: "setMode", mode: "acceptEdits" }];
    expect(
      parseControlRequest({
        type: "control_request",
        request_id: "req_2",
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          permission_suggestions: permissionSuggestions,
        },
      })?.permissionSuggestions,
    ).toBe(permissionSuggestions);
  });
});

describe("claudeSessionRules", () => {
  it("adds a session MCP fallback when Claude offers no suggestions", () => {
    expect(
      claudeSessionRules(
        "mcp__plugin_socraticode_socraticode__codebase_search",
        undefined,
      ),
    ).toEqual({
      updates: [
        {
          type: "addRules",
          rules: [
            {
              toolName: "mcp__plugin_socraticode_socraticode__codebase_search",
            },
          ],
          behavior: "allow",
          destination: "session",
        },
      ],
      rules: [
        { toolName: "mcp__plugin_socraticode_socraticode__codebase_search" },
      ],
    });
  });

  it("keeps Claude allow rules and drops mode changes", () => {
    expect(
      claudeSessionRules("Bash", [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
          behavior: "allow",
          destination: "localSettings",
        },
        { type: "setMode", mode: "acceptEdits", destination: "session" },
      ]),
    ).toEqual({
      updates: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
          behavior: "allow",
          destination: "session",
        },
      ],
      rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
    });
  });

  it.each([
    [{ type: "addRules", rules: [], behavior: "allow" }],
    [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "deny" }],
    [{ type: "addRules", rules: [{ toolName: 4 }], behavior: "allow" }],
    [
      {
        type: "replaceRules",
        rules: [{ toolName: "Bash" }],
        behavior: "allow",
      },
    ],
  ])("fails closed for unsupported suggestions: %j", (suggestions) => {
    expect(claudeSessionRules("Bash", suggestions)).toBeNull();
  });

  it("keeps allowed directory suggestions but does not replay directories", () => {
    expect(
      claudeSessionRules("Read", [
        { type: "addDirectories", directories: ["/repo/shared"] },
      ]),
    ).toEqual({
      updates: [
        {
          type: "addDirectories",
          directories: ["/repo/shared"],
          destination: "session",
        },
      ],
      rules: [],
    });
  });
});

describe("claudeMcpServerGrant", () => {
  it("qualifies a server wildcard using the configured server list", () => {
    expect(
      claudeMcpServerGrant("mcp__docs__search", ["docs", "calendar"]),
    ).toEqual({
      serverName: "docs",
      grant: {
        updates: [
          {
            type: "addRules",
            rules: [{ toolName: "mcp__docs__*" }],
            behavior: "allow",
            destination: "session",
          },
        ],
        rules: [{ toolName: "mcp__docs__*" }],
      },
    });
  });

  it.each([
    ["mcp__docs__search", ["docs", "docs__search"]],
    ["mcp__docs__search", ["docs__search"]],
    ["mcp__docs__", ["docs"]],
    ["mcp__docs__search*", ["docs"]],
    ["mcp__docs__search", ["docs", "bad name"]],
  ])("fails closed for an unqualified or ambiguous server identity", (toolName, names) => {
    expect(claudeMcpServerGrant(toolName as string, names as string[])).toBeNull();
  });

  it("keeps disabled server names in wildcard ambiguity checks", () => {
    expect(
      claudeMcpServerGrant("mcp__docs__search", ["docs", "docs__search"], ["docs"]),
    ).toBeNull();
  });
});

describe("stream mapping", () => {
  it("reads text and thinking deltas", () => {
    expect(
      streamDeltaFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hi" },
        },
      }),
    ).toEqual({ kind: "assistant", text: "Hi" });
    expect(
      streamDeltaFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      }),
    ).toEqual({ kind: "reasoning", text: "hmm" });
  });

  it("reads tool_use content blocks", () => {
    expect(
      toolStartFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { file_path: "a.ts" },
          },
        },
      }),
    ).toEqual({
      index: 1,
      id: "toolu_1",
      name: "Read",
      input: { file_path: "a.ts" },
    });
  });
});

describe("usage limits", () => {
  it("reads a refused window and when it resets", () => {
    expect(
      usageLimitFromRateLimitEvent({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1_790_000_000,
          rateLimitType: "five_hour",
        },
      }),
    ).toEqual({ resetsAt: 1_790_000_000_000 });
  });

  it("does not stop the session when only fast mode's extra usage runs out", () => {
    // Out of credits refuses fast mode until the monthly reset, while the plan
    // still serves the session at standard speed.
    expect(
      usageLimitFromRateLimitEvent({
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1_793_491_200,
          rateLimitType: "overage",
          overageStatus: "rejected",
          overageDisabledReason: "out_of_credits",
          isUsingOverage: false,
        },
      }),
    ).toBeNull();
  });

  it("ignores allowed windows and extra usage", () => {
    expect(
      usageLimitFromRateLimitEvent({
        rate_limit_info: { status: "allowed_warning", resetsAt: 1 },
      }),
    ).toBeNull();
    expect(
      usageLimitFromRateLimitEvent({
        rate_limit_info: { status: "rejected", isUsingOverage: true },
      }),
    ).toBeNull();
  });

  it("recognizes a limit in an errored result", () => {
    expect(
      isUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "You've hit your limit · resets 3am (Europe/Sofia)",
      }),
    ).toBe(true);
    expect(
      isUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "You've hit your limit",
      }),
    ).toBe(false);
  });
});

describe("turnStatusFromResult", () => {
  it("treats aborted terminals as interrupted", () => {
    expect(
      turnStatusFromResult({
        type: "result",
        subtype: "error_during_execution",
        terminal_reason: "aborted_streaming",
        errors: ["interrupt"],
      }).status,
    ).toBe("interrupted");
    expect(
      turnStatusFromResult({ type: "result", subtype: "success" }).status,
    ).toBe("completed");
  });
});

describe("modelsForClaudeVersion", () => {
  it("hides Opus 5 until 2.1.219", () => {
    const old = modelsForClaudeVersion("2.1.100").map(
      (model) => model.nativeId,
    );
    expect(old).not.toContain("claude-opus-5");
    expect(old).not.toContain("claude-opus-4-8");
    expect(old).toContain("claude-sonnet-4-6");

    const next = modelsForClaudeVersion("2.1.233").map(
      (model) => model.nativeId,
    );
    expect(next).toContain("claude-opus-5");
    expect(next).toContain("claude-fable-5");
    expect(next).toContain("claude-sonnet-5");
    expect(next).not.toContain("claude-opus-5-5");
  });

  it("hides Opus 5.5 until 2.1.280, and rejects a missing version", () => {
    const beforeMinimum = modelsForClaudeVersion("2.1.279").map(
      (model) => model.nativeId,
    );
    expect(beforeMinimum).not.toContain("claude-opus-5-5");
    expect(beforeMinimum).toContain("claude-opus-5");

    const atMinimum = modelsForClaudeVersion("2.1.280").map(
      (model) => model.nativeId,
    );
    expect(atMinimum).toContain("claude-opus-5-5");
    expect(atMinimum).toContain("claude-opus-5");

    const missing = modelsForClaudeVersion(null).map((model) => model.nativeId);
    expect(missing).not.toContain("claude-opus-5-5");
  });

  it("hides Sonnet 5 until 2.1.197, and rejects a missing version", () => {
    const beforeMinimum = modelsForClaudeVersion("2.1.196").map(
      (model) => model.nativeId,
    );
    expect(beforeMinimum).not.toContain("claude-sonnet-5");

    const atMinimum = modelsForClaudeVersion("2.1.197").map(
      (model) => model.nativeId,
    );
    expect(atMinimum).toContain("claude-sonnet-5");

    const missing = modelsForClaudeVersion(null).map((model) => model.nativeId);
    expect(missing).not.toContain("claude-sonnet-5");
  });
});

describe("list_models catalog", () => {
  const listed = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "list_1",
      response: {
        models: [
          {
            value: "default",
            resolvedModel: "claude-sonnet-5",
            displayName: "Default (recommended)",
            description: "Sonnet 5 · Efficient for routine tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "sonnet",
            resolvedModel: "claude-sonnet-5",
            displayName: "Sonnet",
            description: "Sonnet 5 · Efficient for routine tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
            supportsAdaptiveThinking: true,
          },
          {
            value: "claude-fable-5[1m]",
            resolvedModel: "claude-fable-5",
            displayName: "Fable",
            description: "Fable 5 · Most capable for your hardest tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "opus",
            resolvedModel: "claude-opus-5",
            displayName: "Opus",
            description: "Opus 5 · Best for everyday, complex tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
            supportsFastMode: true,
          },
          {
            value: "haiku",
            resolvedModel: "claude-haiku-4-5-20251001",
            displayName: "Haiku",
            description: "Haiku 4.5 · Fastest for quick answers",
          },
          {
            value: "cc-update-required-1",
            resolvedModel: "cc-update-required-1",
            displayName: "Fable 5.1 (disabled)",
            description: "Update to 2.1.255+ to use Fable 5.1",
            disabled: true,
          },
        ],
      },
    },
  };

  it("reads rows from the matching control response", () => {
    expect(listModelsFromControlResponse(listed, "list_1")).toHaveLength(6);
    expect(listModelsFromControlResponse(listed, "other")).toBeNull();
    expect(
      listModelsFromControlResponse(
        {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "init_1",
            response: { commands: [], models: [] },
          },
        },
        "list_1",
      ),
    ).toBeNull();
  });

  it("maps the picker catalog and drops default/disabled rows", () => {
    const models = modelsFromClaudeListModels(
      listModelsFromControlResponse(listed, "list_1"),
    );
    expect(models.map((model) => model.nativeId)).toEqual([
      "sonnet",
      "claude-fable-5",
      "opus",
      "haiku",
    ]);
    expect(models.map((model) => model.id)).toEqual([
      "claude:sonnet",
      "claude:fable-5",
      "claude:opus",
      "claude:haiku",
    ]);
    expect(models.map((model) => model.name)).toEqual([
      "Sonnet 5",
      "Fable 5",
      "Opus 5",
      "Haiku 4.5",
    ]);

    const sonnet = models[0];
    expect(
      sonnet?.settings
        ?.find((setting) => setting.id === "effort")
        ?.options.map((option) => option.value),
    ).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
      "ultrathink",
    ]);
    expect(sonnet?.settings?.some((setting) => setting.id === "fast")).toBe(
      false,
    );

    const fable = models[1];
    expect(
      fable?.settings?.find((setting) => setting.id === "context"),
    ).toMatchObject({
      value: "1m",
    });

    const opus = models[2];
    expect(opus?.settings?.some((setting) => setting.id === "fast")).toBe(true);

    const haiku = models[3];
    expect(haiku?.settings).toBeUndefined();
  });

  it("keeps the default slot when it alone names the newest model (Opus 5.5)", () => {
    const models = modelsFromClaudeListModels([
      {
        value: "default",
        resolvedModel: "claude-opus-5-5",
        displayName: "Default (recommended)",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "opus",
        resolvedModel: "claude-opus-5",
        displayName: "Opus",
        description: "",
      },
    ]);
    expect(models.map((model) => model.nativeId)).toEqual([
      "claude-opus-5-5",
      "opus",
    ]);
    expect(models.map((model) => model.id)).toEqual([
      "claude:opus-5-5",
      "claude:opus",
    ]);
    // A generic "Default (recommended)" label is renamed to the concrete
    // model so the picker shows Opus 5.5, not a nameless slot.
    expect(models[0]?.name).toBe("Opus 5.5");
  });

  it("records the concrete model behind live-catalog aliases", () => {
    const models = modelsFromClaudeListModels([
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus" },
      {
        value: "claude-fable-5-1[1m]",
        resolvedModel: "claude-fable-5-1",
        displayName: "Fable 5.1",
      },
    ]);

    expect(models.map((model) => model.aliasTarget)).toEqual([
      "claude-opus-5-5",
      undefined,
    ]);
  });

  it("adds resolved versions to generic live-catalog alias labels", () => {
    const models = modelsFromClaudeListModels([
      {
        value: "opus[1m]",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus (1M context)",
        description: "Most capable for complex tasks",
      },
      {
        value: "fable",
        resolvedModel: "claude-fable-5-1",
        displayName: "Fable",
        description: "Fast and capable",
      },
      {
        value: "haiku",
        resolvedModel: "claude-haiku-4-5-20251001",
        displayName: "Haiku 4.5",
        description: "Fastest for quick answers",
      },
      {
        value: "next-family",
        resolvedModel: "claude-next-family-7.2-20300101",
        displayName: "Next Family — recommended",
        description: "A future model family",
      },
    ]);

    expect(models.map((model) => model.name)).toEqual([
      "Opus 5.5 (1M context)",
      "Fable 5.1",
      "Haiku 4.5",
      "Next Family 7.2 — recommended",
    ]);
    expect(models[0]).toMatchObject({
      id: "claude:opus",
      nativeId: "opus",
    });
    expect(
      models[0]?.settings?.find((setting) => setting.id === "context")?.value,
    ).toBe("1m");
  });

  it("launches a versioned short value with the claude- prefix", () => {
    const models = modelsFromClaudeListModels([
      {
        value: "opus-5-5",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus 5.5",
      },
      {
        value: "opus",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus",
      },
    ]);

    expect(models.map((model) => model.nativeId)).toEqual([
      "claude-opus-5-5",
      "opus",
    ]);
    expect(models[0]).toMatchObject({
      id: "claude:opus-5-5",
      nativeId: "claude-opus-5-5",
    });
    expect(models[1]).toMatchObject({
      id: "claude:opus",
      nativeId: "opus",
    });
  });

  it("parses success and error control responses", () => {
    expect(
      parseControlResponse({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "init_1",
          response: { pid: 12 },
        },
      }),
    ).toEqual({
      requestId: "init_1",
      ok: true,
      payload: { pid: 12 },
    });
    expect(
      parseControlResponse({
        type: "control_response",
        response: { subtype: "error", request_id: "list_1", error: "nope" },
      }),
    ).toEqual({
      requestId: "list_1",
      ok: false,
      payload: null,
      error: "nope",
    });
    expect(isClaudeInitMessage({ type: "system", subtype: "init" })).toBe(true);
    expect(isClaudeInitMessage({ type: "assistant", subtype: "init" })).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("parses CLI version strings", () => {
    expect(parseClaudeVersion("2.1.233 (Claude Code)")).toBe("2.1.233");
  });

  it("classifies tools and todo plans", () => {
    expect(toolKindFromName("Bash")).toBe("execute");
    expect(toolKindFromName("Skill")).toBe("skill");
    expect(toolKindFromName("Agent")).toBe("agent");
    expect(toolKindFromName("Task")).toBe("agent");
    expect(toolTitle("Agent", { description: "Explore the auth module" })).toBe(
      "Explore the auth module",
    );
    expect(toolTitle("Task", { subagent_type: "explore" })).toBe(
      "Explore subagent",
    );
    expect(toolTitle("Bash", { command: "ls -la src" })).toBe("List src");
    expect(toolTitle("Skill", { skill: "code-review" })).toBe(
      "Skill /code-review",
    );
    expect(isTodoTool("TodoWrite")).toBe(true);
    expect(toolKindFromName("TodoWrite")).toBe("tasks");
    expect(toolKindFromName("TaskCreate")).toBe("tasks");
    expect(toolKindFromName("TaskUpdate")).toBe("tasks");
    expect(toolKindFromName("TaskOutput")).not.toBe("agent");
    expect(
      taskListFromTodos({
        todos: [
          { content: "One", status: "completed" },
          { content: "Two", status: "pending" },
        ],
      }),
    ).toEqual([
      { text: "One", status: "completed" },
      { text: "Two", status: "pending" },
    ]);
    expect(extractExitPlanModePlan({ plan: "# Plan" })).toBe("# Plan");
  });

  it("answers AskUserQuestion with the selected options", () => {
    const input = {
      questions: [
        {
          question: "Which file?",
          options: [{ label: "a.ts" }, { label: "b.ts" }],
        },
      ],
    };
    expect(
      askUserQuestionAllowInput(input, {
        kind: "answered",
        answers: { "Which file?": ["b.ts"] },
      }),
    ).toMatchObject({
      answers: { "Which file?": "b.ts" },
    });
  });

  it("drops request lifecycle status pings", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        status: "requesting",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        message: "Responding",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({ type: "system", subtype: "status" }),
    ).toBeUndefined();
  });

  it("keeps status messages that carry real prose", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        message: "Retrying in 3s (rate limited)",
      }),
    ).toBe("Retrying in 3s (rate limited)");
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "compact",
        message: "Compacted context to 40k tokens",
      }),
    ).toBe("Compacted context to 40k tokens");
  });

  it("still marks a compact boundary that carries no prose", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto" },
      }),
    ).toBe("Compacted context");
  });

  it("ignores system messages that are not status or compact", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "init",
        message: "ready",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({ type: "assistant", message: "hello" }),
    ).toBeUndefined();
  });
});

describe("contextUsedFromAssistant", () => {
  it("counts cached reads and writes as window occupancy", () => {
    // Shape captured from `claude --output-format stream-json --verbose`.
    const rec = {
      type: "assistant",
      message: {
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 12941,
          cache_read_input_tokens: 16652,
          output_tokens: 3,
        },
      },
    };
    expect(contextUsedFromAssistant(rec)).toBe(29598);
  });

  it("ignores a message with no usage", () => {
    expect(
      contextUsedFromAssistant({ type: "assistant", message: {} }),
    ).toBeUndefined();
  });
});

describe("contextFromResult", () => {
  it("reads the window the CLI reports rather than a model table", () => {
    const rec = {
      type: "result",
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 12941,
        cache_read_input_tokens: 16652,
        output_tokens: 13,
      },
      modelUsage: {
        "claude-sonnet-5": { contextWindow: 1000000, maxOutputTokens: 64000 },
      },
    };
    expect(contextFromResult(rec)).toEqual({ used: 29608, window: 1000000 });
  });

  it("uses the last iteration, since top-level usage sums the whole turn", () => {
    const rec = {
      type: "result",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 90_000,
        output_tokens: 500,
        iterations: [
          {
            input_tokens: 5,
            cache_read_input_tokens: 20_000,
            output_tokens: 200,
          },
          {
            input_tokens: 5,
            cache_read_input_tokens: 70_000,
            output_tokens: 300,
          },
        ],
      },
      modelUsage: { "claude-opus-5": { contextWindow: 200000 } },
    };
    expect(contextFromResult(rec)).toEqual({ used: 70_305, window: 200000 });
  });

  it("has nothing to report for a turn that never called the API", () => {
    expect(contextFromResult({ type: "result", usage: {} })).toBeUndefined();
  });
});

describe("turnMetricsFromResult", () => {
  it("normalizes aggregate input, output, and cache usage", () => {
    expect(
      turnMetricsFromResult({
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 12_941,
          cache_read_input_tokens: 16_652,
          output_tokens: 13,
        },
      }),
    ).toEqual({
      inputTokens: 2,
      cacheWriteTokens: 12_941,
      cacheReadTokens: 16_652,
      outputTokens: 13,
      cacheHitPercent: (16_652 / (2 + 12_941 + 16_652)) * 100,
    });
  });
});

describe("subagent messages", () => {
  it("detects nested agent traffic by parent_tool_use_id", () => {
    expect(isSubagentMessage({ parent_tool_use_id: "toolu_agent" })).toBe(true);
    expect(isSubagentMessage({ parent_tool_use_id: null })).toBe(false);
    expect(isSubagentMessage({ type: "assistant" })).toBe(false);
  });

  it("does not rebind the parent session to a subagent session id", () => {
    expect(
      sessionIdFromMessage({
        type: "assistant",
        session_id: "sub_1",
        parent_tool_use_id: "toolu_agent",
      }),
    ).toBeUndefined();
    expect(
      sessionIdFromMessage({
        type: "assistant",
        session_id: "sess_1",
        parent_tool_use_id: null,
      }),
    ).toBe("sess_1");
  });

  it("parses task lifecycle frames for local agents", () => {
    expect(
      parseTaskStarted({
        type: "system",
        subtype: "task_started",
        task_id: "t1",
        tool_use_id: "toolu_agent",
        description: "Explore the auth module",
        task_type: "local_agent",
        is_backgrounded: true,
      }),
    ).toEqual({
      taskId: "t1",
      toolUseId: "toolu_agent",
      description: "Explore the auth module",
      taskType: "local_agent",
      backgrounded: true,
      ambient: false,
    });
    expect(
      parseTaskProgress({
        type: "system",
        subtype: "task_progress",
        task_id: "t1",
        last_tool_name: "Read",
        description: "Explore the auth module",
      }),
    ).toMatchObject({
      taskId: "t1",
      lastToolName: "Read",
    });
    expect(
      parseTaskUpdated({
        type: "system",
        subtype: "task_updated",
        task_id: "t1",
        patch: { status: "completed" },
      }),
    ).toMatchObject({ taskId: "t1", status: "completed" });
    expect(
      parseTaskNotification({
        type: "system",
        subtype: "task_notification",
        task_id: "t1",
        tool_use_id: "toolu_agent",
        status: "completed",
        summary: "Found the tokens",
      }),
    ).toMatchObject({
      taskId: "t1",
      status: "completed",
      summary: "Found the tokens",
    });
    expect(
      parseBackgroundTasks({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [
          {
            task_id: "t1",
            task_type: "local_agent",
            description: "Explore",
          },
          {
            task_id: "bash_1",
            task_type: "local_bash",
            description: "sleep 10",
          },
          {
            task_id: "watch",
            task_type: "local_agent",
            description: "watcher",
            ambient: true,
          },
        ],
      }),
    ).toEqual([
      { taskId: "t1", taskType: "local_agent", description: "Explore" },
      { taskId: "bash_1", taskType: "local_bash", description: "sleep 10" },
    ]);
    expect(
      parseToolProgress({
        type: "tool_progress",
        tool_use_id: "toolu_agent",
        subagent_type: "explore",
      }),
    ).toMatchObject({
      toolUseId: "toolu_agent",
      subagentType: "explore",
    });
  });
});

describe("Claude helper spawn arguments", () => {
  it("disables tools and slash commands only for isolated helper spawns", () => {
    const helperArgs = buildClaudeSpawnArgs({
      isolated: true,
      model: "claude-sonnet-4-6",
      noTools: true,
    });
    expect(helperArgs).toEqual(
      expect.arrayContaining([
        "--tools",
        "",
        "--disable-slash-commands",
        "--model",
        "claude-sonnet-4-6",
      ]),
    );

    const normalArgs = buildClaudeSpawnArgs({ isolated: true });
    expect(normalArgs).not.toContain("--tools");
    expect(normalArgs).not.toContain("--disable-slash-commands");
  });
});

describe("Claude context summary", () => {
  it("parses categories and groups server tools with deferred counts", () => {
    const result = parseClaudeContextUsage({
      totalTokens: 100,
      maxTokens: 200,
      categories: [
        { name: "Messages", tokens: 80 },
        { name: "Deferred", tokens: 5, kind: "deferred" },
      ],
      mcpTools: [
        { serverName: "search", tokens: 10 },
        { serverName: "search", tokens: 5, isLoaded: false },
      ],
      memoryFiles: [{ path: "CLAUDE.md", tokens: 2 }],
      skills: { includedSkills: 3, tokens: 4 },
      messageBreakdown: {
        toolCallTokens: 1,
        toolResultTokens: 2,
        attachmentTokens: 3,
        assistantMessageTokens: 4,
        userMessageTokens: 5,
        unattributedTokens: 6,
      },
    });
    expect(result?.categories[0].kind).toBe("used");
    expect(result?.mcpServers).toEqual([
      { serverName: "search", tokens: 15, toolCount: 2, deferredTools: 1 },
    ]);
    expect(result?.messages?.unattributed).toBe(6);
    expect(result?.memoryFiles).toEqual([{ path: "CLAUDE.md", tokens: 2 }]);
    expect(result?.skills).toEqual({ count: 3, tokens: 4 });
  });
  it("defaults optional arrays and rejects invalid totals or nested values", () => {
    expect(
      parseClaudeContextUsage({ totalTokens: 10, maxTokens: 20 })?.categories,
    ).toEqual([]);
    for (const totalTokens of [-1, NaN, Infinity, "10", undefined])
      expect(
        parseClaudeContextUsage({ totalTokens, maxTokens: 20 }),
      ).toBeNull();
    expect(
      parseClaudeContextUsage({ totalTokens: 10, maxTokens: -1 }),
    ).toBeNull();
    expect(
      parseClaudeContextUsage({
        totalTokens: 10,
        maxTokens: 20,
        categories: [{ name: "bad", tokens: -1 }],
      }),
    ).toBeNull();
  });
});

describe("applyClaudeTaskTool", () => {
  it("creates from the result id, updates, renames and deletes", () => {
    const tasks = new Map();
    expect(
      applyClaudeTaskTool(
        tasks,
        "TaskCreate",
        { subject: "One" },
        "Task #7 created successfully: One",
      ),
    ).toBe(true);
    expect([...tasks.values()]).toEqual([
      { id: "7", text: "One", status: "pending" },
    ]);
    applyClaudeTaskTool(
      tasks,
      "TaskUpdate",
      { taskId: 7, status: "in_progress" },
      "",
    );
    applyClaudeTaskTool(
      tasks,
      "TaskUpdate",
      { taskId: "7", subject: "Uno" },
      "",
    );
    expect(tasks.get("7")).toEqual({
      id: "7",
      text: "Uno",
      status: "in_progress",
    });
    applyClaudeTaskTool(
      tasks,
      "TaskUpdate",
      { taskId: "7", status: "deleted" },
      "",
    );
    expect(tasks.size).toBe(0);
  });

  it("ignores unknown ids, missing result ids and other tools", () => {
    const tasks = new Map();
    expect(
      applyClaudeTaskTool(tasks, "TaskCreate", { subject: "One" }, "error"),
    ).toBe(false);
    expect(
      applyClaudeTaskTool(
        tasks,
        "TaskUpdate",
        { taskId: "9", status: "completed" },
        "",
      ),
    ).toBe(false);
    expect(applyClaudeTaskTool(tasks, "TaskList", {}, "#1 [pending] One")).toBe(
      false,
    );
    expect(tasks.size).toBe(0);
  });
});

describe("isReplayedTaskNotificationResult", () => {
  it("matches only a zero-turn result woken by a task notification", () => {
    const origin = { kind: "task-notification" };
    expect(
      isReplayedTaskNotificationResult({ type: "result", num_turns: 0, origin }),
    ).toBe(true);
    expect(
      isReplayedTaskNotificationResult({ type: "result", num_turns: 1, origin }),
    ).toBe(false);
    expect(
      isReplayedTaskNotificationResult({ type: "result", num_turns: 0 }),
    ).toBe(false);
  });
});
