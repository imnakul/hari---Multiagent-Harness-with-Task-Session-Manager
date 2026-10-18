// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitNotice } from "./UsageLimitNotice";

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

const limit = { resetsAt: Date.now() + 3_600_000 };

describe("usage-limit Continue on account", () => {
  it("shows a Continue on <account> button with the cost note when another account exists", () => {
    const onContinueOnAccount = vi.fn();
    act(() =>
      root.render(
        createElement(UsageLimitNotice, {
          limit,
          continueAccounts: [{ id: "account-1", label: "imnakul" }],
          onContinueOnAccount,
        }),
      ),
    );
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Continue on"),
    );
    expect(button?.textContent).toBe("Continue on imnakul");
    expect(button?.title).toContain("is not cached");
    act(() => button?.click());
    expect(onContinueOnAccount).toHaveBeenCalledWith("account-1");
  });

  it("offers a menu for several accounts and nothing without any", () => {
    act(() =>
      root.render(
        createElement(UsageLimitNotice, {
          limit,
          continueAccounts: [
            { id: "a", label: "One" },
            { id: "b", label: "Two" },
          ],
          onContinueOnAccount: vi.fn(),
        }),
      ),
    );
    expect(container.querySelectorAll("select option")).toHaveLength(3);
    act(() => root.render(createElement(UsageLimitNotice, { limit })));
    expect(container.textContent).not.toContain("Continue on");
    act(() =>
      root.render(
        createElement(UsageLimitNotice, {
          limit,
          continueAccounts: [],
          onContinueOnAccount: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).not.toContain("Continue on");
  });
});
