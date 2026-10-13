// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DebugInspector } from "./DebugInspector";
import { LocalEvidencePanel } from "./LocalEvidencePanel";
import { clearTrace, setCapture } from "../model/trace";
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearTrace();
  setCapture(true);
  invoke.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearTrace();
  setCapture(true);
  vi.unstubAllGlobals();
});
const render = async (element: ReactNode): Promise<void> => {
  await act(async () => root.render(element));
};
const click = async (label: string): Promise<void> => {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
};
it("opening, switching views, pause and clear perform no provider or file IPC", async () => {
  await render(createElement(DebugInspector, { sessions: [] }));
  expect(container.textContent).toContain("No activity captured");
  for (const view of ["Timeline", "Local evidence", "Quota", "Overview"])
    await click(view);
  await click("Pause capture");
  await click("Clear buffer");
  expect(invoke).not.toHaveBeenCalled();
});
it("local evidence shows loading and a safe failure only after an explicit read", async () => {
  let fail: ((error: Error) => void) | undefined;
  invoke.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await render(
    createElement(LocalEvidencePanel, {
      sessionId: "chat",
      sessions: [],
      onEvidence: () => undefined,
    }),
  );
  expect(invoke).not.toHaveBeenCalled();
  await click("Read local metadata");
  expect(container.textContent).toContain("Reading a bounded snapshot");
  await act(async () => fail?.(new Error("private filesystem path")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not read scoped local metadata",
  );
  expect(container.textContent).not.toContain("private filesystem path");
});
it("selection changes ignore late local evidence and never save session state", async () => {
  let finish: ((value: unknown) => void) | undefined;
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onEvidence = vi.fn();
  await render(
    createElement(LocalEvidencePanel, {
      sessionId: "chat-1",
      sessions: [],
      onEvidence,
    }),
  );
  await click("Read local metadata");
  await render(
    createElement(LocalEvidencePanel, {
      sessionId: "chat-2",
      sessions: [],
      onEvidence,
    }),
  );
  await act(async () =>
    finish?.({
      sessionId: "chat-1",
      provider: "claude",
      nativeId: "native-1",
      accountId: "default",
    }),
  );
  expect(invoke.mock.calls.map((row) => row[0])).toEqual([
    "debug_inspector_session_identity",
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(onEvidence.mock.calls.every((row) => row[0] === undefined)).toBe(true);
});
