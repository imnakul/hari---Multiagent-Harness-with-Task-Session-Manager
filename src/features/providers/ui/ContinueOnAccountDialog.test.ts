// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinueOnAccountDialog } from "./ContinueOnAccountDialog";

vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("div", { role: "dialog", "aria-label": title }, children),
}));

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

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}

function render(
  props: Partial<Parameters<typeof ContinueOnAccountDialog>[0]>,
): { onContinue: ReturnType<typeof vi.fn>; onNewChat: ReturnType<typeof vi.fn> } {
  const handlers = {
    onContinue: vi.fn(async () => undefined),
    onNewChat: vi.fn(),
    onClose: vi.fn(),
  };
  act(() =>
    root.render(
      createElement(ContinueOnAccountDialog, {
        accountLabel: "imnakul",
        blockedReason: null,
        ...handlers,
        ...props,
      }),
    ),
  );
  return handlers;
}

describe("ContinueOnAccountDialog", () => {
  it("asks with the cost note and the rewind caveat in details", () => {
    render({});
    expect(container.textContent).toContain("is not cached");
    expect(container.textContent).toContain("Rewinding");
    expect(
      container.querySelector('[aria-label="Continue this chat on imnakul?"]'),
    ).not.toBeNull();
  });

  it("New chat keeps today's behaviour and Continue here copies", async () => {
    const handlers = render({});
    await act(async () => button("New chat").click());
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
    expect(handlers.onContinue).not.toHaveBeenCalled();
    await act(async () => button("Continue here").click());
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows the stop-or-wait message and disables Continue when blocked", async () => {
    const handlers = render({ blockedReason: "Stop it or wait." });
    expect(container.textContent).toContain("Stop it or wait.");
    expect(button("Continue here").disabled).toBe(true);
    await act(async () => button("Continue here").click());
    expect(handlers.onContinue).not.toHaveBeenCalled();
  });

  it("shows a refusal from the copy and re-enables the buttons", async () => {
    render({
      onContinue: vi.fn(async () => {
        throw new Error("already has a different version");
      }),
    });
    await act(async () => button("Continue here").click());
    expect(container.textContent).toContain("already has a different version");
    expect(button("Continue here").disabled).toBe(false);
  });
});
