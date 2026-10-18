// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidateWatchedFiles: vi.fn(),
  generateHelperCommitMessage: vi.fn(),
  generateHelperPrContent: vi.fn(),
  helperFailureMessage: vi.fn(() => "The description was not generated."),
  openUrl: vi.fn(async () => {}),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffIndex: vi.fn(),
  gitHistory: vi.fn(async () => []),
  gitPrStatus: vi.fn(async () => null),
  gitPull: vi.fn(async () => {}),
  gitPush: vi.fn(async () => {}),
  gitSync: vi.fn(async () => {}),
  gitCommit: vi.fn(async () => {}),
  gitHeadMessage: vi.fn(async () => ""),
  gitStageAll: vi.fn(async () => {}),
  gitUnstageAll: vi.fn(async () => {}),
  gitDiscardAll: vi.fn(async () => {}),
  gitStageFile: vi.fn(async () => {}),
  gitUnstageFile: vi.fn(async () => {}),
  gitDiscardFile: vi.fn(async () => {}),
  gitPrCreate: vi.fn(async () => ""),
  gitRangeContext: vi.fn(),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
  basename: (path: string) => path.split("/").pop() ?? path,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

vi.mock("../../../integrations/harness", () => ({
  generateHelperCommitMessage: mocks.generateHelperCommitMessage,
  generateHelperPrContent: mocks.generateHelperPrContent,
  helperFailureMessage: mocks.helperFailureMessage,
}));

vi.mock("../../files/model/fileWatch", () => ({
  invalidateWatchedFiles: mocks.invalidateWatchedFiles,
  nudgeWatchedFiles: vi.fn(),
}));

vi.mock("../../inbox/model/inboxSelfActivity", () => ({
  recordInboxSelfActivity: vi.fn(),
}));

import { GitChangesPanel, rememberIndex } from "./GitChangesPanel";
import {
  gitDiffIndex,
  gitPull,
  gitPush,
  gitPrCreate,
  gitRangeContext,
  gitStageFile,
  gitUnstageFile,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import {
  generateHelperCommitMessage,
  generateHelperPrContent,
} from "../../../integrations/harness";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GitChangedFile, GitDiffIndex } from "../../../platform/tauri/fs";

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feature/pull",
    head: "abc123",
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: true,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Keep delayed file invalidations from reaching the next test's mocks.
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(gitDiffIndex).mockReset();
  vi.mocked(gitPull).mockReset();
  mocks.invalidateWatchedFiles.mockReset();
  mocks.generateHelperCommitMessage.mockReset();
  mocks.generateHelperPrContent.mockReset();
  mocks.helperFailureMessage
    .mockReset()
    .mockReturnValue("The description was not generated.");
  mocks.openUrl.mockReset();
  vi.mocked(gitPush).mockReset();
  vi.mocked(gitPrCreate).mockReset();
  vi.mocked(generateHelperCommitMessage).mockReset();
  mocks.invalidateWatchedFiles.mockReset();
  vi.mocked(gitStageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitUnstageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(notifyGitChanged).mockClear();
  vi.mocked(generateHelperCommitMessage).mockReset();
  mocks.invalidateWatchedFiles.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

describe("GitChangesPanel commit message generation", () => {
  it("keeps a manual message editable when the file selection is empty", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [] }));
    await renderPanel();

    const message = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(message.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(message, "Manual summary");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(message.value).toBe("Manual summary");
  });

  it("cancels promptly and ignores a late result after a retry", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: "/repo/change.ts",
            relative: "change.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            staged: true,
            unstaged: false,
          },
        ],
      }),
    );
    let resolveFirst!: (message: string) => void;
    vi.mocked(generateHelperCommitMessage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("New message");
    await renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
    });
    const signal = vi.mocked(generateHelperCommitMessage).mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancel commit message generation"]',
        )!
        .click();
    });
    expect(signal?.aborted).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Generate commit message"]',
      )?.disabled,
    ).toBe(false);
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
    });
    expect(container.querySelector("textarea")?.value).toBe("New message");

    await act(async () => resolveFirst("Old message"));
    expect(container.querySelector("textarea")?.value).toBe("New message");
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
  document.body
    .querySelectorAll("[data-popover-side]")
    .forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

