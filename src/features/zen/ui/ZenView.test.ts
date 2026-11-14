// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
// Native window buttons need a Tauri window; they are not under test here.
vi.mock("../../../app/shell/WindowControls", () => ({
  WindowControls: () => null,
}));

const { ZenView } = await import("./ZenView");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ZenView header (L-264)", () => {
  it("has a Settings button that hands off to the app", async () => {
    const onOpenSettings = vi.fn();
    await act(async () =>
      root.render(
        createElement(ZenView, {
          rows: [],
          sessions: [],
          boardCards: [],
          recents: [],
          chats: [],
          tool: "chat",
          onToolChange: vi.fn(),
          monoId: null,
          showMonos: false,
          onOpenMono: vi.fn(),
          pinned: false,
          onTogglePin: vi.fn(),
          renderPane: () => null,
          renderTool: () => null,
          onFocusPane: vi.fn(),
          onShow: vi.fn(),
          onNewChat: vi.fn(),
          onClosePane: vi.fn(),
          onExit: vi.fn(),
          onOpenSettings,
        }),
      ),
    );
    const button = container.querySelector<HTMLButtonElement>(
      'header button[aria-label="Settings (leaves Zen mode)"]',
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
