// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImproveOutcome } from "../../../integrations/harness/core/promptImproveHelper";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  EMPTY_PROMPT_MEMORY,
  loadPromptMemory,
  memoryProjectKey,
  savePromptMemory,
} from "../model/promptImproveStore";
import {
  ImprovePromptButton,
  ImprovePromptStrip,
} from "./PromptImproveControls";
import { usePromptImprove, type PromptImprove } from "./usePromptImprove";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../integrations/harness/core/promptImproveHelper", () => ({
  improvePrompt: vi.fn(),
}));
vi.mock("../model/agentsRule", () => ({ addRuleToAgentsFile: vi.fn() }));

const { improvePrompt } =
  await import("../../../integrations/harness/core/promptImproveHelper");
const { addRuleToAgentsFile } = await import("../model/agentsRule");

const CWD = "/home/me/shop";
const DRAFT = "fix the header spacing on mobile";
const REWRITE =
  "Fix the header spacing on mobile. Done when: no overlap at 320px.";

let root: Root;
let container: HTMLDivElement;
let hook: PromptImprove;
let text: string;
let setTextState: (next: string) => void;
let resolveRun: (outcome: ImproveOutcome) => void;

function ok(rules: string[] = []): ImproveOutcome {
  return {
    ok: true,
    prompt: REWRITE,
    learned: { styles: [], terms: [], rules },
    usedSamples: 0,
    helper: { provider: "claude" },
  };
}

function Probe({ available }: { available: boolean }) {
  const [value, setValue] = useState(DRAFT);
  text = value;
  setTextState = setValue;
  hook = usePromptImprove({
    available,
    scopeKey: "chat-1",
    text: value,
    cwd: CWD,
    harness: "claude",
    getText: () => text,
    setText: (next) => {
      text = next;
      setValue(next);
    },
  });
  return createElement(
    "div",
    null,
    createElement(ImprovePromptStrip, { improve: hook }),
    createElement(ImprovePromptButton, { improve: hook }),
  );
}

async function render(available = true): Promise<void> {
  await act(async () => root.render(createElement(Probe, { available })));
}

async function type(next: string): Promise<void> {
  await act(async () => {
    text = next;
    setTextState(next);
  });
}

