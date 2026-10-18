// @vitest-environment happy-dom
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  forgetTerminal,
  resetTerminalLifecycle,
  startTerminal,
} from "../../sessions/model/terminalLifecycle";
import type { WebLinksAddon } from "@xterm/addon-web-links";
import type { ILink, ITerminalOptions } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const pty = vi.hoisted(() => ({
  PTY_SUPPORTED: true,
  PTY_UNSUPPORTED_MESSAGE: "Terminals are supported on macOS and Linux.",
  markUnsupportedNotified: vi.fn(() => true),
  spawnPty: vi.fn(async () => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn(() => () => {}),
  ptyReplayFrom: vi.fn(async () => ({
    start: 0,
    total: 0,
    data: new Uint8Array(),
  })),
  getPtyStatus: vi.fn(async () => ({ foreground: null })),
}));
vi.mock("../../../platform/tauri/pty", () => pty);
const xterm = vi.hoisted(() => ({
  options: [] as ITerminalOptions[],
  loadAddon: vi.fn(),
}));
vi.mock("../model/terminalLayout", () => ({
  fitTerminal: () => null,
  applyTerminalChrome: () => {},
  resetGridStretch: () => {},
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor(options: ITerminalOptions) {
      xterm.options.push(options);
    }
    cols = 80;
    rows = 24;
    options = {};
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    /** Accept addon registration without activating addons in the terminal mock. */
    loadAddon = xterm.loadAddon;
    focus() {}
    dispose() {}
    writeln() {}
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
  },
}));
import { TerminalView } from "./TerminalView";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  resetTerminalLifecycle();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

function setup() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

it("detects plain HTTP(S) URLs and opens them through the addon callback", async () => {
  const { host, root } = setup();
  startTerminal("plain-links");
  const { Terminal } =
    await vi.importActual<typeof import("@xterm/xterm")>("@xterm/xterm");
  const terminal = new Terminal({ cols: 200, rows: 1 });
  const registerLinkProvider = vi.spyOn(terminal, "registerLinkProvider");
  let addon: WebLinksAddon | undefined;
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "plain-links",
          cwd: "/tmp",
          active: true,
        }),
      );
    });
    expect(xterm.loadAddon).toHaveBeenCalledTimes(1);
    addon = xterm.loadAddon.mock.calls[0][0] as WebLinksAddon;
    addon.activate(terminal);
    const urls = [
      "http://example.com",
      "https://example.com/path",
      "HTTPS://example.com",
    ];
    const blocked = [
      "file:///tmp/test",
      "javascript:alert(1)",
      "mailto:test@example.com",
      "ftp://example.com",
    ];
    await new Promise<void>((resolve) => {
      terminal.write([...urls, ...blocked].join(" "), resolve);
    });
    const provider = registerLinkProvider.mock.calls[0][0];
    const links = await new Promise<ILink[] | undefined>((resolve) => {
      provider.provideLinks(1, resolve);
    });
    expect(links?.map((link) => link.text)).toEqual(urls);
    for (const link of links!) {
      link.activate(new MouseEvent("click"), link.text);
    }
    expect(vi.mocked(openUrl).mock.calls).toEqual(urls.map((url) => [url]));
    vi.mocked(openUrl).mockClear();
    // Exercise the callback's guard even if a provider dispatches another scheme.
    for (const uri of blocked) {
      links![0].activate(new MouseEvent("click"), uri);
    }
    expect(openUrl).not.toHaveBeenCalled();
  } finally {
    addon?.dispose();
    terminal.dispose();
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("opens only HTTP(S) URLs dispatched by the OSC 8 link handler", async () => {
  const { host, root } = setup();
  startTerminal("osc-links");
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "osc-links",
          cwd: "/tmp",
          active: true,
        }),
      );
    });
    const handler = xterm.options[0].linkHandler!;
    const urls = [
      "http://example.com",
      "https://example.com/path",
      "HTTPS://example.com",
    ];
    for (const uri of urls) {
      handler.activate(new MouseEvent("click"), uri, undefined);
    }
    expect(vi.mocked(openUrl).mock.calls).toEqual(urls.map((url) => [url]));
    vi.mocked(openUrl).mockClear();
    for (const uri of [
      "file:///tmp/test",
      "javascript:alert(1)",
      "mailto:test@example.com",
      "ftp://example.com",
    ]) {
      handler.activate(new MouseEvent("click"), uri, undefined);
    }
    expect(openUrl).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("does not let StrictMode cleanup kill the replacement shell", async () => {
  const { host, root } = setup();
  startTerminal("same-id");
  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, {
            id: "same-id",
            cwd: "/tmp",
            active: true,
          }),
        ),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.subscribePty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      forgetTerminal("same-id");
      root.unmount();
    });
    host.remove();
  }
  expect(pty.killPty).toHaveBeenCalledTimes(1);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  xterm.options.length = 0;
  resetTerminalLifecycle();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("waits for same-id teardown before subscribing and spawning again", async () => {
  const operations: string[] = [];
  let finishKill!: () => void;
  pty.subscribePty.mockImplementation(() => {
    operations.push("subscribe");
    return () => operations.push("unsubscribe");
  });
  pty.spawnPty.mockImplementation(async () => {
    operations.push("spawn");
  });
  pty.killPty.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        operations.push("kill");
        finishKill = resolve;
      }),
  );

  startTerminal("same-id");
  await act(async () => {
    root.render(
      createElement(TerminalView, { id: "same-id", cwd: "/tmp", active: true }),
    );
  });
  expect(operations).toEqual(["subscribe", "spawn"]);

  await act(async () => {
    forgetTerminal("same-id");
    root.render(null);
  });
  expect(operations).toEqual(["subscribe", "spawn", "unsubscribe", "kill"]);

  await act(async () => {
    startTerminal("same-id");
    root.render(
      createElement(TerminalView, { id: "same-id", cwd: "/tmp", active: true }),
    );
  });
  expect(operations).toEqual(["subscribe", "spawn", "unsubscribe", "kill"]);

  await act(async () => {
    finishKill();
    await Promise.resolve();
  });
  expect(operations).toEqual([
    "subscribe",
    "spawn",
    "unsubscribe",
    "kill",
    "subscribe",
    "spawn",
  ]);
});

