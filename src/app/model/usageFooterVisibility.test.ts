import { expect, it } from "vitest";
import { usageFooterVisible } from "./usageFooterVisibility";

it.each([false, true])("keeps usage, process and terminal controls in both managers (inset=%s)", (inset) => {
  expect(usageFooterVisible(inset, "tasks")).toBe(true);
  expect(usageFooterVisible(inset, "kanban")).toBe(true);
  expect(usageFooterVisible(inset, "workspace")).toBe(true);
  expect(usageFooterVisible(inset, "settings")).toBe(false);
});

it.each(["search", "inbox", "notes", "automations", "mono"] as const)(
  "uses the shared outer footer for inset %s, while keeping classic behavior",
  (view) => {
    expect(usageFooterVisible(false, view)).toBe(false);
    expect(usageFooterVisible(true, view)).toBe(true);
  },
);
