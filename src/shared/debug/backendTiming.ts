/**
 * Fork (L-161): backend call timing for the Performance overlay's log.
 *
 * While a log records, every backend call is timed, and once a second three
 * no-op commands are timed: one on the main thread, one on the async worker
 * pool, one behind the shared database lock.
 * When a click feels slow, the log then shows whether the call itself was slow,
 * which queue it waited in, and what else was in flight at the time.
 *
 * Tauri defines `__TAURI_INTERNALS__.invoke` as read-only, so the timing sits
 * one layer down: every call is a `fetch` to the IPC host (`ipc.localhost` on
 * Windows), and `window.fetch` can be wrapped. A call is counted done when its
 * reply's headers arrive; reading the body is not included.
 */

import { invoke } from "@tauri-apps/api/core";

export type BackendCall = {
  /** Seconds since recording started, when the call was sent. */
  t: number;
  command: string;
  ms: number;
  failed: boolean;
  /** Other app calls still waiting when this one was sent. */
  inFlight: number;
  /** Those calls, oldest first, with how long each had waited; slow calls only. */
  others?: string[];
};

export type BackendPing = {
  t: number;
  /** null: no reply (the command failed or is missing in this build). */
  mainMs: number | null;
  poolMs: number | null;
  dbMs: number | null;
  inFlight: number;
};

export type AssetLoad = { t: number; name: string; ms: number };

export type BackendTiming = {
  /** False outside the desktop app, where there is nothing to time. */
  patched: boolean;
  calls: BackendCall[];
  pings: BackendPing[];
  loads: AssetLoad[];
  maxInFlight: number;
};

export const SLOW_CALL_MS = 250;
const SLOW_LOAD_MS = 50;
const PING_MS = 1000;
const MAX_CALLS = 20_000;
const MAX_OTHERS = 10;
const PING_COMMANDS = new Set([
  "perf_ping_main",
  "perf_ping_pool",
  "perf_ping_db",
]);

/** The command name when `input` is a Tauri IPC request, else null. */
export function ipcCommand(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const match =
    /^(?:https?:\/\/ipc\.localhost|ipc:\/\/localhost)\/([^?#]+)/i.exec(raw);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const round = (ms: number): number => Math.round(ms);

/** Starts timing; the returned function stops it and hands back what it saw. */
export function startBackendTiming(startedPerf: number): () => BackendTiming {
  const calls: BackendCall[] = [];
  const pings: BackendPing[] = [];
  const loads: AssetLoad[] = [];
  const inFlight = new Map<number, { command: string; started: number }>();
  let maxInFlight = 0;
  let nextId = 0;
  const seconds = (at: number): number =>
    Math.round((at - startedPerf) / 100) / 10;

  const originalFetch = typeof window.fetch === "function" ? window.fetch : null;
  let wrapper: typeof window.fetch | null = null;
  let pingTimer: number | undefined;
  let pinging = false;

  if (originalFetch && Reflect.has(window, "__TAURI_INTERNALS__")) {
    wrapper = (input, init) => {
      const command = ipcCommand(input);
      if (command === null || PING_COMMANDS.has(command))
        return originalFetch.call(window, input, init);
      const id = nextId++;
      const started = performance.now();
      const waiting = [...inFlight.values()];
      inFlight.set(id, { command, started });
      maxInFlight = Math.max(maxInFlight, inFlight.size);
      const settle = (failed: boolean): void => {
        inFlight.delete(id);
        if (calls.length >= MAX_CALLS) return;
        const ms = performance.now() - started;
        calls.push({
          t: seconds(started),
          command,
          ms: round(ms),
          failed,
          inFlight: waiting.length,
          ...(ms >= SLOW_CALL_MS && waiting.length
            ? {
                others: waiting
                  .slice(0, MAX_OTHERS)
                  .map(
                    (call) =>
                      `${call.command} (${round(started - call.started)}ms)`,
                  ),
              }
            : {}),
        });
      };
      return originalFetch.call(window, input, init).then(
        (response) => {
          settle(response.headers.get("Tauri-Response") !== "ok");
          return response;
        },
        (error: unknown) => {
          settle(true);
          throw error;
        },
      );
    };
    window.fetch = wrapper;

    const timePing = async (command: string): Promise<number | null> => {
      const started = performance.now();
      try {
        await invoke(command);
        return round(performance.now() - started);
      } catch {
        // An older build without the ping commands: leave the column empty.
        return null;
      }
    };
    pingTimer = window.setInterval(() => {
      // A ping still waiting from the last second is itself the finding.
      if (pinging) return;
      pinging = true;
      const sent = performance.now();
      const waiting = inFlight.size;
      void Promise.all([
        timePing("perf_ping_main"),
        timePing("perf_ping_pool"),
        timePing("perf_ping_db"),
      ]).then(([mainMs, poolMs, dbMs]) => {
        pinging = false;
        pings.push({ t: seconds(sent), mainMs, poolMs, dbMs, inFlight: waiting });
      });
    }, PING_MS);
  }

  let observer: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("resource")
  ) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const initiator =
          "initiatorType" in entry ? String(entry.initiatorType) : "";
        // Backend calls are fetches too; they are timed above.
        if (initiator === "fetch" || initiator === "xmlhttprequest") continue;
        if (entry.duration < SLOW_LOAD_MS) continue;
        loads.push({
          t: seconds(entry.startTime),
          name: entry.name.replace(/^[a-z]+:\/\/[^/]+/i, ""),
          ms: round(entry.duration),
        });
      }
    });
    observer.observe({ type: "resource" });
  }

  return () => {
    window.clearInterval(pingTimer);
    observer?.disconnect();
    if (originalFetch && window.fetch === wrapper) window.fetch = originalFetch;
    return { patched: wrapper !== null, calls, pings, loads, maxInFlight };
  };
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function pingSummary(label: string, values: (number | null)[]): string {
  const answered = values.filter((value): value is number => value !== null);
  if (!answered.length) return `- ${label}: no replies`;
  return `- ${label}: median ${median(answered)}ms, worst ${Math.max(...answered)}ms (${answered.length} pings)`;
}

