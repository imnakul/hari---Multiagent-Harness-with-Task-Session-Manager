import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned: Array<{ sessionId: string; command: string; args: string[] }> =
  [];
const written: string[] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  resolveCursorBinary: async () => ({ path: "/fake/cursor" }),
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  resolvePiBinary: async () => ({ path: "/fake/pi" }),
  resolveOmpBinary: async () => ({ path: "/fake/omp" }),
  resolveFxBinary: async () => ({ path: "/fake/fx" }),
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  resolveAntigravityBinary: async () => ({ path: "/fake/agy" }),
  resolveClineBinary: async () => ({ path: "/fake/cline" }),
  probeHarnessBinary: async () => ({ path: "/fake/probe" }),
  execChild: async () => "",
  freeHarnessPort: async () => 18769,
  harnessHttp: async () => ({ status: 200, body: "{}" }),
  openHarnessSse: async () => undefined,
  closeHarnessSse: async () => undefined,
  spawnChild: async (
    sessionId: string,
    command: string,
    args: string[],
  ) => {
    spawned.push({ sessionId, command, args });
  },
  killChild: async () => undefined,
  killAllChildren: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  watchSse: () => undefined,
  unwatchSse: () => undefined,
  writeChild: async (_id: string, line: string) => {
    written.push(line);
  },
}));

const { registerBuiltinHarnesses } = await import("./register");
const { sendHarnessTurn, stopHarnessSession, resetHarnessIdlePark } =
  await import("./registry");
const { __claudeTestReset, stopClaudeSession } = await import("../providers/claude/claude");
const { __codexTestReset, stopCodexSession, __codexTestResumeMap } =
  await import("../providers/codex/codex");
const {
  canReplay,
  createNativeResumeSession,
  nativeHarnessFor,
  resolveImportModel,
  truncateImportTitle,
} = await import("./sessionImport");
import type { ExternalSessionInfo } from "./sessionImport";
import { resetHarnessModelOverlays, setHarnessModels } from "../../../features/sessions/model/models";
import type { HarnessEvent } from "./types";

registerBuiltinHarnesses();

function parseRpc() {
  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

/** Settle a turn promise even if the mocked CLI never answers. */
async function settle(promise: Promise<unknown>): Promise<void> {
  await Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
}

function claudeInfo(): ExternalSessionInfo {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    title: "Fixed login redirect by clearing stale cookies.",
    updatedAt: "2026-08-01T10:02:00.000Z",
    messageCount: 3,
    source: "claude",
    cwd: "/repo",
    file: "/fake/sess.jsonl",
  };
}

function codexInfo(): ExternalSessionInfo {
  return {
    id: "thread-aaa-1111",
    title: "Refactor the settings panel",
    messageCount: 2,
    source: "codex",
    cwd: "/repo",
    file: "/fake/rollout.jsonl",
  };
}

function firstTurn(
  sessionId: string,
  harness: "claude" | "codex",
  cwd: string,
  model: string,
): Promise<void> {
  return sendHarnessTurn({
    harness,
    sessionId,
    cwd,
    model,
    modelSettings: {},
    runtimeMode: "supervised",
    text: "continue where we left off",
    attachments: [],
    onEvent: (_event: HarnessEvent) => undefined,
  });
}

beforeEach(() => {
  spawned.length = 0;
  written.length = 0;
  onLine = undefined;
});

afterEach(() => {
  __claudeTestReset();
  __codexTestReset();
  resetHarnessIdlePark();
});

