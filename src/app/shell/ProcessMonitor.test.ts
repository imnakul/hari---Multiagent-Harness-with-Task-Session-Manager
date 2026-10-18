// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProcessMonitor } from "./ProcessMonitor";
import { saveProcessMonitor } from "../../features/settings/model/settings";
import { newSession } from "../../features/sessions/model/session";
import {
  processIdleCandidate,
  processLabel,
  retainExitedProcesses,
  type AppProcess,
  type OwnedProcess,
  type ProcessMonitorStats,
} from "./processMonitorModel";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  kill: vi.fn(),
  parked: vi.fn(),
  safe: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("../../platform/tauri/pty", () => ({ killPty: mocks.kill }));
vi.mock("../../integrations/harness/core/child", () => ({
  killChild: mocks.kill,
}));
vi.mock(
  "../../integrations/harness/providers/claude/claudeInteractive",
  () => ({
    interactiveClaudeIdleSafe: mocks.safe,
    parkInteractiveClaude: mocks.parked,
  }),
);
vi.mock("../../shared/ui/Popover", () => ({
  Popover: ({ children }: { children: import("react").ReactNode }) => children,
}));
let root: Root;
let container: HTMLDivElement;
const session = {
  ...newSession("claude", "/repo", "claude:sonnet-5"),
  id: "chat",
  title: "My chat",
};
const row: OwnedProcess = {
  root: {
    id: "chat",
    pid: 42,
    cwd: "/repo",
    kind: "structured",
    idleMs: 400000,
  },
  cpu: 2.5,
  memory: 10485760,
  processes: 1,
  status: "live",
  children: [
    {
      pid: 42,
      parent: 7,
      name: "node.exe",
      depth: 0,
      cpu: 2.5,
      memory: 10485760,
    },
  ],
};
const app: AppProcess = {
  pid: 7,
  cpu: 1.5,
  memory: 104857600,
  processes: 4,
  unreadable: 0,
  children: [
    {
      pid: 7,
      parent: 1,
      name: "monocode.exe",
      depth: 0,
      cpu: 1.0,
      memory: 62914560,
    },
    {
      pid: 8,
      parent: 7,
      name: "msedgewebview2.exe",
      depth: 1,
      cpu: 0.5,
      memory: 41943040,
    },
    {
      pid: 9,
      parent: 8,
      name: "msedgewebview2.exe",
      depth: 2,
      cpu: null,
      memory: null,
    },
  ],
};
const stats = (
  owned: OwnedProcess[],
  appUsage: AppProcess = app,
): ProcessMonitorStats => ({ app: appUsage, owned });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  mocks.invoke.mockReset().mockResolvedValue(stats([row]));
  mocks.kill.mockReset();
  mocks.parked.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("performs no IPC or timers while off and stops sampling immediately when disabled", async () => {
  const onStop = vi.fn();
  await act(async () =>
    root.render(createElement(ProcessMonitor, { sessions: [session], onStop })),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
  await act(async () => saveProcessMonitor(true));
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9999);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  await act(async () => saveProcessMonitor(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
it("refreshes an open popover every three seconds, groups titles, and uses existing Stop", async () => {
  saveProcessMonitor(true);
  const onStop = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(createElement(ProcessMonitor, { sessions: [session], onStop })),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Process monitor"]')!
      .click(),
  );
  expect(container.textContent).toContain("/repo");
  expect(container.textContent).toContain("My chat");
  const before = mocks.invoke.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(before + 1);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Stop My chat"]')!
      .click(),
  );
  expect(onStop).toHaveBeenCalledWith("chat");
  expect(mocks.kill).not.toHaveBeenCalled();
});
it("shows loading, empty, unavailable, and recently exited states", async () => {
  let resolve: (value: ProcessMonitorStats) => void = () => undefined;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise<ProcessMonitorStats>((done) => {
        resolve = done;
      }),
  );
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [], onStop: vi.fn() }),
    ),
  );
  expect(container.textContent).toContain("loading");
  await act(async () => resolve(stats([])));
  mocks.invoke.mockResolvedValue(stats([]));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.textContent).toContain("No chats or terminals running");
  mocks.invoke.mockRejectedValueOnce(new Error("access unavailable"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.textContent).toContain("Stats unavailable");
  expect(retainExitedProcesses([row], [])).toEqual([
    { ...row, status: "exited", cpu: null, memory: null, children: [] },
  ]);
  expect(retainExitedProcesses(retainExitedProcesses([row], []), [])).toEqual(
    [],
  );
});
it("shows the app row without Stop and adds it to the chip total", async () => {
  saveProcessMonitor(true);
  const onStop = vi.fn();
  await act(async () =>
    root.render(createElement(ProcessMonitor, { sessions: [session], onStop })),
  );
  const chip = container.querySelector<HTMLButtonElement>(
    '[aria-label="Process monitor"]',
  )!;
  // 1.5% + 2.5% and 100 MiB + 10 MiB.
  expect(chip.textContent).toBe("CPU 4.0% · 110 MiB");
  await act(async () => chip.click());
  expect(container.textContent).toContain("MonoCode app");
  expect(container.textContent).toContain("App and web view · 4 processes");
  const stops = container.querySelectorAll('button[aria-label^="Stop "]');
  // Only the chat row is stoppable.
  expect(stops).toHaveLength(1);
});
it("shows GPU per row and in the chip once every part has a reading", async () => {
  mocks.invoke.mockResolvedValue(
    stats([{ ...row, gpu: 0 }], { ...app, gpu: 3.25 }),
  );
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [session], onStop: vi.fn() }),
    ),
  );
  const chip = container.querySelector<HTMLButtonElement>(
    '[aria-label="Process monitor"]',
  )!;
  expect(chip.textContent).toBe("CPU 4.0% · 110 MiB · GPU 3.3%");
  await act(async () => chip.click());
  expect(container.textContent).toContain("GPU 3.3%");
  expect(container.textContent).toContain("GPU 0.0%");
});
it("totals only readable parts when a chat cannot be read", async () => {
  mocks.invoke.mockResolvedValue(
    stats(
      [{ ...row, cpu: null, memory: null, gpu: 0, status: "unavailable" }],
      { ...app, gpu: 0.7 },
    ),
  );
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [session], onStop: vi.fn() }),
    ),
  );
  const chip = container.querySelector<HTMLButtonElement>(
    '[aria-label="Process monitor"]',
  )!;
  expect(chip.textContent).toBe("CPU 1.5% · 100 MiB · GPU 0.7%");
  expect(chip.title).toContain("totals count only the readable ones");
});
it("keeps Stop as an icon that appears only on row hover or keyboard focus", async () => {
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [session], onStop: vi.fn() }),
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Process monitor"]')!
      .click(),
  );
  const stop = container.querySelector<HTMLButtonElement>(
    '[aria-label="Stop My chat"]',
  )!;
  expect(stop.textContent).toBe("");
  expect(stop.querySelector("svg")).not.toBeNull();
  expect(stop.className).toContain("opacity-0");
  expect(stop.className).toContain("group-hover:opacity-100");
  expect(stop.className).toContain("focus-visible:opacity-100");
  expect(stop.closest(".group")).not.toBeNull();
});
it("keeps a partial app reading and waits for the first CPU delta", async () => {
  mocks.invoke.mockResolvedValue(
    stats([], { ...app, cpu: null, unreadable: 2 }),
  );
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [], onStop: vi.fn() }),
    ),
  );
  const chip = container.querySelector<HTMLButtonElement>(
    '[aria-label="Process monitor"]',
  )!;
  expect(chip.textContent).toBe("CPU … · 100 MiB");
  await act(async () => chip.click());
  expect(container.textContent).toContain("2 not readable");
  expect(container.textContent).toContain("Measuring CPU…");
  expect(container.textContent).toContain("No chats or terminals running");
});
it("bulk idle eligibility rejects busy, questioned, background and child-owning chats", () => {
  expect(processIdleCandidate(row, session)).toBe(true);
  expect(processIdleCandidate(row, { ...session, busy: true })).toBe(false);
  expect(
    processIdleCandidate(row, { ...session, backgroundTasks: ["work"] }),
  ).toBe(false);
  expect(processIdleCandidate({ ...row, processes: 2 }, session)).toBe(false);
  expect(
    processIdleCandidate(
      { ...row, root: { ...row.root, idleMs: 1000 } },
      session,
    ),
  ).toBe(false);
  expect(processIdleCandidate(row)).toBe(false);
});
it("expands app and chat rows into read-only process lists that survive refreshes", async () => {
  saveProcessMonitor(true);
  await act(async () =>
    root.render(
      createElement(ProcessMonitor, { sessions: [session], onStop: vi.fn() }),
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Process monitor"]')!
      .click(),
  );
  const show = (label: string): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>(
      `[aria-label="Show processes for ${label}"]`,
    )!;
  expect(show("MonoCode app").getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("ul")).toBeNull();
  await act(async () => show("MonoCode app").click());
  await act(async () => show("My chat").click());
  const appList = container.querySelector(
    '[aria-label="Processes for MonoCode app"]',
  )!;
  expect(
    [...appList.querySelectorAll("li")].map((li) => li.textContent),
  ).toEqual([
    "monocode.exePID 7CPU 1.0%RAM 60 MiB—GPU not measured",
    "Web view (main)PID 8CPU 0.5%RAM 40 MiB—GPU not measured",
    "Web view helperPID 9—CPU unavailable—Memory unavailable—GPU not measured",
  ]);
  expect(
    container.querySelector('[aria-label="Processes for My chat"]')!
      .textContent,
  ).toContain("node.exePID 42");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.querySelectorAll("ul")).toHaveLength(2);
  // Process lists add no Stop buttons.
  expect(
    container.querySelectorAll('button[aria-label^="Stop "]'),
  ).toHaveLength(1);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Hide processes for MonoCode app"]',
      )!
      .click(),
  );
  expect(container.querySelectorAll("ul")).toHaveLength(1);
  expect(
    processLabel(
      { pid: 3, parent: 7, name: "", depth: 1, cpu: null, memory: 1 },
      7,
    ),
  ).toBe("Unnamed process");
});
