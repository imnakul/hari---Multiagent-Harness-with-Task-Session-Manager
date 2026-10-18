// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTerminalFile } from "../../workspace/model/layout";
import { createProjectTerminal } from "../../projects/model/projectTerminal";
import {
  resetTerminalLifecycle,
  startTerminal,
} from "../model/terminalLifecycle";
import { FilePane } from "../../files/ui/FilePane";
import { ProjectTerminalDock } from "../../terminal/ui/ProjectTerminalDock";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async (): Promise<void> => undefined),
  killPty: vi.fn(async (): Promise<void> => undefined),
  getPtyStatus: vi.fn(async (): Promise<{ foreground: string | null }> => ({
    foreground: null,
  })),
  subscribePty: vi.fn((): (() => void) => () => undefined),
  ptyReplayFrom: vi.fn(
    async (): Promise<{ start: number; total: number; data: Uint8Array }> => ({
      start: 0,
      total: 0,
      data: new Uint8Array(),
    }),
  ),
}));

vi.mock("../../../platform/tauri/pty", () => ({
  PTY_SUPPORTED: true,
  PTY_UNSUPPORTED_MESSAGE: "Terminals are supported on macOS and Linux.",
  markUnsupportedNotified: (): boolean => true,
  spawnPty: (...args: unknown[]): Promise<void> => pty.spawnPty(...args),
  writePty: vi.fn(async (): Promise<void> => undefined),
  resizePty: vi.fn(async (): Promise<void> => undefined),
  killPty: (...args: unknown[]): Promise<void> => pty.killPty(...args),
  getPtyStatus: (...args: unknown[]): Promise<{ foreground: string | null }> =>
    pty.getPtyStatus(...args),
  subscribePty: (...args: [string, unknown, unknown]): (() => void) =>
    pty.subscribePty(...args),
  ptyReplayFrom: (...args: unknown[]) => pty.ptyReplayFrom(...args),
}));

vi.mock("@xterm/xterm", () => {
  class FakeDisposable {
    dispose(): void {}
  }
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: undefined;
    options: Record<string, unknown> = {};
    parser = { registerOscHandler: (): FakeDisposable => new FakeDisposable() };
    buffer = {
      active: { type: "normal" },
      onBufferChange: (): FakeDisposable => new FakeDisposable(),
    };
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    writeln(): void {}
    paste(): void {}
    getSelection(): string {
      return "";
    }
    hasSelection(): boolean {
      return false;
    }
    focus(): void {}
    dispose(): void {}
    clear(): void {}
    attachCustomKeyEventHandler(): void {}
    attachCustomWheelEventHandler(): void {}
    onData(): FakeDisposable {
      return new FakeDisposable();
    }
    onRender(): FakeDisposable {
      return new FakeDisposable();
    }
  }
  return { Terminal: FakeTerminal };
});

vi.mock("../../terminal/model/terminalLayout", () => ({
  applyTerminalChrome: (): void => undefined,
  fitTerminal: (): null => null,
  resetGridStretch: (): void => undefined,
}));

vi.mock("../../settings/model/appearance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../settings/model/appearance")>();
  return { ...actual, isLightScheme: (): boolean => false };
});

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const noop = (): void => undefined;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  resetTerminalLifecycle();
  vi.clearAllMocks();
  pty.spawnPty.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  // Upstream defers the terminal surface import until it is first mounted.
  // Wait for that module before asserting the local dormant/start behavior.
  await act(async () => {
    await import("../../terminal/ui/TerminalView");
  });
}

function paneProps(fileId: string, cwd = "/repo") {
  const file = { ...newTerminalFile(cwd, "term"), id: fileId };
  return {
    pane: { id: "pane-1", files: [file], activeFileId: file.id },
    focused: true,
    dirtyFileIds: new Set<string>(),
    fileErrorCounts: new Map<string, number>(),
    sessions: [],
    onFocus: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onCloseOtherFiles: noop,
    onDirtyChange: noop,
    onErrorCountChange: noop,
    onReorderFiles: noop,
    onOpenFile: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
  };
}

describe("terminal surface parity", () => {
  it("workspace pane terminals restore dormant with zero spawns", async () => {
    act(() => {
      root.render(createElement(FilePane, paneProps("pane-term-1")));
    });
    await flush();
    expect(pty.spawnPty).not.toHaveBeenCalled();
    expect(
      container.querySelector('button[aria-label^="Start Terminal"]'),
    ).not.toBeNull();
  });

  it("workspace pane terminals start on explicit intent only", async () => {
    act(() => {
      root.render(createElement(FilePane, paneProps("pane-term-2")));
    });
    await flush();
    expect(pty.spawnPty).not.toHaveBeenCalled();
    // Mirrors App.onSelectFileSurface: selecting the dormant file starts it.
    act(() => startTerminal("pane-term-2"));
    act(() => {
      root.render(createElement(FilePane, paneProps("pane-term-2")));
    });
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.spawnPty).toHaveBeenCalledWith(
      "pane-term-2",
      "/repo",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("project dock terminals restore dormant and start one at a time", async () => {
    const first = { ...newTerminalFile("/repo", "one"), id: "dock-term-1" };
    const second = { ...newTerminalFile("/repo", "two"), id: "dock-term-2" };
    const dock = {
      ...createProjectTerminal("/repo", first),
      pane: {
        id: "dock-pane",
        files: [first, second],
        activeFileId: first.id,
      },
    };
    const props = {
      dock,
      focused: true,
      onFocus: noop,
      onHide: noop,
      onSideChange: noop,
      onSizePaint: noop,
      onSizeCommit: noop,
      onAddTerminal: noop,
      onSelectTerminal: noop,
      onCloseTerminal: noop,
      onCloseOtherTerminals: noop,
      onReorderTerminals: noop,
    };
    act(() => {
      root.render(createElement(ProjectTerminalDock, props));
    });
    await flush();
    // Both files mount (hidden ones stay mounted) but neither spawns.
    expect(pty.spawnPty).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('button[aria-label^="Start Terminal"]'),
    ).toHaveLength(2);
    // Dormant entries carry no live-process status.
    expect(container.querySelector('[role="status"]')).toBeNull();
    // Selecting the second tab starts only that terminal (no fan-out).
    act(() => startTerminal("dock-term-2"));
    act(() => {
      root.render(
        createElement(ProjectTerminalDock, {
          ...props,
          dock: {
            ...dock,
            pane: { ...dock.pane, activeFileId: second.id },
          },
        }),
      );
    });
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.spawnPty).toHaveBeenCalledWith(
      "dock-term-2",
      "/repo",
      expect.any(Number),
      expect.any(Number),
    );
    expect(
      container.querySelectorAll('button[aria-label^="Start Terminal"]'),
    ).toHaveLength(1);
  });
});