async function finishRun(outcome: ImproveOutcome): Promise<void> {
  await act(async () => {
    resolveRun(outcome);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(improvePrompt).mockImplementation(
    () =>
      new Promise<ImproveOutcome>((resolve) => {
        resolveRun = resolve;
      }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("usePromptImprove (L-252)", () => {
  it("keeps why a fallback helper wrote the rewrite (L-262)", async () => {
    await render();
    await act(async () => hook.trigger());
    await finishRun({ ...ok(), fallbackReason: "Command Code tried a tool" });
    expect(hook.view).toMatchObject({
      kind: "applied",
      helper: HARNESS_TITLE.claude,
      fallbackReason: "Command Code tried a tool",
    });
  });

  it("replaces the text in place and keeps the original one click away", async () => {
    await render();
    await act(async () => hook.trigger());
    expect(hook.running).toBe(true);
    await finishRun(ok());
    expect(text).toBe(REWRITE);
    expect(hook.reveal).toMatchObject({ id: 1, from: DRAFT });
    expect(hook.view).toMatchObject({
      kind: "applied",
      original: DRAFT,
      showing: "rewrite",
      helper: HARNESS_TITLE.claude,
    });

    await act(async () => hook.setPeeking(true));
    expect(hook.peekText).toBe(DRAFT);
    await act(async () => hook.setPeeking(false));

    await act(async () => hook.toggleOriginal());
    expect(text).toBe(DRAFT);
    await act(async () => hook.toggleOriginal());
    expect(text).toBe(REWRITE);
    // Switching versions is not a new rewrite, so nothing replays.
    expect(hook.reveal?.id).toBe(1);

    await act(async () => hook.restoreOriginal());
    expect(text).toBe(DRAFT);
    expect(hook.view.kind).toBe("idle");
  });

  it("keeps edits made to either version when switching", async () => {
    await render();
    await act(async () => hook.trigger());
    await finishRun(ok());
    await type(`${REWRITE} Keep the logo.`);
    await act(async () => hook.toggleOriginal());
    expect(text).toBe(DRAFT);
    await act(async () => hook.toggleOriginal());
    expect(text).toBe(`${REWRITE} Keep the logo.`);
  });

  it("keeps newer typing and offers the rewrite instead", async () => {
    await render();
    await act(async () => hook.trigger());
    await type(`${DRAFT} and footer`);
    await finishRun(ok());
    expect(text).toBe(`${DRAFT} and footer`);
    expect(hook.view).toMatchObject({ kind: "stale", rewrite: REWRITE });

    expect(hook.reveal).toBeNull();
    await act(async () => hook.acceptRewrite());
    expect(text).toBe(REWRITE);
    expect(hook.reveal).toMatchObject({ from: `${DRAFT} and footer` });
    expect(hook.view).toMatchObject({
      kind: "applied",
      original: `${DRAFT} and footer`,
    });
  });

  it("Esc cancels a run and a late reply is ignored", async () => {
    await render();
    let cancelled = false;
    await act(async () => hook.trigger());
    await act(async () => {
      cancelled = hook.cancel();
    });
    expect(cancelled).toBe(true);
    expect(hook.view.kind).toBe("idle");
    await finishRun(ok());
    expect(text).toBe(DRAFT);
    expect(hook.cancel()).toBe(false);
  });

  it("Stop in the strip ends a run and keeps the text", async () => {
    await render();
    await act(async () => hook.trigger());
    expect(
      container.querySelector('button[aria-label="Stop improving"]'),
    ).not.toBeNull();
    const stop = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Stop",
    );
    await act(async () => stop?.click());
    expect(hook.view.kind).toBe("idle");
    await finishRun(ok());
    expect(text).toBe(DRAFT);
    expect(hook.reveal).toBeNull();
  });

  it("shows a failure and leaves the text alone", async () => {
    await render();
    await act(async () => hook.trigger());
    await finishRun({
      ok: false,
      cancelled: false,
      message: "Couldn't improve the prompt: Claude failed.",
    });
    expect(text).toBe(DRAFT);
    expect(hook.view).toEqual({
      kind: "failed",
      message: "Couldn't improve the prompt: Claude failed.",
    });
  });

  it("learns from what was sent", async () => {
    await render();
    await act(async () => hook.trigger());
    await finishRun(ok());
    await act(async () => hook.recordSend(REWRITE));
    expect(loadPromptMemory().accepted).toBe(1);
    expect(hook.view.kind).toBe("idle");

    await act(async () => hook.trigger());
    await finishRun(ok());
    await act(async () => hook.recordSend(`${REWRITE} Also the footer.`));
    expect(loadPromptMemory()).toMatchObject({
      edited: 1,
      samples: [{ rewrite: REWRITE, sent: `${REWRITE} Also the footer.` }],
    });
  });

  it("offers a repeated rule and adds it to AGENTS.md on request", async () => {
    savePromptMemory({
      ...EMPTY_PROMPT_MEMORY,
      projects: {
        [memoryProjectKey(CWD)]: {
          name: "shop",
          glossary: "",
          rules: [{ text: "Use pnpm", count: 2 }],
        },
      },
    });
    vi.mocked(addRuleToAgentsFile).mockResolvedValue({
      ok: true,
      path: `${CWD}/AGENTS.md`,
      created: false,
    });
    await render();
    await act(async () => hook.trigger());
    await finishRun(ok(["Use pnpm"]));
    expect(hook.ruleOffer).toEqual({ kind: "offer", rule: "Use pnpm" });

    await act(async () => {
      hook.addRule();
      await Promise.resolve();
    });
    expect(addRuleToAgentsFile).toHaveBeenCalledWith(CWD, "Use pnpm");
    expect(hook.ruleOffer).toEqual({
      kind: "done",
      message: "Added to AGENTS.md.",
    });
    expect(
      loadPromptMemory().projects[memoryProjectKey(CWD)]?.rules[0],
    ).toMatchObject({ state: "added" });
  });

  it("does nothing where it is not available", async () => {
    await render(false);
    expect(hook.visible).toBe(false);
    await act(async () => hook.trigger());
    expect(improvePrompt).not.toHaveBeenCalled();
  });

  it("does not run on a draft that is too short", async () => {
    await render();
    await type("fix it");
    expect(hook.blockReason).toBe("Write a few more words first");
    await act(async () => hook.trigger());
    expect(improvePrompt).not.toHaveBeenCalled();
  });
});
