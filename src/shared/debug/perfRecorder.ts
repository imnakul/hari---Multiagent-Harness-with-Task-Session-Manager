import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "../../platform/tauri/fs";
import {
  backendReportLines,
  startBackendTiming,
  type BackendTiming,
} from "./backendTiming";
import type { HoverDebugEvent } from "./perfDebug";

/**
 * Performance log recorder for the Performance overlay. While recording it
 * samples once a second (FPS, worst frame, stutters, long tasks, and where
 * the pointer is), keeps every hover-glide event, times backend calls
 * (backendTiming.ts), and on stop writes a
 * Markdown report to Downloads that can be shared as-is.
 */

const JANK_MS = 50;
const SAMPLE_MS = 1000;
const MAX_SAMPLES = 60 * 60; // one hour
const MAX_EVENTS = 5000;

type Sample = {
  /** Seconds since recording started. */
  t: number;
  fps: number;
  worstMs: number;
  stutters: number;
  longTasks: number;
  longestTaskMs: number;
  /** Labelled ancestors of the element under the pointer, outermost first. */
  location: string;
  glides: number;
  snaps: number;
  hides: number;
};

type LongTask = { t: number; durationMs: number; source: string };

type Recording = {
  startedAt: Date;
  startedPerf: number;
  samples: Sample[];
  events: HoverDebugEvent[];
  longTasks: LongTask[];
  /** Stops everything and returns the backend timing. */
  stop: () => BackendTiming;
};

export type RecorderState =
  | { status: "idle" }
  | { status: "recording"; startedPerf: number }
  | { status: "saving" }
  | { status: "saved"; path: string }
  | { status: "error"; message: string };

let recording: Recording | null = null;
let state: RecorderState = { status: "idle" };
const listeners = new Set<() => void>();

function setState(next: RecorderState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function isPerfRecording(): boolean {
  return recording !== null;
}

export function recorderState(): RecorderState {
  return state;
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the hover debug store for every event while recording. */
export function recordHoverEvent(event: HoverDebugEvent): void {
  if (!recording || recording.events.length >= MAX_EVENTS) return;
  recording.events.push(event);
}

export function startPerfRecording(): void {
  if (recording) return;
  const startedPerf = performance.now();
  const samples: Sample[] = [];
  const events: HoverDebugEvent[] = [];
  const longTasks: LongTask[] = [];
  let frames: number[] = [];
  let last = startedPerf;
  let pointer: { x: number; y: number } | null = null;
  let eventsSeen = 0;

  let raf = requestAnimationFrame(function tick(time: number) {
    frames.push(time - last);
    last = time;
    raf = requestAnimationFrame(tick);
  });
  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener("pointermove", onPointerMove, {
    passive: true,
    capture: true,
  });
  let observer: PerformanceObserver | null = null;
  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        longTasks.push({
          t: (entry.startTime - startedPerf) / 1000,
          durationMs: entry.duration,
          source: longTaskSource(entry),
        });
    });
    observer.observe({ type: "longtask" });
  }
  const stopBackend = startBackendTiming(startedPerf);
  let taskCursor = 0;
  const timer = window.setInterval(() => {
    const now = performance.now();
    const second = frames;
    frames = [];
    const elapsed = second.reduce((sum, frame) => sum + frame, 0);
    const fresh = events.slice(eventsSeen);
    eventsSeen = events.length;
    const tasks = longTasks.slice(taskCursor);
    taskCursor = longTasks.length;
    if (samples.length < MAX_SAMPLES)
      samples.push({
        t: Math.round((now - startedPerf) / 100) / 10,
        fps: elapsed ? Math.round((second.length * 1000) / elapsed) : 0,
        worstMs: Math.round(Math.max(0, ...second)),
        stutters: second.filter((frame) => frame > JANK_MS).length,
        longTasks: tasks.length,
        longestTaskMs: Math.round(
          Math.max(0, ...tasks.map((task) => task.durationMs)),
        ),
        location: pointer
          ? locationAt(pointer.x, pointer.y)
          : "(pointer not moved)",
        glides: fresh.filter((event) => event.kind === "glide").length,
        snaps: fresh.filter((event) => event.kind === "snap").length,
        hides: fresh.filter((event) => event.kind === "hide").length,
      });
  }, SAMPLE_MS);

  recording = {
    startedAt: new Date(),
    startedPerf,
    samples,
    events,
    longTasks,
    stop: () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      window.removeEventListener("pointermove", onPointerMove, {
        capture: true,
      });
      observer?.disconnect();
      return stopBackend();
    },
  };
  setState({ status: "recording", startedPerf });
}

/** Stops recording and saves the report. Resolves to the saved path. */
export async function stopPerfRecording(): Promise<string | null> {
  const current = recording;
  if (!current) return null;
  const backend = current.stop();
  recording = null;
  setState({ status: "saving" });
  const report = buildPerfReport(current, new Date(), backend);
  const name = `monocode-perf-${fileStamp(current.startedAt)}.md`;
  try {
    const home = (await homeDir()).replace(/[\\/]+$/, "");
    const separator = home.includes("\\") ? "\\" : "/";
    let path = `${home}${separator}Downloads${separator}${name}`;
    try {
      await invoke("write_text_file", { path, content: report });
    } catch {
      // No Downloads folder: fall back to the home folder.
      path = `${home}${separator}${name}`;
      await invoke("write_text_file", { path, content: report });
    }
    setState({ status: "saved", path });
    return path;
  } catch (failure) {
    setState({ status: "error", message: String(failure) });
    return null;
  }
}