it("reopens after a pending close without treating the old spawn as live", async () => {
  const operations: string[] = [];
  let finishOldSpawn!: () => void;
  let finishKill!: () => void;
  pty.subscribePty.mockImplementation(() => {
    operations.push("subscribe");
    return () => operations.push("unsubscribe");
  });
  pty.spawnPty
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          operations.push("spawn old");
          finishOldSpawn = resolve;
        }),
    )
    .mockImplementationOnce(async () => {
      operations.push("spawn replacement");
    });
  pty.killPty.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        operations.push("kill old");
        finishKill = resolve;
      }),
  );

  startTerminal("pending-close");
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "pending-close",
        cwd: "/tmp",
        active: true,
      }),
    );
  });
  expect(operations).toEqual(["subscribe", "spawn old"]);

  await act(async () => {
    forgetTerminal("pending-close");
    root.render(null);
  });
  startTerminal("pending-close");
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "pending-close",
        cwd: "/tmp",
        active: true,
      }),
    );
  });
  expect(operations).toEqual(["subscribe", "spawn old", "unsubscribe"]);

  await act(async () => {
    finishOldSpawn();
    await Promise.resolve();
  });
  expect(operations).toEqual([
    "subscribe",
    "spawn old",
    "unsubscribe",
    "kill old",
  ]);

  await act(async () => {
    finishKill();
    await Promise.resolve();
  });
  expect(operations).toEqual([
    "subscribe",
    "spawn old",
    "unsubscribe",
    "kill old",
    "subscribe",
    "spawn replacement",
  ]);
});

it("does not block a different terminal id behind teardown", async () => {
  let finishKill!: () => void;
  pty.killPty.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishKill = resolve;
      }),
  );
  startTerminal("first");
  await act(async () => {
    root.render(createElement(TerminalView, { id: "first", cwd: "/tmp" }));
  });
  await act(async () => {
    forgetTerminal("first");
    root.render(null);
  });
  expect(pty.killPty).toHaveBeenCalledWith("first");

  startTerminal("second");
  await act(async () => {
    root.render(createElement(TerminalView, { id: "second", cwd: "/tmp" }));
  });
  expect(pty.spawnPty).toHaveBeenCalledTimes(2);
  expect(pty.spawnPty).toHaveBeenLastCalledWith("second", "/tmp", 80, 24);
  finishKill();
});

it("uses the terminal-specific font stack", async () => {
  startTerminal("font");
  const stack = '"Test Nerd Font", monospace';
  document.documentElement.style.setProperty("--font-terminal", stack);
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, { id: "font", cwd: "/tmp", active: true }),
      );
    });
    expect(xterm.options[0]?.fontFamily).toBe(stack);
  } finally {
    document.documentElement.style.removeProperty("--font-terminal");
  }
});
