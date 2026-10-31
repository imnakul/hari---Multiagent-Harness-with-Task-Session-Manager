// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "../../../app/shell/WindowControls";
import { MONO_WINDOW_CONTROLS_WIDTH } from "./MonoSidebar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => undefined,
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("Mono panel window-controls room (L-201)", () => {
  it("leaves a 2.5rem slot for every window-control button, bell included", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(WindowControls)));
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]?.getAttribute("title")).toBe("Notifications");
    expect(MONO_WINDOW_CONTROLS_WIDTH).toBe(`calc(${buttons.length * 2.5}rem + 1px)`);
    act(() => root.unmount());
    container.remove();
  });
});
