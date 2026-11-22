import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { CircleDot, GitPullRequest, RefreshCw } from "../../../shared/ui/icons";
import { SegmentedSwitch, type SegmentedOption } from "../../../shared/ui/SegmentedSwitch";
import type { LinkedWorkItem } from "../../sessions/model/session";
import {
  formatRelativeTime,
  githubRepo,
  githubStatus,
  type GithubWorkItem,
} from "../model/githubTasks";
import {
  fetchSidebarInboxItems,
  readSidebarInboxCache,
  readSidebarInboxStale,
} from "../model/sidebarInboxItems";

type Filter = "all" | "pr" | "issue";
const FILTERS: readonly SegmentedOption<Filter>[] = [
  { id: "all", label: "All" },
  { id: "pr", label: "Pull requests" },
  { id: "issue", label: "Issues" },
];

type Load =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "notConnected" }
  | { kind: "noRepo" }
  | { kind: "loading"; repo: string }
  | { kind: "error"; repo: string }
  | {
      kind: "ready";
      repo: string;
      items: GithubWorkItem[];
      /** The last refresh failed; the rows are the earlier ones. */
      stale: boolean;
      /** A refresh is running; the rows stay until it ends. */
      refreshing: boolean;
    };

const NOTE = "px-3 py-6 text-center text-[12.5px] text-content/55";
const ACTION =
  "mt-2 inline-flex h-7 items-center rounded-md px-2.5 text-[12px] text-content/80 transition-colors hover:bg-content/10 active:scale-96";

/**
 * Fork (L-380): the sidebar's Inbox tab. Open GitHub pull requests and issues
 * of the repository the sidebar is working in; a row opens the full Inbox on
 * that item. It only reads; every other Inbox action stays in the full view.
 */
export function InboxSidebarPane({
  cwd,
  remote,
  onOpenItem,
  onOpenInbox,
}: {
  cwd: string;
  remote: boolean;
  onOpenItem: (item: LinkedWorkItem) => void;
  onOpenInbox: () => void;
}): JSX.Element {
  const [load, setLoad] = useState<Load>(remote ? { kind: "unavailable" } : { kind: "checking" });
  const [filter, setFilter] = useState<Filter>("all");
  const requestSeq = useRef(0);

  const run = useCallback(
    (force: boolean) => {
      const seq = ++requestSeq.current;
      if (remote) {
        setLoad({ kind: "unavailable" });
        return;
      }
      // A refresh keeps the rows on screen; a new repository starts from "checking".
      setLoad((previous) =>
        force && previous.kind === "ready"
          ? { ...previous, stale: false, refreshing: true }
          : { kind: "checking" },
      );
      void (async () => {
        try {
          const status = await githubStatus();
          if (seq !== requestSeq.current) return;
          if (!status.connected) {
            setLoad({ kind: "notConnected" });
            return;
          }
          let repo: string;
          try {
            repo = await githubRepo(cwd);
          } catch {
            if (seq === requestSeq.current) setLoad({ kind: "noRepo" });
            return;
          }
          if (seq !== requestSeq.current) return;
          const fresh = force ? null : readSidebarInboxCache(repo);
          if (fresh) {
            setLoad({ kind: "ready", repo, items: fresh, stale: false, refreshing: false });
            return;
          }
          const kept = readSidebarInboxStale(repo);
          setLoad(
            kept
              ? { kind: "ready", repo, items: kept, stale: false, refreshing: true }
              : { kind: "loading", repo },
          );
          try {
            const items = await fetchSidebarInboxItems(cwd, repo);
            if (seq === requestSeq.current) setLoad({ kind: "ready", repo, items, stale: false, refreshing: false });
          } catch {
            if (seq !== requestSeq.current) return;
            setLoad(kept ? { kind: "ready", repo, items: kept, stale: true, refreshing: false } : { kind: "error", repo });
          }
        } catch {
          if (seq === requestSeq.current) setLoad({ kind: "notConnected" });
        }
      })();
    },
    [cwd, remote],
  );

  useEffect(() => {
    run(false);
    return () => {
      requestSeq.current += 1;
    };
  }, [run]);

  const repo = "repo" in load ? load.repo : null;
  const items =
    load.kind === "ready" ? load.items.filter((item) => filter === "all" || item.kind === filter) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Inbox">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-content/60">{repo ?? "GitHub"}</span>
        <button
          type="button"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => run(true)}
          disabled={
            load.kind === "checking" ||
            load.kind === "loading" ||
            (load.kind === "ready" && load.refreshing)
          }
          className="grid size-7 place-items-center rounded-md text-content/60 transition-colors hover:bg-content/10 hover:text-content active:scale-96 disabled:opacity-40"
        >
          <RefreshCw
            className={`size-3.5 ${load.kind === "ready" && load.refreshing ? "motion-safe:animate-spin" : ""}`}
            aria-hidden
          />
        </button>
      </header>
      {load.kind === "ready" ? (
        <div className="flex shrink-0 justify-center border-b border-stroke px-2 py-1.5">
          <SegmentedSwitch options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter" />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {load.kind === "checking" || load.kind === "loading" ? (
          <ul aria-busy="true" aria-label="Loading" className="space-y-1 p-2">
            {[0, 1, 2, 3].map((n) => (
              <li key={n} className="h-11 animate-pulse rounded-md bg-content/[0.06]" />
            ))}
          </ul>
        ) : load.kind === "unavailable" ? (
          <p className={NOTE}>GitHub isn&apos;t available for remote projects.</p>
        ) : load.kind === "notConnected" ? (
          <div className={NOTE}>
            <p>Connect GitHub to see pull requests and issues.</p>
            <button type="button" onClick={onOpenInbox} className={ACTION}>
              Open Inbox
            </button>
          </div>
        ) : load.kind === "noRepo" ? (
          <p className={NOTE}>This folder isn&apos;t a GitHub repository.</p>
        ) : load.kind === "error" ? (
          <div role="alert" className={NOTE}>
            <p>Couldn&apos;t load GitHub items.</p>
            <button type="button" onClick={() => run(true)} className={ACTION}>
              Try again
            </button>
          </div>
        ) : (
          <>
            {load.stale ? (
              <div role="status" className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-content/55">
                <span className="min-w-0 flex-1">Couldn&apos;t refresh.</span>
                <button type="button" onClick={() => run(true)} className="text-content/80 hover:underline">
                  Try again
                </button>
              </div>
            ) : null}
            {load.items.length === 0 ? (
              <p className={NOTE}>Nothing open in {load.repo}.</p>
            ) : (
              <ul className="py-1">
                {items.map((item) => (
                  <li key={`${item.kind}:${item.number}`}>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenItem({ kind: item.kind, repo: item.repo, number: item.number, url: item.url })
                      }
                      className="flex w-full min-w-0 items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-content/[0.06] active:bg-content/10"
                    >
                      {item.kind === "pr" ? (
                        <GitPullRequest className="mt-0.5 size-3.5 shrink-0 text-content/55" aria-hidden />
                      ) : (
                        <CircleDot className="mt-0.5 size-3.5 shrink-0 text-content/55" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-content/90">
                          <span className="text-content/50">#{item.number}</span> {item.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-content/45">
                          {item.draft ? <span className="rounded bg-content/10 px-1">Draft</span> : null}
                          <span>{formatRelativeTime(item.updatedAt)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
