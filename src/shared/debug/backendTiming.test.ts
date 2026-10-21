// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendReportLines,
  ipcCommand,
  startBackendTiming,
  type BackendTiming,
} from "./backendTiming";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ipcCommand (L-161)", () => {
  it("reads the command from Windows and macOS IPC URLs only", () => {
    expect(ipcCommand("http://ipc.localhost/notes_upsert")).toBe("notes_upsert");
    expect(ipcCommand("ipc://localhost/plugin%3Aevent%7Clisten")).toBe(
      "plugin:event|listen",
    );
    expect(ipcCommand(new URL("http://ipc.localhost/tasks_upsert"))).toBe(
      "tasks_upsert",
    );
    expect(ipcCommand("http://tauri.localhost/assets/index.js")).toBeNull();
    expect(ipcCommand("https://example.com/ipc.localhost/x")).toBeNull();
  });
});

describe("startBackendTiming (L-161)", () => {
  it("times IPC calls, names what was already waiting, and restores fetch", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: () => Promise.resolve() });
    const replies: Array<() => void> = [];
    const fakeFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          replies.push(() =>
            resolve(new Response("{}", { headers: { "Tauri-Response": "ok" } })),
          );
        }),
    );
    vi.stubGlobal("fetch", fakeFetch);

    const stop = startBackendTiming(0);
    const slow = window.fetch("http://ipc.localhost/fetch_link_preview");
    now = 100;
    const quick = window.fetch("http://ipc.localhost/notes_upsert");
    const asset = window.fetch("http://tauri.localhost/assets/a.js");
    now = 2100;
    replies[1]?.();
    await quick;
    now = 7000;
    replies[0]?.();
    await slow;
    replies[2]?.();
    await asset;

    const timing = stop();
    expect(window.fetch).toBe(fakeFetch);
    expect(timing.patched).toBe(true);
    expect(timing.maxInFlight).toBe(2);
    expect(timing.calls).toEqual([
      {
        t: 0.1,
        command: "notes_upsert",
        ms: 2000,
        failed: false,
        inFlight: 1,
        others: ["fetch_link_preview (100ms)"],
      },
      {
        t: 0,
        command: "fetch_link_preview",
        ms: 7000,
        failed: false,
        inFlight: 0,
      },
    ]);
  });

  it("records nothing outside the desktop app", () => {
    const stop = startBackendTiming(0);
    expect(stop().patched).toBe(false);
  });
});

describe("backendReportLines (L-161)", () => {
  it("summarizes pings, commands and slow calls", () => {
    const timing: BackendTiming = {
      patched: true,
      maxInFlight: 7,
      calls: [
        { t: 1, command: "notes_upsert", ms: 2400, failed: false, inFlight: 6, others: ["fetch_link_preview (5000ms)"] },
        { t: 2, command: "notes_upsert", ms: 10, failed: false, inFlight: 0 },
      ],
      pings: [
        { t: 1, mainMs: 2, poolMs: 3, dbMs: 900, inFlight: 6 },
        { t: 2, mainMs: 4, poolMs: null, dbMs: 5, inFlight: 0 },
      ],
      loads: [{ t: 3, name: "/assets/SettingsView.js", ms: 800 }],
    };
    const report = backendReportLines(timing).join("\n");
    expect(report).toContain("- 2 calls, 1 took 250ms or more; at most 7 waiting at once.");
    expect(report).toContain("- Database lock ping: median 900ms, worst 900ms (2 pings)");
    expect(report).toContain("| notes_upsert | 2 | 1205ms | 2400ms | 2410ms | 0 |");
    expect(report).toContain("| 1 | notes_upsert | 2400ms | 6 | fetch_link_preview (5000ms) |");
    expect(report).toContain("| 2 | 4ms | — | 5ms | 0 |");
    expect(report).toContain("| 3 | /assets/SettingsView.js | 800ms |");
  });
});
