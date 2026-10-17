// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({
  status: "stopped",
  current: { phase: "stopped", terminal: { reason: "stopped" } },
  lastBlocked: { phase: "ready", terminal: { reason: "prompt-mismatch" } },
}));
const commands = vi.hoisted(() => ({ stop: vi.fn(), release: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => undefined }),
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasHarnessEvidence: () => true,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: async () => undefined,
  subscribeHarnessAvailability: () => () => undefined,
}));
vi.mock(
  "../../../integrations/harness/providers/claude/claudeInteractiveTerminal",
  () => ({
    interactiveTerminalFor: () => undefined,
    interactiveTerminalRevision: () => 0,
    subscribeInteractiveTerminals: () => () => undefined,
  }),
);
vi.mock(
  "../../../integrations/harness/providers/claude/claudeInteractive",
  () => ({
    interactiveClaudeDiagnostics: () => saved,
    hasInteractiveClaudeDiagnostics: () => true,
    stopInteractiveClaude: commands.stop,
    releaseInteractiveApprovals: commands.release,
  }),
);
import { ClaudeInteractiveTerminal } from "./ClaudeInteractiveTerminal";
import { Composer } from "./Composer";

it("copies the saved failure without needing or starting a native terminal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const clipboard = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ClaudeInteractiveTerminal, {
          sessionId: "stopped-session",
          onClose: vi.fn(),
        }),
      ),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Claude startup diagnostics");
    expect(dialog.textContent).toContain("Process stopped");
    expect(dialog.textContent).not.toContain("Use terminal");
    expect(dialog.textContent).not.toContain("Return to chat");
    const copy = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Copy diagnostics",
    )!;
    await act(async () => copy.click());
    expect(clipboard).toHaveBeenCalledWith(JSON.stringify(saved, null, 2));
    expect(copy.textContent).toBe("Copied");
    expect(commands.stop).not.toHaveBeenCalled();
    expect(commands.release).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    clipboard.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("opens retained diagnostics from the actual composer after its terminal is gone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Composer, {
          harness: "claude",
          model: "claude:sonnet-5",
          modelSettings: { claudeExecution: "interactive" },
          runtimeMode: "supervised",
          cwd: "/repo",
          executionCwd: "/repo",
          sessionId: "stopped-session",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const picker = [
      ...container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]"),
    ].find((button) => button.textContent?.includes("Interactive"))!;
    await act(async () => picker.click());
    const view = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "View startup diagnostics")!;
    expect(view).toBeDefined();
    await act(async () => view.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Copy diagnostics",
    );
    expect(commands.stop).not.toHaveBeenCalled();
    expect(commands.release).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
