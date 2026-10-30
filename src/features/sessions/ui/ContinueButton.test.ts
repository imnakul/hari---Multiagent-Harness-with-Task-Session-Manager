// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../integrations/harness/core/continueHelper", () => ({
  continueHelperAvailable: () => true,
}));

import { ContinueButton } from "./ContinueButton";
import { saveProviderAccount } from "../../providers/model/providerAccounts";
import { saveContinueChoice } from "../model/continueChoice";
import type { ContinueChoice } from "../model/continueCard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function open(props: { operatorOn?: boolean; onContinue?: (choice: ContinueChoice) => void }) {
  act(() =>
    root.render(
      createElement(ContinueButton, {
        from: "claude",
        fromModel: "claude-sonnet-4-6",
        projectCwd: "/repo",
        operatorOn: props.operatorOn,
        estimate: () => ({ helperReads: 0, card: 100 }),
        onContinue: props.onContinue ?? (() => undefined),
      }),
    ),
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Continue in a new chat"]')!
      .click(),
  );
}

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-continue-panel]")!;
}

function continueClick() {
  const button = Array.from(panel().querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Continue",
  )!;
  act(() => button.click());
}

describe("Continue popover pickers (L-193)", () => {
  it("shows the Account row only when the provider has more than one account", () => {
    open({});
    expect(panel().querySelector('[aria-label^="Account:"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);

    saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
    open({});
    const account = panel().querySelector<HTMLButtonElement>('[aria-label^="Account:"]');
    expect(account?.getAttribute("aria-label")).toBe("Account: Same as this chat");
  });

  it("sends the Claude mode picked in the switch", () => {
    const onContinue = vi.fn();
    open({ onContinue });
    const interactive = Array.from(
      panel().querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "Interactive")!;
    act(() => interactive.click());
    continueClick();
    expect(onContinue.mock.calls[0]?.[0].target.modelSettings.claudeExecution).toBe(
      "interactive",
    );
  });

  it("keeps Claude Structured when Operator is on, and says why", () => {
    saveContinueChoice("/repo", {
      target: {
        harness: "claude",
        model: "claude-sonnet-4-6",
        modelSettings: { claudeExecution: "interactive" },
      },
      preset: "quick",
    });
    const onContinue = vi.fn();
    open({ operatorOn: true, onContinue });
    expect(panel().textContent).toContain("Interactive can't use Operator");
    expect(panel().querySelector('[aria-label="Claude Code execution"]')).toBeNull();
    continueClick();
    expect(onContinue.mock.calls[0]?.[0].target.modelSettings.claudeExecution).toBe(
      "structured",
    );
  });

  it("drops a saved account that was removed", () => {
    saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
    saveContinueChoice("/repo", {
      target: { harness: "claude", model: "claude-sonnet-4-6", modelSettings: {} },
      accountId: "account-gone",
      preset: "quick",
    });
    const onContinue = vi.fn();
    open({ onContinue });
    continueClick();
    expect(onContinue.mock.calls[0]?.[0]).not.toHaveProperty("accountId");
  });
});