async function renderPanel(cwd = "/repo") {
  act(() =>
    root.render(
      createElement(GitChangesPanel, {
        cwd,
        enabled: true,
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  await act(async () => {});
}

async function openBranchMenu() {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Branch actions"]',
  )!;
  await act(async () => toggle.click());
  await act(async () => {});
  return document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
}

function changedFile(
  relative: string,
  overrides: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
    ...overrides,
  };
}

async function showTree() {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-label="View as Tree"]',
  );
  if (toggle) await act(async () => toggle.click());
  let collapsed: HTMLButtonElement | null;
  while (
    (collapsed = container.querySelector<HTMLButtonElement>(
      'button[title][aria-expanded="false"]',
    ))
  ) {
    const folder = collapsed;
    await act(async () => folder.click());
  }
}

describe("GitChangesPanel folder actions", () => {
  it.each(["/repo", "remote://machine/home/user/repo"])(
    "stages a collapsed folder in one operation for %s",
    async (cwd) => {
      const files = [
        changedFile("src/app.ts", { path: `${cwd}/src/app.ts` }),
        changedFile("src/nested/new.ts", {
          path: `${cwd}/src/nested/new.ts`,
          status: "untracked",
        }),
        changedFile("src-other/other.ts"),
        changedFile("docs/ready.md", { staged: true, unstaged: false }),
      ];
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ files }));
      await renderPanel(cwd);
      await showTree();
      const folder = container.querySelector<HTMLButtonElement>(
        'button[title="src"]',
      )!;
      await act(async () => folder.click());
      expect(folder.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('button[title="src/app.ts"]')).toBeNull();

      mocks.invalidateWatchedFiles.mockClear();
      vi.mocked(notifyGitChanged).mockClear();
      const reads = vi.mocked(gitDiffIndex).mock.calls.length;
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Stage Changes in src"]',
          )!
          .click();
      });

      expect(gitStageFile).toHaveBeenCalledExactlyOnceWith(cwd, "src");
      expect(gitUnstageFile).not.toHaveBeenCalled();
      expect(mocks.invalidateWatchedFiles).toHaveBeenCalledWith([
        `${cwd}/src/app.ts`,
        `${cwd}/src/nested/new.ts`,
      ]);
      expect(notifyGitChanged).toHaveBeenCalled();
      expect(vi.mocked(gitDiffIndex).mock.calls.length).toBeGreaterThan(reads);
      expect(folder.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("stages a nested folder without toggling it or including its siblings", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts"),
          changedFile("src/nested/one.ts"),
          changedFile("src/nested/deeper/two.ts"),
          changedFile("src/nested-other/three.ts"),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    const folder = container.querySelector<HTMLButtonElement>(
      'button[title="src/nested"]',
    )!;
    mocks.invalidateWatchedFiles.mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in src/nested"]',
        )!
        .click();
    });

    expect(gitStageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src/nested");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.invalidateWatchedFiles).toHaveBeenCalledWith([
      "/repo/src/nested/one.ts",
      "/repo/src/nested/deeper/two.ts",
    ]);
  });

  it("unstages the staged folder including files that also have unstaged changes", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts", { staged: true, unstaged: false }),
          changedFile("src/nested/partial.ts", { staged: true }),
          changedFile("docs/readme.md", { staged: true, unstaged: false }),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Unstage Changes in src"]',
        )!
        .click();
    });

    expect(gitUnstageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src");
    expect(gitStageFile).not.toHaveBeenCalled();
  });

  it("disables folder and file mutations while a folder action is running", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [changedFile("src/app.ts"), changedFile("docs/readme.md")],
      }),
    );
    let finish!: () => void;
    vi.mocked(gitStageFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in src"]',
        )!
        .click();
    });
    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Stage Changes"], button[aria-label="Discard Changes"]',
      ),
    ];
    expect(actions.length).toBeGreaterThan(2);
    expect(actions.every((action) => action.disabled)).toBe(true);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in docs"]',
        )!
        .click();
    });
    expect(gitStageFile).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(actions.every((action) => !action.disabled)).toBe(true);
  });

  it("reports errors and enables folder actions again", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [changedFile("src/app.ts")] }),
    );
    vi.mocked(gitStageFile).mockRejectedValueOnce(
      new Error("Git index is locked"),
    );
    await renderPanel();
    await showTree();
    mocks.invalidateWatchedFiles.mockClear();
    const stage = container.querySelector<HTMLButtonElement>(
      '[aria-label="Stage Changes in src"]',
    )!;
    await act(async () => stage.click());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(alert).toHaveBeenCalledWith("Git index is locked");
    expect(stage.disabled).toBe(false);
    expect(mocks.invalidateWatchedFiles).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe("GitChangesPanel pull action", () => {
  it("disables Pull when the branch has no upstream", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: null, upstream: null }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.textContent).toContain("Pull");
    expect(pull.disabled).toBe(true);
  });

  it("disables Pull when the repository has no remote", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: null, upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(true);
  });

  it("pulls the current branch and reloads watched files", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(false);

    mocks.invalidateWatchedFiles.mockClear();
    await act(async () => {
      pull.click();
      await Promise.resolve();
    });

    expect(gitPull).toHaveBeenCalledWith("/repo");
    expect(mocks.invalidateWatchedFiles).toHaveBeenCalled();
  });
});