describe("sessionImport native resume", () => {
  it("creates a bound claude session with a tab-sized title", () => {
    const session = createNativeResumeSession(claudeInfo());
    expect(session.harness).toBe("claude");
    expect(session.cwd).toBe("/repo");
    expect(session.title).toBe(
      "Fixed login redirect by clearing stale cookies.",
    );
    expect(session.providerSessionId).toBeUndefined();
  });

  it("creates a bound codex session", () => {
    setHarnessModels("codex", [
      { id: "codex:gpt-5.4", harness: "codex", name: "GPT-5.4" },
    ]);
    try {
      const session = createNativeResumeSession(codexInfo(), {
        model: "codex:gpt-5.4",
      });
      expect(session.harness).toBe("codex");
      expect(session.model).toBe("codex:gpt-5.4");
      expect(__codexTestResumeMap().get(session.id)?.threadId).toBe(
        "thread-aaa-1111",
      );
    } finally {
      resetHarnessModelOverlays();
    }
  });

  it("falls back to the provider default for unknown model ids", () => {
    resetHarnessModelOverlays();
    expect(resolveImportModel("codex", "codex:gpt-5.4")).toBeUndefined();
    // Unknown ids must not reach the session: resolveImportModel gates them
    // before newSession (whose empty-catalog fallback is pre-existing
    // behavior, unchanged here).
    const session = createNativeResumeSession(codexInfo(), {
      model: "codex:gpt-5.4",
    });
    expect(session.harness).toBe("codex");
    expect(typeof session.model).toBe("string");
  });

  it("rejects sources without a native harness", () => {
    expect(() =>
      createNativeResumeSession({
        ...claudeInfo(),
        source: "zcode" as never,
      }),
    ).toThrow(/no native resume harness/i);
  });

  it("rejects empty native ids instead of starting fresh silently", () => {
    expect(() =>
      createNativeResumeSession({ ...claudeInfo(), id: "  " }),
    ).toThrow(/without a native id/i);
  });

  it("truncates long titles", () => {
    expect(truncateImportTitle("  hello   world  ")).toBe("hello world");
    expect(truncateImportTitle("x".repeat(200)).length).toBeLessThanOrEqual(
      81,
    );
  });

  it("maps native harnesses per source", () => {
    expect(nativeHarnessFor(claudeInfo())).toBe("claude");
    expect(nativeHarnessFor(codexInfo())).toBe("codex");
    expect(
      nativeHarnessFor({ ...codexInfo(), source: "opencode" }),
    ).toBe("opencode");
    expect(
      nativeHarnessFor({ ...codexInfo(), source: "cline" }),
    ).toBe("cline");
    expect(
      nativeHarnessFor({ ...codexInfo(), source: "antigravity" }),
    ).toBe("antigravity-cli");
    expect(
      nativeHarnessFor({ ...codexInfo(), source: "zcode" }),
    ).toBeUndefined();
  });

  it("marks replay support per source", () => {
    expect(canReplay(claudeInfo())).toBe(true);
    expect(canReplay({ ...codexInfo(), source: "zcode" })).toBe(true);
    expect(canReplay({ ...codexInfo(), source: "antigravity" })).toBe(false);
  });

  it("creates an Antigravity CLI session for an imported Antigravity conversation", () => {
    const session = createNativeResumeSession({
      ...codexInfo(),
      source: "antigravity",
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(session.harness).toBe("antigravity-cli");
  });

  it("passes --resume with the native id to the claude CLI", async () => {
    const session = createNativeResumeSession(claudeInfo());
    const done = firstTurn(session.id, "claude", session.cwd, session.model);
    await waitFor(() => spawned.length > 0, "claude spawn");
    const args = spawned[0].args;
    const resumeAt = args.indexOf("--resume");
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(args[resumeAt + 1]).toBe("aaaaaaaa-1111-4111-8111-111111111111");
    await stopHarnessSession("claude", session.id).catch(() => undefined);
    await stopClaudeSession(session.id).catch(() => undefined);
    await settle(done);
  });

  it("issues thread/resume with the native id to codex app-server", async () => {
    const session = createNativeResumeSession(codexInfo());
    const done = firstTurn(session.id, "codex", session.cwd, session.model);
    await waitFor(
      () => parseRpc().some((m) => m.method === "initialize"),
      "initialize",
    );
    const initId = parseRpc().find((m) => m.method === "initialize")?.id;
    onLine!(JSON.stringify({ id: initId, result: {} }));
    await waitFor(
      () =>
        parseRpc().some(
          (m) =>
            m.method === "thread/resume" &&
            (m.params as Record<string, unknown>)?.threadId ===
              "thread-aaa-1111",
        ),
      "thread/resume",
    );
    const resumeId = parseRpc().find((m) => m.method === "thread/resume")?.id;
    // Non-recoverable error settles the turn without starting fresh.
    onLine!(
      JSON.stringify({
        id: resumeId,
        error: { code: -32603, message: "thread gone" },
      })
    );
    await settle(done);
    await stopHarnessSession("codex", session.id).catch(() => undefined);
    await stopCodexSession(session.id).catch(() => undefined);
  });
});
