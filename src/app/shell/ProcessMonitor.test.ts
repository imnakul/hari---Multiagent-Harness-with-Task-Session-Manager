// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProcessMonitor } from "./ProcessMonitor";
import { saveProcessMonitor } from "../../features/settings/model/settings";
import { newSession } from "../../features/sessions/model/session";
import {
  processIdleCandidate,
  retainExitedProcesses,
  type OwnedProcess,
} from "./processMonitor";
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
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  mocks.invoke.mockReset().mockResolvedValue([row]);
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
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent === "Stop")!
      .click(),
  );
  expect(onStop).toHaveBeenCalledWith("chat");
  expect(mocks.kill).not.toHaveBeenCalled();
});
it("shows loading, empty, unavailable, and recently exited states", async () => {
  let resolve: (rows: OwnedProcess[]) => void = () => undefined;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise<OwnedProcess[]>((done) => {
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
  await act(async () => resolve([]));
  mocks.invoke.mockResolvedValue([]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.textContent).toContain("No processes");
  mocks.invoke.mockRejectedValueOnce(new Error("access unavailable"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(container.textContent).toContain("Stats unavailable");
  expect(retainExitedProcesses([row], [])).toEqual([
    { ...row, status: "exited", cpu: null, memory: null },
  ]);
  expect(retainExitedProcesses(retainExitedProcesses([row], []), [])).toEqual(
    [],
  );
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