const pingCell = (ms: number | null): string => (ms === null ? "—" : `${ms}ms`);

/** The report's "Backend calls" section, as Markdown lines. */
export function backendReportLines(timing: BackendTiming): string[] {
  const lines: string[] = ["", "## Backend calls", ""];
  if (!timing.patched) {
    lines.push("- Not recorded: this page is not running in the desktop app.");
    return lines;
  }
  const { calls, pings, loads } = timing;
  const slow = calls.filter((call) => call.ms >= SLOW_CALL_MS);
  lines.push(
    `- ${calls.length} calls, ${slow.length} took ${SLOW_CALL_MS}ms or more; at most ${timing.maxInFlight} waiting at once.`,
    pingSummary("Main thread ping", pings.map((ping) => ping.mainMs)),
    pingSummary("Worker pool ping", pings.map((ping) => ping.poolMs)),
    pingSummary("Database lock ping", pings.map((ping) => ping.dbMs)),
    "",
    "### Commands by total time",
    "",
    "| Command | Calls | Avg | Max | Total | Failed |",
    "|---|---|---|---|---|---|",
  );
  const byCommand = new Map<string, BackendCall[]>();
  for (const call of calls) {
    const rows = byCommand.get(call.command);
    if (rows) rows.push(call);
    else byCommand.set(call.command, [call]);
  }
  const totals = [...byCommand].map(([command, rows]) => ({
    command,
    rows,
    total: rows.reduce((sum, row) => sum + row.ms, 0),
  }));
  for (const { command, rows, total } of totals
    .sort((a, b) => b.total - a.total)
    .slice(0, 40))
    lines.push(
      `| ${cell(command)} | ${rows.length} | ${Math.round(total / rows.length)}ms | ${Math.max(...rows.map((row) => row.ms))}ms | ${total}ms | ${rows.filter((row) => row.failed).length} |`,
    );

  lines.push(
    "",
    `### Slow calls (${SLOW_CALL_MS}ms or more)`,
    "",
    "| t (s) | Command | Took | Waiting when sent | Already waiting (and for how long) |",
    "|---|---|---|---|---|",
  );
  for (const call of slow.slice(0, 300))
    lines.push(
      `| ${call.t} | ${cell(call.command)}${call.failed ? " (failed)" : ""} | ${call.ms}ms | ${call.inFlight} | ${cell(call.others?.join(", ") ?? "")} |`,
    );
  if (!slow.length) lines.push("| — | (none) | | | |");

  lines.push(
    "",
    "### Pings (1 per second)",
    "",
    "| t (s) | Main thread | Worker pool | Database lock | Calls waiting |",
    "|---|---|---|---|---|",
  );
  for (const ping of pings)
    lines.push(
      `| ${ping.t} | ${pingCell(ping.mainMs)} | ${pingCell(ping.poolMs)} | ${pingCell(ping.dbMs)} | ${ping.inFlight} |`,
    );

  if (loads.length) {
    lines.push(
      "",
      `### Slow file loads (${SLOW_LOAD_MS}ms or more)`,
      "",
      "| t (s) | File | Took |",
      "|---|---|---|",
    );
    for (const load of loads.slice(0, 200))
      lines.push(`| ${load.t} | ${cell(load.name)} | ${load.ms}ms |`);
  }
  return lines;
}