describe("GitChangesPanel custom PR recovery", () => {
  const draft = {
    title: "Draft title",
    body: "Draft body",
    base: "main",
    head: "feature/pull",
  };

  async function showCreatePr(ahead: number) {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        ahead,
        behind: 0,
        aheadOfDefault: 1,
        headPushed: ahead === 0,
      }),
    );
    mocks.generateHelperPrContent.mockResolvedValue({
      status: "needs-review",
      draft,
      failure: {
        ok: false,
        kind: "auth",
        target: { provider: "claude" },
        message: "sign in required",
        calls: 1,
      },
    });
    await renderPanel();
    const create = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create PR"))!;
    await act(async () => {
      create.click();
      await Promise.resolve();
    });
  }

  it("pushes before helper generation and shows a draft without creating a PR", async () => {
    await showCreatePr(1);

    expect(gitPush).toHaveBeenCalledWith("/repo");
    expect(mocks.generateHelperPrContent).toHaveBeenCalledWith(
      "/repo",
      undefined,
    );
    expect(gitPush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateHelperPrContent.mock.invocationCallOrder[0]!,
    );
    expect(gitPrCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Pull request details");
    expect(document.body.textContent).toContain(
      "Your branch was pushed to origin/feature/pull. No pull request was created.",
    );
  });

  it("does not claim that a push happened when the branch was already pushed", async () => {
    await showCreatePr(0);

    expect(gitPush).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Pull request details");
    expect(document.body.textContent).not.toContain(
      "Your branch was pushed to origin/feature/pull.",
    );
    expect(gitPrCreate).not.toHaveBeenCalled();
  });

  it("keeps the ready PR flow ordered after a push and opens the returned URL", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        ahead: 1,
        behind: 0,
        aheadOfDefault: 1,
        headPushed: false,
      }),
    );
    mocks.generateHelperPrContent.mockResolvedValue({
      status: "ready",
      content: draft,
    });
    vi.mocked(gitPrCreate).mockResolvedValue(
      "https://github.com/work/repo/pull/12",
    );
    await renderPanel();
    const create = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create PR"))!;

    await act(async () => {
      create.click();
      await Promise.resolve();
    });

    expect(gitPush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateHelperPrContent.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.generateHelperPrContent.mock.invocationCallOrder[0],
    ).toBeLessThan(gitPrCreate.mock.invocationCallOrder[0]!);
    expect(gitPrCreate).toHaveBeenCalledWith(
      "/repo",
      draft.title,
      draft.body,
      draft.base,
      draft.head,
    );
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/work/repo/pull/12",
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps text typed while commit generation is pending", async () => {
    const file = {
      path: "/repo/README.md",
      relative: "README.md",
      status: "modified",
      additions: 1,
      deletions: 0,
      staged: true,
      unstaged: false,
    };
    let resolveGeneration: ((message: string) => void) | undefined;
    mocks.generateHelperCommitMessage.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [file] }));
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    await renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
    });
    const message = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(message.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(message, "typed while generating");
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      resolveGeneration?.("generated message");
      await Promise.resolve();
    });

    expect(message.value).toBe("typed while generating");
    expect(alert).toHaveBeenCalledWith(
      "A commit message was generated, but you edited the field, so it wasn't applied.",
    );
  });

  it("applies the generated commit message when the field stayed unchanged", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: "/repo/README.md",
            relative: "README.md",
            status: "modified",
            additions: 1,
            deletions: 0,
            staged: true,
            unstaged: false,
          },
        ],
      }),
    );
    mocks.generateHelperCommitMessage.mockResolvedValue("generated message");
    await renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")!.value,
    ).toBe("generated message");
  });
});

