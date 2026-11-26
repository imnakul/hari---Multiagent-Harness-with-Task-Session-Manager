// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickupDateField, formatDateLabel } from "./ClickupDateField";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(value: string, onChange = vi.fn(), disabled = false): ReturnType<typeof vi.fn> {
  act(() => {
    root.render(createElement(ClickupDateField, { label: "Due date", value, disabled, onChange }));
  });
  return onChange;
}

describe("ClickupDateField (L-395)", () => {
  it("formats the label and falls back to No date", () => {
    expect(formatDateLabel("2026-11-26")).toBe("26 Nov 2026");
    expect(formatDateLabel("")).toBe("");
    mount("");
    expect(container.textContent).toContain("No date");
  });

  it("shows the chosen date on the trigger", () => {
    mount("2026-11-26");
    expect(container.querySelector("button")?.textContent).toBe("26 Nov 2026");
  });

  it("opens the calendar without a time row and clears the date", () => {
    const onChange = mount("2026-11-26");
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.body.textContent).not.toMatch(/Time/);
    const clear = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Clear");
    expect(clear).toBeTruthy();
    act(() => clear?.click());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not open when disabled", () => {
    mount("", vi.fn(), true);
    expect(container.querySelector("button")?.disabled).toBe(true);
  });
});
