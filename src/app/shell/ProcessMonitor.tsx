import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  loadProcessMonitor,
  subscribeProcessMonitor,
} from "../../features/settings/model/settings";
import type { Session } from "../../features/sessions/model/session";
import { Popover } from "../../shared/ui/Popover";
import { useResourcePressure } from "../../features/notifications/ui/ResourcePressureNotice";
import { killPty } from "../../platform/tauri/pty";
import { killChild } from "../../integrations/harness/core/child";
import {
  interactiveClaudeIdleSafe,
  parkInteractiveClaude,
  stopInteractiveClaude,
} from "../../integrations/harness/providers/claude/claudeInteractive";
import {
  processIdleAge,
  processIdleCandidate,
  processLabel,
  processMemory,
  processPercent,
  processSessionId,
  processTotals,
  retainExitedProcesses,
  type AppProcess,
  type OwnedProcess,
  type ProcessDetail,
  type ProcessMonitorStats,
} from "./processMonitorModel";
import { ChevronRight, Loader, Square } from "../../shared/ui/icons";

type Props = {
  sessions: Session[];
  metadata?: Pick<Session, "id" | "title" | "cwd" | "worktreeCwd">[];
  onStop: (id: string) => Promise<unknown> | void;
  onPressureChange?: (active: boolean) => void;
};

export function ProcessMonitor(props: Props): ReactElement | null {
  const enabled = useSyncExternalStore(
    subscribeProcessMonitor,
    loadProcessMonitor,
    () => false,
  );
  // The sampler is not mounted while disabled: no timers, listeners or IPC.
  return enabled && isTauri() ? <EnabledProcessMonitor {...props} /> : null;
}

