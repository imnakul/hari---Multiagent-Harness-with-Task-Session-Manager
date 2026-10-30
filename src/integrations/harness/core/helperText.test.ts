import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateHarnessTitle: vi.fn(),
  runHarnessHelperPrompt: vi.fn(),
  generateCommitMessage: vi.fn(),
  generatePrContent: vi.fn(),
  isHarnessAvailable: vi.fn(() => true),
  providerAccountExists: vi.fn(() => true),
  supportsProviderAccounts: vi.fn((provider: string) =>
    provider === "claude" || provider === "codex",
  ),
  gitStagedContext: vi.fn(),
  gitRangeContext: vi.fn(),
}));

vi.mock("./registry", () => ({
  generateHarnessTitle: mocks.generateHarnessTitle,
  runHarnessHelperPrompt: mocks.runHarnessHelperPrompt,
}));
vi.mock("./textHarness", () => ({
  generateCommitMessage: mocks.generateCommitMessage,
  generatePrContent: mocks.generatePrContent,
}));
vi.mock("./availability", () => ({
  isHarnessAvailable: mocks.isHarnessAvailable,
}));
vi.mock("../../../features/providers/model/providerAccounts", () => ({
  providerAccountExists: mocks.providerAccountExists,
  supportsProviderAccounts: mocks.supportsProviderAccounts,
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitStagedContext: mocks.gitStagedContext,
  gitRangeContext: mocks.gitRangeContext,
}));

import {
  saveAiHelperSettings,
} from "../../../features/settings/model/settings";
import { fallbackPrContent } from "../../../features/source-control/model/gitText";
import {
  COMMIT_OUTPUT_SCHEMA,
  TITLE_OUTPUT_SCHEMA,
} from "./helperSchemas";
import {
  generateHelperCommitMessage,
  generateHelperPrContent,
  generateHelperTitle,
} from "./helperText";

function useLocalStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
}

