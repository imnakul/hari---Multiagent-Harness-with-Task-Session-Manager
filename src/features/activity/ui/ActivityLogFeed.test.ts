// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLogItems, type ActivityLog } from "../model/activity";
import { ActivityLogFeed, type LogFilter } from "./ActivityLogFeed";

const LOG: ActivityLog = {
  events: [
    {
      id: 1,
      ts: 1_000,
      kind: "prompt",
      sessionId: "s1",
      harness: "claude",
      model: "opus",
      cwd: "/home/me/shop",
      title: "Header",
      text: "fix the header spacing",
    },
  ],
  notes: [{ id: 7, ts: 2_000, firstEventId: 1, lastEventId: 1, body: "- Fixed the header" }],
};

let root: Root;
let container: HTMLDivElement;

function Feed({ log }: { log: ActivityLog }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  return createElement(ActivityLogFeed, {
    items: buildLogItems(log),
    agent: null,
    filter,
    onFilter: setFilter,
    onRetry: () => undefined,
  });
}

async function render(log: ActivityLog): Promise<void> {
  await act(async () => root.render(createElement(Feed, { log })));
}

function radio(name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (button) => button.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`no ${name} option`);
  return found;
}

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

describe("ActivityLogFeed filter", () => {
  it("shows only the day's notes when Notes is picked", async () => {
    await render(LOG);
    expect(container.textContent).toContain("fix the header spacing");
    expect(radio("Notes").textContent).toBe("Notes1");

    await act(async () => radio("Notes").click());
    expect(radio("Notes").getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Fixed the header");
    expect(container.textContent).not.toContain("fix the header spacing");
  });

  it("says when a day has activity but no notes", async () => {
    await render({ ...LOG, notes: [] });
    await act(async () => radio("Notes").click());
    expect(container.textContent).toContain("No agy notes on this day yet.");
  });

  it("scrolls a long log inside a fixed height", async () => {
    await render(LOG);
    const list = container.querySelector("ol");
    expect(list?.className).toContain("overflow-y-auto");
    expect(list?.getAttribute("tabindex")).toBe("0");
  });
});
