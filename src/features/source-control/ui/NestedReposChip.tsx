import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent } from "react";
import { gitBranches, type NestedRepo } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { chooseNestedRepo } from "../model/nestedRepos";
import { loadRepoColorMode, repoColors, subscribeRepoColorMode } from "../model/repoColors";
import { GitPickerTrigger } from "./GitPickerTrigger";

/** A repo's branch: still loading, the name, detached at a commit, or unreadable. */
type BranchState =
  | { kind: "loading" }
  | { kind: "branch"; name: string; detached: boolean }
  | { kind: "unknown" };

function branchLabel(state: BranchState | undefined): string {
  if (!state || state.kind === "loading") return "…";
  if (state.kind === "unknown") return "No branch";
  return state.detached ? `detached ${state.name}` : state.name;
}

/**
 * Fork (L-385): stands in for the composer's Branch control when the chat's
 * folder isn't a git repository but holds several (`rigorup-active/Teacher`,
 * `…/student_dash`). The chat works across all of them, so there is no one
 * branch to pick: the menu shows each repo's current branch, read when it
 * opens, and a row picks that repo for Changes and opens it, where branches
 * are switched.
 *
 * @param cwd The folder holding the repos; the Changes choice is kept per folder.
 * @param onShowChanges Opens the sidebar's Changes tab; rows only pick the repo without it.
 */
export function NestedReposChip({
  cwd,
  repos,
  enabled,
  onShowChanges,
  onClose,
}: {
  cwd: string;
  repos: readonly NestedRepo[];
  enabled: boolean;
  onShowChanges?: () => void;
  onClose?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<ReadonlyMap<string, BranchState>>(() => new Map());
  const anchor = useRef<HTMLDivElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const colorMode = useSyncExternalStore(subscribeRepoColorMode, loadRepoColorMode, loadRepoColorMode);
  const colors = useMemo(() => (colorMode === "off" ? undefined : repoColors(repos)), [colorMode, repos]);

  // Branches are read each time the menu opens, so a switch made in Changes
  // shows on the next open. A reply after the menu closed is dropped.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBranches(new Map(repos.map((repo) => [pathKey(repo.path), { kind: "loading" }])));
    for (const repo of repos) {
      gitBranches(repo.path).then(
        (result): BranchState =>
          result.current
            ? { kind: "branch", name: result.current, detached: result.detached }
            : { kind: "unknown" },
        (error: unknown): BranchState => {
          console.warn("Couldn't read the branch of a repository in the project", error);
          return { kind: "unknown" };
        },
      ).then((state) => {
        if (!live) return;
        setBranches((current) => new Map(current).set(pathKey(repo.path), state));
      });
    }
    return () => {
      live = false;
    };
  }, [open, repos]);

  const dismiss = () => {
    setOpen(false);
    onClose?.();
  };
  const pick = (path: string) => {
    chooseNestedRepo(cwd, path);
    setOpen(false);
    onShowChanges?.();
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = options.current.filter((node): node is HTMLButtonElement => !!node);
    const at = list.findIndex((node) => node === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };
  const label = `${repos.length} repos`;

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink">
      <GitPickerTrigger
        label={label}
        title={repos.map((repo) => repo.name).join(", ")}
        aria-label={`Repositories: ${repos.length}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? dismiss() : setOpen(true))}
      />
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={260}
          maxHeight={320}
          autoFocus
          onDismiss={dismiss}
          onKeyDown={moveFocus}
          role="dialog"
          aria-label="Repositories"
          className="flex flex-col overflow-hidden"
        >
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-content/45">
            Repositories in this folder
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5 pt-0">
            {repos.map((repo, index) => {
              const color = colors?.get(pathKey(repo.path));
              return (
                <button
                  key={repo.path}
                  ref={(node) => {
                    options.current[index] = node;
                  }}
                  type="button"
                  title={repo.path}
                  onClick={() => pick(repo.path)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-content/80 outline-none hover:bg-content/8 hover:text-content focus-visible:bg-content/8"
                >
                  {color ? (
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  ) : null}
                  <span className="min-w-0 shrink-0 truncate">{repo.name}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[12px] text-content/45">
                    {branchLabel(branches.get(pathKey(repo.path)))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-content/8 px-3 py-2 text-[11px] text-content/45">
            {onShowChanges ? "Open a repository in Changes to switch its branch." : "Switch branches in Changes."}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
