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
  processMemory,
  processSessionId,
  retainExitedProcesses,
  type OwnedProcess,
} from "./processMonitor";

type Props = {
  sessions: Session[];
  metadata?: Pick<Session, "id" | "title" | "cwd" | "worktreeCwd">[];
  onStop: (id: string) => Promise<unknown> | void;
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
}: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OwnedProcess[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [stopping, setStopping] = useState(new Set<string>());
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
        const next = await invoke<OwnedProcess[]>("owned_process_stats");
        if (!disposed) {
          const merged = retainExitedProcesses(previous.current, next);
          previous.current = merged;
          setRows(merged);
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
          await invoke<OwnedProcess[]>("owned_process_stats")
        ).find((r) => r.root.id === row.root.id && r.root.pid === row.root.pid);
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
  const live = rows?.filter((r) => r.status !== "exited") ?? [];
  const memory =
    live.length && live.every((r) => r.memory != null)
      ? live.reduce((n, r) => n + (r.memory ?? 0), 0)
      : live.length
        ? null
        : 0;
  const cpu = live.every((r) => r.cpu != null)
    ? live.reduce((n, r) => n + (r.cpu ?? 0), 0).toFixed(1) + "%"
    : "…";
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
        className="shrink-0 rounded px-1.5 py-0.5 text-content/65 hover:bg-content/10"
        title="MonoCode-owned process trees; CPU as a share of machine capacity"
      >
        {error
          ? "Processes unavailable"
          : rows == null
            ? "Processes loading…"
            : `CPU ${cpu} · ${processMemory(memory)}`}
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
            {rows == null ? (
              <p role="status">Loading process stats…</p>
            ) : rows.length === 0 ? (
              <p>No processes started by MonoCode.</p>
            ) : null}
            {[...groups].map(([project, group]) => (
              <div key={project} className="mb-3">
                <div className="mb-1 truncate text-content/50" title={project}>
                  {project}
                </div>
                {group.map((row) => (
                  <div
                    key={`${row.root.id}:${row.root.pid}`}
                    className="flex items-center gap-2 border-t border-content/10 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate" title={row.root.id}>
                        {metadataFor(row)?.title ??
                          (row.root.kind === "terminal"
                            ? "Terminal"
                            : "Background helper")}
                      </div>
                      <div className="text-content/50">
                        {row.root.kind === "interactive"
                          ? "Interactive"
                          : row.root.kind === "structured"
                            ? "Structured"
                            : "Terminal"}{" "}
                        · {processIdleAge(row.root.idleMs)} · {row.processes}{" "}
                        process{row.processes === 1 ? "" : "es"}
                      </div>
                    </div>
                    {row.status === "exited" ? (
                      <span>Exited</span>
                    ) : (
                      <span className="shrink-0 text-content/65">
                        {row.cpu == null
                          ? row.status === "unavailable"
                            ? "CPU unavailable"
                            : "Measuring CPU…"
                          : `${row.cpu.toFixed(1)}%`}{" "}
                        · {processMemory(row.memory)}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={
                        row.status === "exited" || stopping.has(row.root.id)
                      }
                      className="rounded px-2 py-1 hover:bg-content/10 disabled:opacity-40"
                      onClick={() => {
                        void stop(row, false);
                      }}
                    >
                      {stopping.has(row.root.id) ? "Stopping…" : "Stop"}
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-content/40">
              Includes child processes. CPU is measured across all logical
              processors. Idle time is since process activity; bulk stop also
              checks chat state.
            </p>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