function EnabledProcessMonitor({
  sessions,
  metadata = [],
  onStop,
  onPressureChange,
}: Props): ReactElement {
  const pressure = useResourcePressure(onPressureChange);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OwnedProcess[] | null>(null);
  const [app, setApp] = useState<AppProcess | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [stopping, setStopping] = useState(new Set<string>());
  // Keyed by row id + root PID so a restarted process starts collapsed.
  const [expanded, setExpanded] = useState(new Set<string>());
  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const button = useRef<HTMLButtonElement>(null);
  const refresh = useRef<() => void>(() => undefined);
  const busy = useRef(false);
  const previous = useRef<OwnedProcess[]>([]);
  const latest = useRef({ sessions, onStop });
  latest.current = { sessions, onStop };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const update = async (): Promise<void> => {
      clearTimeout(timer);
      if (busy.current) {
        timer = setTimeout(() => {
          void update();
        }, 100);
        return;
      }
      busy.current = true;
      try {
        const next = await invoke<ProcessMonitorStats>("process_monitor_stats");
        if (!disposed) {
          const merged = retainExitedProcesses(previous.current, next.owned);
          previous.current = merged;
          setRows(merged);
          setApp(next.app);
          setError(undefined);
        }
      } catch (failure) {
        if (!disposed) setError(String(failure));
      } finally {
        busy.current = false;
        if (!disposed)
          timer = setTimeout(
            () => {
              void update();
            },
            open ? 3000 : 10000,
          );
      }
    };
    refresh.current = () => {
      void update();
    };
    void update();
    return () => {
      disposed = true;
      clearTimeout(timer);
      refresh.current = () => undefined;
    };
  }, [open]);
  const stopTool = async (row: OwnedProcess, item: ProcessDetail): Promise<void> => {
    if (!row.root.identity || !item.identity || item.depth === 0) return;
    const key = `tool:${row.root.id}:${item.pid}`;
    setStopping((previous) => new Set(previous).add(key));
    try {
      await invoke("process_stop_tool", {rootId: row.root.id, rootPid: row.root.pid, rootIdentity: row.root.identity, pid: item.pid, identity: item.identity});
    } catch (failure) {
      setError(String(failure));
    } finally {
      setStopping((previous) => { const next = new Set(previous); next.delete(key); return next; });
      refresh.current();
    }
  };
  const sessionFor = (row: OwnedProcess): Session | undefined =>
    sessions.find((s) => s.id === processSessionId(row));
  const metadataFor = (
    row: OwnedProcess,
  ): Pick<Session, "id" | "title" | "cwd" | "worktreeCwd"> | undefined =>
    sessionFor(row) ??
    metadata.find((entry) => entry.id === processSessionId(row));
  const safe = (row: OwnedProcess): boolean =>
    processIdleCandidate(row, sessionFor(row)) &&
    (row.root.kind !== "interactive" ||
      interactiveClaudeIdleSafe(processSessionId(row)));
  const stop = async (row: OwnedProcess, idleOnly: boolean): Promise<void> => {
    const id = processSessionId(row);
    const current = latest.current.sessions.find((s) => s.id === id);
    if (
      idleOnly &&
      (!processIdleCandidate(row, current) ||
        (row.root.kind === "interactive" && !interactiveClaudeIdleSafe(id)))
    )
      return;
    setStopping((prev) => new Set(prev).add(row.root.id));
    try {
      if (idleOnly && row.root.kind !== "interactive") {
        const fresh = (
          await invoke<ProcessMonitorStats>("process_monitor_stats")
        ).owned.find(
          (r) => r.root.id === row.root.id && r.root.pid === row.root.pid,
        );
        const freshSession = latest.current.sessions.find((s) => s.id === id);
        if (!fresh || !processIdleCandidate(fresh, freshSession)) return;
      }
      if (idleOnly && row.root.kind === "interactive") {
        if (!(await parkInteractiveClaude(id, 0, true)))
          setNotice(
            "Kept running because a safe idle state could not be confirmed.",
          );
      } else if (row.root.kind === "interactive" && !current)
        await stopInteractiveClaude(id);
      else if (current && row.root.kind !== "terminal")
        await latest.current.onStop(id);
      else if (row.root.kind === "terminal") await killPty(row.root.id);
      else if (!idleOnly && row.root.kind === "structured")
        await killChild(row.root.id);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setStopping((prev) => {
        const next = new Set(prev);
        next.delete(row.root.id);
        return next;
      });
      refresh.current();
    }
  };
  const totals = app ? processTotals(app, rows ?? []) : null;
  const cpu = totals?.cpu == null ? "…" : processPercent(totals.cpu);
  const gpu = totals?.gpu == null ? "" : ` · GPU ${processPercent(totals.gpu)}`;
  const groups = new Map<string, OwnedProcess[]>();
  for (const row of rows ?? []) {
    const project =
      metadataFor(row)?.cwd ??
      metadata.find(
        (entry) =>
          entry.worktreeCwd === row.root.cwd || entry.cwd === row.root.cwd,
      )?.cwd ??
      row.root.cwd;
    groups.set(project, [...(groups.get(project) ?? []), row]);
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Process monitor"
        className={`shrink-0 rounded px-1.5 py-0.5 hover:bg-content/10 ${pressure.active ? "text-amber-500" : "text-content/65"}`}
        title={`MonoCode and the chats and terminals it started; CPU and GPU as a share of machine capacity${
          totals?.partial
            ? ". Some processes could not be read, so totals count only the readable ones"
            : ""
        }`}
      >
        {pressure.active ? "High usage · " : ""}
        {error
          ? "Processes unavailable"
          : rows == null || !totals
            ? "Processes loading…"
            : `CPU ${cpu} · ${processMemory(totals.memory)}${gpu}`}
      </button>
      {open ? (
        <Popover
          anchor={button}
          side="top"
          align="start"
          width={560}
          onDismiss={() => setOpen(false)}
        >
          <div className="max-h-96 overflow-y-auto p-3 text-xs">
            <div className="mb-3 flex items-center justify-between gap-3">
              <strong>MonoCode processes</strong>
              <button
                type="button"
                disabled={!rows?.some(safe) || stopping.size > 0}
                className="rounded px-2 py-1 hover:bg-content/10 disabled:opacity-40"
                title="Stop idle chats with no work or interaction pending"
                onClick={() => {
                  void (async (): Promise<void> => {
                    for (const row of rows ?? [])
                      if (safe(row)) await stop(row, true);
                  })();
                }}
              >
                Stop all idle
              </button>
            </div>
            {pressure.active ? <p role="status" className="mb-2 text-amber-500">Resource pressure: {pressure.reasons.join(", ")}. Stop a session or a running tool below to free resources.</p> : null}
            {error ? (
              <p role="status" className="mb-2 text-red-400">
                Stats unavailable: {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="mb-2 text-content/65">
                {notice}
              </p>
            ) : null}
            {rows == null ? <p role="status">Loading process stats…</p> : null}
            {app ? (
              <div
                aria-hidden
                className="flex justify-end gap-2 text-content/40"
              >
                <UsageHeader />
                <span className="size-6 shrink-0" />
              </div>
            ) : null}
            {app ? (
              <div className="mb-3">
                <div className="flex items-center gap-2 py-2">
                  <DisclosureButton
                    label="MonoCode app"
                    expanded={expanded.has(`app:${app.pid}`)}
                    onToggle={() => toggle(`app:${app.pid}`)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">MonoCode app</div>
                    <div className="text-content/50">
                      App and web view · {app.processes} process
                      {app.processes === 1 ? "" : "es"}
                      {app.unreadable
                        ? ` · ${app.unreadable} not readable`
                        : ""}
                    </div>
                  </div>
                  <UsageCells
                    cpu={app.cpu}
                    memory={app.memory}
                    gpu={app.gpu}
                    measuring={app.memory != null}
                  />
                  <span aria-hidden className="size-6 shrink-0" />
                </div>
                {expanded.has(`app:${app.pid}`) ? (
                  <ProcessList
                    label="MonoCode app"
                    items={app.children}
                    appPid={app.pid}
                  />
                ) : null}
              </div>
            ) : null}
            {rows?.length === 0 ? (
              <p className="mb-3">No chats or terminals running.</p>
            ) : null}
            {[...groups].map(([project, group]) => (
              <div key={project} className="mb-3">
                <div className="mb-1 truncate text-content/50" title={project}>
                  {project}
                </div>
                {group.map((row) => {
                  const key = `${row.root.id}:${row.root.pid}`;
                  const title =
                    metadataFor(row)?.title ??
                    (row.root.kind === "terminal"
                      ? "Terminal"
                      : "Background helper");
                  const listable =
                    row.status !== "exited" && row.children.length > 0;
                  return (
                    <div key={key} className="border-t border-content/10">
                      <div className="group flex items-center gap-2 py-2">
                        {listable ? (
                          <DisclosureButton
                            label={title}
                            expanded={expanded.has(key)}
                            onToggle={() => toggle(key)}
                          />
                        ) : (
                          <span aria-hidden className="size-5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate" title={row.root.id}>
                            {title}
                          </div>
                          <div className="text-content/50">
                            {row.root.kind === "interactive"
                              ? "Interactive"
                              : row.root.kind === "structured"
                                ? "Structured"
                                : "Terminal"}{" "}
                            · {processIdleAge(row.root.idleMs)} ·{" "}
                            {row.processes} process
                            {row.processes === 1 ? "" : "es"}
                          </div>
                        </div>
                        {row.status === "exited" ? (
                          <span className="shrink-0 text-content/50">Exited</span>
                        ) : (
                          <UsageCells
                            cpu={row.cpu}
                            memory={row.memory}
                            gpu={row.gpu}
                            measuring={row.status !== "unavailable"}
                          />
                        )}
                        {row.status === "exited" ? (
                          <span aria-hidden className="size-6 shrink-0" />
                        ) : stopping.has(row.root.id) ? (
                          <span
                            role="status"
                            aria-label={`Stopping ${title}`}
                            className="grid size-6 shrink-0 place-items-center text-content/60"
                          >
                            <Loader aria-hidden className="size-3.5 animate-spin" />
                          </span>
                        ) : (
                          // Hidden until the row is hovered or the button has
                          // keyboard focus, so Stop is never one stray click away.
                          <button
                            type="button"
                            aria-label={`Stop ${title}`}
                            title="Stop"
                            className="grid size-6 shrink-0 place-items-center rounded text-content/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400 focus-visible:opacity-100 motion-reduce:transition-none"
                            onClick={() => {
                              void stop(row, false);
                            }}
                          >
                            <Square aria-hidden className="size-3 fill-current" />
                          </button>
                        )}
                      </div>
                      {listable && expanded.has(key) ? (
                        <ProcessList
                          label={title}
                          items={row.children}
                          appPid={app?.pid}
                          root={row.status === "exited" ? undefined : row.root}
                          stopping={stopping}
                          onStopTool={(item) => void stopTool(row, item)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-content/40">
              Includes child processes. CPU is measured across all logical
              processors. GPU is the busiest graphics engine, as in Task
              Manager; terminals draw in the web view, so their GPU work shows
              on the MonoCode app row. Idle time is since process activity;
              bulk stop also checks chat state.
            </p>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function DisclosureButton({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} processes for ${label}`}
      onClick={onToggle}
      className="grid size-5 shrink-0 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content"
    >
      <ChevronRight
        className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

const CPU_CELL = "w-14 shrink-0 text-right";
const MEMORY_CELL = "w-16 shrink-0 text-right";
const GPU_CELL = "w-14 shrink-0 text-right";

function UsageHeader(): ReactElement {
  return (
    <span className="flex shrink-0">
      <span className={CPU_CELL}>CPU</span>
      <span className={MEMORY_CELL}>RAM</span>
      <span className={GPU_CELL}>GPU</span>
    </span>
  );
}

/**
 * CPU, RAM and GPU in fixed columns. `measuring` separates a first sample
 * (CPU needs two) from a process the OS would not let us read.
 */
function UsageCells({
  cpu,
  memory,
  gpu,
  measuring,
}: {
  cpu: number | null;
  memory: number | null;
  gpu?: number | null;
  measuring: boolean;
}): ReactElement {
  return (
    <span className="flex shrink-0 tabular-nums text-content/65">
      <span className={CPU_CELL}>
        {cpu == null ? (
          <Unknown label={measuring ? "Measuring CPU…" : "CPU unavailable"} />
        ) : (
          <>
            <span className="sr-only">CPU </span>
            {processPercent(cpu)}
          </>
        )}
      </span>
      <span className={MEMORY_CELL}>
        {memory == null ? (
          <Unknown label="Memory unavailable" />
        ) : (
          <>
            <span className="sr-only">RAM </span>
            {processMemory(memory)}
          </>
        )}
      </span>
      <span className={GPU_CELL}>
        {gpu == null ? (
          <Unknown label="GPU not measured" />
        ) : (
          <>
            <span className="sr-only">GPU </span>
            {processPercent(gpu)}
          </>
        )}
      </span>
    </span>
  );
}

function Unknown({ label }: { label: string }): ReactElement {
  return (
    <>
      <span aria-hidden title={label}>
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** App/root processes are view-only; verified owned tool descendants can be stopped. */
function ProcessList({
  label,
  items,
  appPid,
  root,
  stopping,
  onStopTool,
}: {
  label: string;
  items: ProcessDetail[];
  appPid?: number;
  root?: OwnedProcess["root"];
  stopping?: ReadonlySet<string>;
  onStopTool?: (item: ProcessDetail) => void;
}): ReactElement {
  if (items.length === 0)
    return <p className="pb-2 pl-7 text-content/50">No process details.</p>;
  return (
    <ul aria-label={`Processes for ${label}`} className="pb-2 pl-7">
      {items.map((item) => (
        <li
          key={item.pid}
          className="group/tool flex items-center gap-2 py-0.5 text-content/65"
          style={{ paddingLeft: `${Math.min(item.depth, 6) * 12}px` }}
        >
          <span className="min-w-0 flex-1 truncate" title={item.name}>
            {appPid == null
              ? item.name || "Unnamed process"
              : processLabel(item, appPid)}
          </span>
          <span className="shrink-0 tabular-nums text-content/50">
            PID {item.pid}
          </span>
          <UsageCells
            cpu={item.cpu}
            memory={item.memory}
            gpu={item.gpu}
            measuring={item.memory != null}
          />
          {root?.identity && item.identity && item.depth > 0 && onStopTool ? <button type="button" aria-label={`Stop tool ${item.name || item.pid}`} title="Stop this tool and its children" disabled={stopping?.has(`tool:${root.id}:${item.pid}`)} onClick={() => onStopTool(item)} className="grid size-6 shrink-0 place-items-center rounded text-content/60 opacity-0 hover:bg-red-500/15 hover:text-red-400 group-hover/tool:opacity-100 focus-visible:opacity-100 disabled:opacity-50"><Square aria-hidden className="size-3 fill-current" /></button> : <span aria-hidden className="size-6 shrink-0" />}
        </li>
      ))}
    </ul>
  );
}
