// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetTerminal,
  resetTerminalLifecycle,
  startTerminal,
} from "../model/terminalLifecycle";
import { TerminalView } from "../../terminal/ui/TerminalView";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async (): Promise<void> => undefined),
  writePty: vi.fn(async (): Promise<void> => undefined),
  resizePty: vi.fn(async (): Promise<void> => undefined),
  killPty: vi.fn(async (): Promise<void> => undefined),
  getPtyStatus: vi.fn(async (): Promise<{ foreground: string | null }> => ({
    foreground: null,
  })),
  exits: new Map<string, (code: number | null) => void>(),
  input: (_data: string): void => {},
  subscribePty: vi.fn(
    (
      id: string,
      _onData: unknown,
      onExit: (code: number | null) => void,
    ): (() => void) => {
      pty.exits.set(id, onExit);
      return () => {
        pty.exits.delete(id);
      };
    },
  ),
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
  writePty: (...args: unknown[]): Promise<void> => pty.writePty(...args),
  resizePty: (...args: unknown[]): Promise<void> => pty.resizePty(...args),
  killPty: (...args: unknown[]): Promise<void> => pty.killPty(...args),
  getPtyStatus: (...args: unknown[]): Promise<{ foreground: string | null }> =>
    pty.getPtyStatus(...args),
  subscribePty: (
    ...args: [string, unknown, (code: number | null) => void]
  ): (() => void) => pty.subscribePty(...args),
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
    onData(handler: (data: string) => void): FakeDisposable {
      pty.input = handler;
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

let container: HTMLDivElement;
let root: Root;

function deferredSpawn(): {
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  pty.spawnPty.mockReturnValueOnce(
    new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
  );
  return { resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  resetTerminalLifecycle();
  vi.clearAllMocks();
  pty.exits.clear();
  pty.input = () => {};
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

function renderView(id: string, cwd = "/repo", active = false): void {
  act(() => {
    root.render(createElement(TerminalView, { id, cwd, active }));
  });
}

function startButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Start Terminal"]',
  );
}

async function flush(): Promise<void> {
  await act(async () => {});
}

describe("TerminalView lazy startup", () => {
  it("restores visible terminals dormant with zero spawns", async () => {
    // One root stands in for a project dock, the other for a workspace pane.
    act(() => {
      root.render(
        createElement(
          "div",
          null,
          createElement(TerminalView, { id: "saved-1", cwd: "/repo" }),
          createElement(TerminalView, { id: "saved-2", cwd: "/repo" }),
        ),
      );
    });
    const other = document.createElement("div");
    document.body.append(other);
    const otherRoot = createRoot(other);
    try {
      act(() => {
        otherRoot.render(createElement(TerminalView, { id: "saved-3", cwd: "/repo" }));
      });
      await flush();
      expect(pty.spawnPty).not.toHaveBeenCalled();
      expect(
        container.querySelectorAll('button[aria-label^="Start Terminal"]'),
      ).toHaveLength(2);
      expect(other.querySelector('button[aria-label^="Start Terminal"]')).not.toBeNull();
    } finally {
      act(() => otherRoot.unmount());
      other.remove();
    }
  });

  it("starting one dormant terminal spawns exactly that terminal", async () => {
    renderView("dock-1");
    const button = startButton();
    expect(button).not.toBeNull();
    act(() => button?.click());
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.spawnPty).toHaveBeenCalledWith(
      "dock-1",
      "/repo",
      expect.any(Number),
      expect.any(Number),
    );
    expect(startButton()).toBeNull();
  });

  it("repeated activation while startup is pending does not duplicate spawn", async () => {
    renderView("pending-1");
    const gate = deferredSpawn();
    act(() => startButton()?.click());
    // A remount plus repeated intent (select spam, StrictMode-style) shares it.
    act(() => startTerminal("pending-1"));
    renderView("pending-1");
    act(() => startTerminal("pending-1"));
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
  });

  it("starts a created terminal on mount without extra spawns", async () => {
    act(() => startTerminal("new-1"));
    renderView("new-1");
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    // Hiding / switching away keeps the shell: rerenders never respawn.
    renderView("new-1", "/repo", true);
    renderView("new-1", "/repo", false);
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  });

  it("reattaches without respawning after a remount", async () => {
    act(() => startTerminal("move-1"));
    renderView("move-1");
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    const nextHost = document.createElement("div");
    document.body.append(nextHost);
    const nextRoot = createRoot(nextHost);
    try {
      act(() => {
        nextRoot.render(
          createElement(TerminalView, { id: "move-1", cwd: "/repo" }),
        );
      });
      await flush();
      expect(pty.spawnPty).toHaveBeenCalledTimes(1);
      expect(pty.killPty).not.toHaveBeenCalled();
    } finally {
      act(() => nextRoot.unmount());
      nextHost.remove();
    }
  });

  it("cleans up the child when closed during a pending startup", async () => {
    renderView("closing-1");
    const gate = deferredSpawn();
    act(() => startButton()?.click());
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    act(() => {
      forgetTerminal("closing-1");
      root.unmount();
    });
    gate.resolve();
    await flush();
    expect(pty.killPty).toHaveBeenCalledWith("closing-1");
  });

  it("failed spawn offers a retry without a render retry loop", async () => {
    renderView("failing-1");
    const gate = deferredSpawn();
    act(() => startButton()?.click());
    gate.reject(new Error("spawn blew up"));
    await flush();
    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry starting terminal"]',
    );
    expect(retry).not.toBeNull();
    // Remounts must not spawn behind the failure latch.
    renderView("failing-1");
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    pty.spawnPty.mockResolvedValue(undefined);
    act(() => retry?.click());
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
  });

  it("writes input typed during a successful retry after the retry resolves", async () => {
    renderView("retry-input-1");
    const first = deferredSpawn();
    act(() => startButton()?.click());
    first.reject(new Error("first spawn failed"));
    await flush();

    const retry = deferredSpawn();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Retry starting terminal"]')
        ?.click(),
    );
    act(() => pty.input("hello"));
    expect(pty.writePty).not.toHaveBeenCalled();
    retry.resolve();
    await flush();
    expect(pty.writePty).toHaveBeenCalledWith("retry-input-1", "hello");
  });

  it("kills a shell when closed during a pending retry", async () => {
    renderView("retry-close-1");
    const first = deferredSpawn();
    act(() => startButton()?.click());
    first.reject(new Error("first spawn failed"));
    await flush();

    const retry = deferredSpawn();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Retry starting terminal"]')
        ?.click(),
    );
    act(() => {
      forgetTerminal("retry-close-1");
      root.unmount();
    });
    retry.resolve();
    await flush();
    expect(pty.killPty).toHaveBeenCalledWith("retry-close-1");
  });

  it("restarts an exited terminal through an explicit action", async () => {
    act(() => startTerminal("exited-1"));
    renderView("exited-1");
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    act(() => pty.exits.get("exited-1")?.(0));
    const restart = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Restart terminal"]',
    );
    expect(restart).not.toBeNull();
    act(() => restart?.click());
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
  });

  it("preserves Restart state after an exited terminal remount", async () => {
    act(() => startTerminal("exited-remount-1"));
    renderView("exited-remount-1");
    await flush();
    act(() => pty.exits.get("exited-remount-1")?.(17));
    act(() => root.unmount());

    const nextHost = document.createElement("div");
    document.body.append(nextHost);
    const nextRoot = createRoot(nextHost);
    try {
      act(() => {
        nextRoot.render(
          createElement(TerminalView, { id: "exited-remount-1", cwd: "/repo" }),
        );
      });
      await flush();
      expect(nextHost.querySelector('[role="status"]')?.textContent).toContain("17");
      expect(nextHost.querySelector('button[aria-label="Restart terminal"]')).not.toBeNull();
      expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    } finally {
      act(() => nextRoot.unmount());
      nextHost.remove();
    }
  });

  it("survives a StrictMode remount with a single spawn", async () => {
    act(() => startTerminal("strict-1"));
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, { id: "strict-1", cwd: "/repo" }),
        ),
      );
    });
    await flush();
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  });
});