beforeEach(() => {
  useLocalStorage();
  mocks.generateHarnessTitle.mockReset();
  mocks.runHarnessHelperPrompt.mockReset();
  mocks.generateCommitMessage.mockReset();
  mocks.generatePrContent.mockReset();
  mocks.isHarnessAvailable.mockReset().mockReturnValue(true);
  mocks.providerAccountExists.mockReset().mockReturnValue(true);
  mocks.supportsProviderAccounts
    .mockReset()
    .mockImplementation((provider) => provider === "claude" || provider === "codex");
  mocks.gitStagedContext.mockReset().mockResolvedValue({
    branch: "feature/helpers",
    summary: "src/app.ts | 2 +-\n 1 file changed",
    patch: "diff --git a/src/app.ts b/src/app.ts",
  });
  mocks.gitRangeContext.mockReset().mockResolvedValue({
    base: "main",
    head: "feature/helpers",
    commitSummary: "feat: choose helper model",
    diffSummary: "1 file changed",
    diffPatch: "diff --git a/src/app.ts b/src/app.ts",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unverified helper providers (L-193)", () => {
  it("runs an installed Antigravity helper; its runner stops tool use", async () => {
    saveAiHelperSettings({
      mode: "custom",
      primary: { provider: "antigravity" },
      fallback: null,
    });
    mocks.runHarnessHelperPrompt.mockResolvedValue(
      '{"subject":"feat: antigravity helper","body":""}',
    );
    expect(await generateHelperCommitMessage("/repo")).toBe(
      "feat: antigravity helper",
    );
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledWith(
      "antigravity",
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});

describe("helper task wrappers", () => {
  it("keeps Automatic mode on the existing title, commit and PR functions", async () => {
    mocks.generateHarnessTitle.mockResolvedValue({
      title: "Keep existing routing",
      workItem: null,
    });
    mocks.generateCommitMessage.mockResolvedValue("feat: existing helper");
    mocks.generatePrContent.mockResolvedValue({
      title: "Existing PR helper",
      body: "## Summary\n- Existing path",
      base: "main",
      head: "feature/helpers",
    });

    expect(
      await generateHelperTitle({
        chatHarness: "codex",
        sessionId: "session-1",
        cwd: "/repo",
        message: "Make a setting",
        providerAccountId: "account-work",
      }),
    ).toEqual({ title: "Keep existing routing", workItem: null });
    expect(mocks.generateHarnessTitle).toHaveBeenCalledWith("codex", {
      sessionId: "session-1",
      cwd: "/repo",
      message: "Make a setting",
      providerAccountId: "account-work",
    });
    expect(await generateHelperCommitMessage("/repo", "codex")).toBe(
      "feat: existing helper",
    );
    expect(mocks.generateCommitMessage).toHaveBeenCalledWith("/repo", "codex");
    expect(await generateHelperPrContent("/repo", "codex")).toEqual({
      status: "ready",
      content: {
        title: "Existing PR helper",
        body: "## Summary\n- Existing path",
        base: "main",
        head: "feature/helpers",
      },
    });
    expect(mocks.generatePrContent).toHaveBeenCalledWith("/repo", "codex");
    expect(mocks.runHarnessHelperPrompt).not.toHaveBeenCalled();
  });

  it("uses the selected provider, account and model, with schema only for Codex", async () => {
    saveAiHelperSettings({
      mode: "custom",
      primary: {
        provider: "claude",
        accountId: "account-work",
        model: "claude-sonnet-4-6",
      },
      fallback: null,
    });
    mocks.runHarnessHelperPrompt.mockResolvedValue(
      '{"subject":"feat: helper choice","body":""}',
    );

    expect(await generateHelperCommitMessage("/repo", "codex")).toBe(
      "feat: helper choice",
    );
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledWith("claude", {
      cwd: "/repo",
      prompt: expect.stringContaining("Staged patch:"),
      timeoutMs: 90_000,
      providerAccountId: "account-work",
      model: "claude-sonnet-4-6",
    });
    expect(mocks.runHarnessHelperPrompt.mock.calls[0]?.[1]).not.toHaveProperty(
      "outputSchema",
    );

    saveAiHelperSettings({
      mode: "custom",
      primary: { provider: "codex", model: "gpt-5.4" },
      fallback: null,
    });
    mocks.runHarnessHelperPrompt.mockReset().mockResolvedValue(
      '{"subject":"feat: codex helper","body":""}',
    );
    expect(await generateHelperCommitMessage("/repo")).toBe(
      "feat: codex helper",
    );
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        model: "gpt-5.4",
        outputSchema: COMMIT_OUTPUT_SCHEMA,
      }),
    );
  });

  it("parses custom titles and returns a review draft instead of creating PR content", async () => {
    saveAiHelperSettings({
      mode: "custom",
      primary: { provider: "codex", model: "gpt-5.4" },
      fallback: null,
    });
    mocks.runHarnessHelperPrompt.mockResolvedValue(
      '{"title":"Specific helper","workItem":null}',
    );

    expect(
      await generateHelperTitle({
        chatHarness: "claude",
        sessionId: "session-2",
        cwd: "/repo",
        message: "A concise title seed",
      }),
    ).toEqual({ title: "Specific helper", workItem: null });
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({ outputSchema: TITLE_OUTPUT_SCHEMA }),
    );

    mocks.runHarnessHelperPrompt
      .mockReset()
      .mockResolvedValue("not a JSON reply");
    const outcome = await generateHelperPrContent("/repo");
    expect(outcome).toEqual({
      status: "needs-review",
      draft: {
        title: "feat: choose helper model",
        body: "feat: choose helper model",
        base: "main",
        head: "feature/helpers",
      },
      failure: expect.objectContaining({ ok: false, kind: "invalid" }),
    });
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledTimes(2);
    expect(
      fallbackPrContent({
        head: "feature/new-work",
        commitSummary: "feat: concise subject\nfix: second subject",
      }),
    ).toEqual({
      title: "feat: concise subject",
      body: "feat: concise subject\nfix: second subject",
    });
  });

  it("does not call an unavailable primary or fall back after authentication errors", async () => {
    mocks.isHarnessAvailable.mockImplementation(
      (provider) => provider !== "antigravity",
    );
    saveAiHelperSettings({
      mode: "custom",
      primary: { provider: "antigravity" },
      fallback: null,
    });
    expect(
      await generateHelperTitle({
        chatHarness: "codex",
        sessionId: "session-3",
        cwd: "/repo",
        message: "Title",
      }),
    ).toBeNull();
    expect(mocks.runHarnessHelperPrompt).not.toHaveBeenCalled();

    saveAiHelperSettings({
      mode: "custom",
      primary: { provider: "claude" },
      fallback: { provider: "codex" },
    });
    mocks.runHarnessHelperPrompt.mockRejectedValue(
      new Error("401 sign in required"),
    );
    await expect(generateHelperCommitMessage("/repo")).rejects.toMatchObject({
      kind: "auth",
    });
    expect(mocks.runHarnessHelperPrompt).toHaveBeenCalledTimes(1);
  });
});