export function dismissRecorderResult(): void {
  if (state.status === "saved" || state.status === "error")
    setState({ status: "idle" });
}

function longTaskSource(entry: PerformanceEntry): string {
  const attribution =
    "attribution" in entry && Array.isArray(entry.attribution)
      ? entry.attribution
      : [];
  const first: unknown = attribution[0];
  if (first && typeof first === "object" && "containerName" in first) {
    const container = String(first.containerName || "");
    if (container) return container;
  }
  return entry.name || "self";
}

/**
 * "Session Manager › Needs attention column › RIGOROUP – Add Github…": the
 * labelled regions under the pointer, so a log line says where it was.
 */
export function locationAt(x: number, y: number): string {
  let element: Element | null = document.elementFromPoint(x, y);
  const parts: string[] = [];
  while (element && parts.length < 4) {
    const label =
      element.getAttribute("data-debug-surface") ??
      element.getAttribute("aria-label") ??
      (element.hasAttribute("data-app-kanban") ? "Session Manager" : null);
    if (label && !parts.includes(label)) parts.unshift(label);
    element = element.parentElement;
  }
  return parts.length ? parts.join(" › ") : "(unlabelled area)";
}

function fileStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

/** Markdown report: environment, per-area summary, timeline, backend calls, events. */
export function buildPerfReport(
  data: Pick<
    Recording,
    "startedAt" | "startedPerf" | "samples" | "events" | "longTasks"
  >,
  stoppedAt: Date,
  backend?: BackendTiming,
): string {
  const { samples, events, longTasks } = data;
  const seconds = Math.round(
    (stoppedAt.getTime() - data.startedAt.getTime()) / 1000,
  );
  const lines: string[] = [
    "# MonoCode performance log",
    "",
    `- Recorded: ${data.startedAt.toISOString()} → ${stoppedAt.toISOString()} (${seconds}s)`,
    `- Window: ${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
    `- Browser: ${navigator.userAgent}`,
    `- Stutter = a frame over ${JANK_MS}ms. Snap = hover highlight appeared without gliding.`,
    "",
    "## Summary by area",
    "",
    "| Area (under pointer) | Seconds | Avg FPS | Min FPS | Stutters | Long tasks | Longest task | Glide | Snap | Hide |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const byArea = new Map<string, Sample[]>();
  for (const sample of samples) {
    const area = sample.location.split(" › ").slice(0, 2).join(" › ");
    const rows = byArea.get(area);
    if (rows) rows.push(sample);
    else byArea.set(area, [sample]);
  }
  for (const [area, rows] of [...byArea].sort(
    (a, b) => average(a[1]) - average(b[1]),
  )) {
    lines.push(
      `| ${cell(area)} | ${rows.length} | ${Math.round(average(rows))} | ${Math.min(...rows.map((row) => row.fps))} | ${sum(rows, "stutters")} | ${sum(rows, "longTasks")} | ${Math.max(...rows.map((row) => row.longestTaskMs))}ms | ${sum(rows, "glides")} | ${sum(rows, "snaps")} | ${sum(rows, "hides")} |`,
    );
  }

  const ownFill = new Map<string, number>();
  for (const event of events)
    if (event.ownFill)
      ownFill.set(event.surface, (ownFill.get(event.surface) ?? 0) + 1);
  if (ownFill.size) {
    lines.push(
      "",
      "## Items with their own background under the highlight",
      "",
      "Expected for cards with a resting tint; a problem only for rows that fill on hover.",
      "",
    );
    for (const [surface, count] of ownFill)
      lines.push(`- ${surface}: ${count} hovers`);
  }

  lines.push(
    "",
    "## Timeline (1 sample per second)",
    "",
    "| t (s) | FPS | Worst frame | Stutters | Long tasks | Glide/Snap/Hide | Where |",
    "|---|---|---|---|---|---|---|",
  );
  for (const sample of samples)
    lines.push(
      `| ${sample.t} | ${sample.fps} | ${sample.worstMs}ms | ${sample.stutters} | ${sample.longTasks}${sample.longTasks ? ` (max ${sample.longestTaskMs}ms)` : ""} | ${sample.glides}/${sample.snaps}/${sample.hides} | ${cell(sample.location)} |`,
    );

  if (longTasks.length) {
    lines.push(
      "",
      "## Long tasks",
      "",
      "| t (s) | Duration | Source |",
      "|---|---|---|",
    );
    for (const task of longTasks)
      lines.push(
        `| ${task.t.toFixed(1)} | ${Math.round(task.durationMs)}ms | ${cell(task.source)} |`,
      );
  }

  if (backend) lines.push(...backendReportLines(backend));

  lines.push("", "## Hover events", "");
  for (const event of events) {
    const t = ((event.at - data.startedPerf) / 1000).toFixed(1);
    const detail =
      event.kind === "hide"
        ? (event.reason ?? "")
        : `${event.item}${event.ownFill ? " · own fill" : ""}`;
    lines.push(`- ${t}s ${event.kind} [${event.surface}] ${detail}`);
  }
  if (!events.length) lines.push("- (none)");
  return `${lines.join("\n")}\n`;
}

function average(rows: Sample[]): number {
  return (
    rows.reduce((total, row) => total + row.fps, 0) / Math.max(1, rows.length)
  );
}

function sum(
  rows: Sample[],
  key: "stutters" | "longTasks" | "glides" | "snaps" | "hides",
): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