describe("GitChangesPanel remote pull request", () => {
  it("creates it from the host Git range without calling a local harness", async () => {
    const cwd = "remote://machine/home/user/repo";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        ahead: 1,
        aheadOfDefault: 1,
      }),
    );
    vi.mocked(gitRangeContext).mockResolvedValue({
      base: "main",
      head: "feature/pull",
      commitSummary: "abc123 Fix remote flow\ndef456 Add coverage",
      diffSummary: "2 files changed, 4 insertions(+)\n",
      diffPatch: "",
    });
    vi.mocked(gitPrCreate).mockResolvedValue("https://example.test/pull/42");
    await renderPanel(cwd);

    const button = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === "Create PR");
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });

    expect(gitPush).toHaveBeenCalledWith(cwd);
    expect(gitRangeContext).toHaveBeenCalledWith(cwd);
    expect(mocks.generateHelperPrContent).not.toHaveBeenCalled();
    expect(gitPrCreate).toHaveBeenCalledWith(
      cwd,
      "Fix remote flow",
      expect.stringContaining("## Changes\n\n2 files changed"),
      "main",
      "feature/pull",
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.test/pull/42");
  });
});

describe("worktree switching", () => {
  it("shows cached destination data immediately while refreshing", async () => {
    const a = index({ branch: "worktree-a" });
    const b = index({ branch: "worktree-b" });
    vi.mocked(gitDiffIndex).mockResolvedValueOnce(a);
    await renderPanel("/switch/a");
    expect(container.textContent).toContain("worktree-a");
    rememberIndex("/switch/b", b);
    vi.mocked(gitDiffIndex).mockImplementationOnce(() => new Promise(() => {}));
    await renderPanel("/switch/b");
    expect(container.textContent).toContain("worktree-b");
    expect(container.textContent).not.toContain("worktree-a");
  });

  it("never shows previous files in an uncached worktree and ignores late results", async () => {
    let finish!: (value: GitDiffIndex) => void;
    vi.mocked(gitDiffIndex).mockResolvedValueOnce(
      index({ branch: "old-worktree" }),
    );
    await renderPanel("/switch/old");
    vi.mocked(gitDiffIndex).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel("/switch/loading");
    expect(container.textContent).not.toContain("old-worktree");
    vi.mocked(gitDiffIndex).mockResolvedValueOnce(
      index({ branch: "chosen-worktree" }),
    );
    await renderPanel("/switch/chosen");
    await act(async () => finish(index({ branch: "late-worktree" })));
    expect(container.textContent).toContain("chosen-worktree");
    expect(container.textContent).not.toContain("late-worktree");
  });
});
