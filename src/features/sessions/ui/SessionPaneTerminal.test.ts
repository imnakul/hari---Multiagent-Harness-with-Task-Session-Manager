// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionPane, type SessionPaneProps } from "./SessionPane";

// The composer is stubbed down to its trailing buttons, where Terminal sits.
vi.mock("./Composer", () => ({
  Composer: (props: { trailing?: ReactNode }) => props.trailing ?? null,
}));
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("./AgentTranscript", () => ({ AgentTranscript: () => null }));
// No desktop bridge in tests: its calls answer with nothing.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => null),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const noop = () => {};
function props(): SessionPaneProps {
  return {
    session: {
      id: "chat",
      title: "Chat",
      cwd: "/repo",
      harness: "codex",
      model: "",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "user", role: "user", text: "Hello" }],
    },
    visible: true,
    focused: true,
    inSplit: false,
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onSaveDraft: noop,
    onRemoveDraft: noop,
    onStop: noop,
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onUsageLimitResume: noop,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
}
function terminalButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[aria-label="Terminal"]');
}

it("shows a Terminal button beside Session overview that toggles the chat's terminal (L-233)", () => {
  const onToggleChatTerminal = vi.fn();
  act(() =>
    root.render(
      createElement(SessionPane, {
        ...props(),
        onToggleChatTerminal,
        terminalOpenProject: "/other",
      }),
    ),
  );
  const button = terminalButton();
  expect(button).not.toBeNull();
  expect(button!.nextElementSibling?.getAttribute("aria-label")).not.toBe(
    "Terminal",
  );
  expect(container.querySelector('[aria-label="Session overview"]')).not.toBeNull();
  // Another project's terminal is open: this chat's button stays off.
  expect(button!.getAttribute("aria-pressed")).toBe("false");
  act(() => button!.click());
  expect(onToggleChatTerminal).toHaveBeenCalledWith("chat");

  act(() =>
    root.render(
      createElement(SessionPane, {
        ...props(),
        onToggleChatTerminal,
        terminalOpenProject: "/repo",
      }),
    ),
  );
  expect(terminalButton()!.getAttribute("aria-pressed")).toBe("true");
});

it("has no Terminal button without a handler", () => {
  act(() => root.render(createElement(SessionPane, props())));
  expect(terminalButton()).toBeNull();
});
