// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModel } from "../model/models";
import { modelOptionMarks } from "./ModelBadges";
import { SelectMenu } from "./SelectMenu";

const free: AgentModel = {
  id: "command-code:meta/muse-ember",
  harness: "command-code",
  name: "Muse Ember",
  badge: "free",
};
const locked: AgentModel = {
  id: "command-code:claude-sonnet-5-5",
  harness: "command-code",
  name: "Claude Sonnet 5.5",
  locked: { reason: "Needs Goat plan" },
};
const plain: AgentModel = {
  id: "command-code:default",
  harness: "command-code",
  name: "Account default",
};

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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("modelOptionMarks (L-263)", () => {
  it("adds nothing to a model without a badge or lock", () => {
    expect(modelOptionMarks(plain)).toEqual({});
  });

  it("disables a locked model and says why", () => {
    expect(modelOptionMarks(locked)).toMatchObject({
      disabled: true,
      title: "Locked: Needs Goat plan",
    });
    expect(modelOptionMarks(locked).icon).toBeTruthy();
  });

  it("keeps a free model pickable and marks it", () => {
    const marks = modelOptionMarks(free);
    expect(marks.disabled).toBeUndefined();
    expect(marks.title).toBe("Free");
    expect(marks.icon).toBeTruthy();
  });

  it("Settings dropdowns show Free and lock and refuse a locked model", async () => {
    const onChange = vi.fn();
    const options = [plain, free, locked].map((model) => {
      const { icon, ...marks } = modelOptionMarks(model);
      return {
        value: model.id,
        label: model.name,
        ...marks,
        ...(icon ? { trailing: icon } : {}),
      };
    });
    await act(async () =>
      root.render(
        createElement(SelectMenu, {
          label: "Command Code model",
          value: plain.id,
          options,
          onChange,
        }),
      ),
    );
    const trigger = container.querySelector("button");
    await act(async () => trigger?.click());
    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("Free");
    expect(rows[2]?.disabled).toBe(true);
    expect(rows[2]?.title).toBe("Locked: Needs Goat plan");
    expect(rows[2]?.querySelector("svg")).not.toBeNull();
    await act(async () => rows[2]?.click());
    expect(onChange).not.toHaveBeenCalled();
  });
});
