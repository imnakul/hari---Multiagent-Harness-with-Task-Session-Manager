// @vitest-environment happy-dom
import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveGpuTerminalRendering } from "../../settings/model/settings";
import {
  activeGpuTerminalCount,
  attachGpuRenderer,
  MAX_GPU_TERMINALS,
} from "./gpuRenderer";

type FakeAddon = {
  disposed: boolean;
  loseContext: () => void;
};

const addons: FakeAddon[] = [];
let failActivation = false;

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    disposed = false;
    private lossListener: (() => void) | null = null;
    constructor() {
      addons.push(this);
    }
    onContextLoss(listener: () => void) {
      this.lossListener = listener;
      return { dispose: () => undefined };
    }
    loseContext() {
      this.lossListener?.();
    }
    activate() {
      if (failActivation) throw new Error("WebGL2 unavailable");
    }
    dispose() {
      this.disposed = true;
    }
  },
}));

function fakeTerminal(): Terminal {
  const term = {
    loadAddon: (addon: { activate: (terminal: unknown) => void }) =>
      addon.activate(term),
  };
  // Only loadAddon is used by the renderer helper.
  return term as unknown as Terminal;
}

function host(width = 640, height = 320): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: width });
  Object.defineProperty(element, "clientHeight", { value: height });
  return element;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  addons.length = 0;
  failActivation = false;
  localStorage.clear();
});

function attach(element = host()): () => void {
  const detach = attachGpuRenderer(fakeTerminal(), element);
  cleanups.push(detach);
  return detach;
}

describe("attachGpuRenderer", () => {
  it("keeps the normal renderer until the Experimentation setting is on", async () => {
    attach();
    await settle();
    expect(addons).toHaveLength(0);

    saveGpuTerminalRendering(true);
    await settle();
    expect(addons).toHaveLength(1);
    expect(activeGpuTerminalCount()).toBe(1);

    saveGpuTerminalRendering(false);
    await settle();
    expect(addons[0]?.disposed).toBe(true);
    expect(activeGpuTerminalCount()).toBe(0);
  });

  it("frees the GPU context when the terminal closes", async () => {
    saveGpuTerminalRendering(true);
    const detach = attach();
    await settle();
    detach();
    expect(addons[0]?.disposed).toBe(true);
    expect(activeGpuTerminalCount()).toBe(0);
  });

  it("does not use the GPU for a hidden terminal", async () => {
    saveGpuTerminalRendering(true);
    attach(host(0, 0));
    await settle();
    expect(addons).toHaveLength(0);
  });

  it("falls back after a lost context and retries only when the setting changes", async () => {
    saveGpuTerminalRendering(true);
    attach();
    await settle();
    addons[0]?.loseContext();
    expect(addons[0]?.disposed).toBe(true);
    expect(activeGpuTerminalCount()).toBe(0);

    saveGpuTerminalRendering(true);
    await settle();
    expect(addons).toHaveLength(2);
    expect(activeGpuTerminalCount()).toBe(1);
  });

  it("stays on the normal renderer when WebGL cannot start", async () => {
    failActivation = true;
    saveGpuTerminalRendering(true);
    attach();
    await settle();
    expect(addons[0]?.disposed).toBe(true);
    expect(activeGpuTerminalCount()).toBe(0);
  });

  it(`uses the GPU for at most ${MAX_GPU_TERMINALS} terminals at once`, async () => {
    saveGpuTerminalRendering(true);
    for (let index = 0; index <= MAX_GPU_TERMINALS; index += 1) attach();
    await settle();
    expect(activeGpuTerminalCount()).toBe(MAX_GPU_TERMINALS);
  });
});
