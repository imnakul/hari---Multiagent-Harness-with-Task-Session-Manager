import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { gitNestedRepos, type NestedRepo } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";

const CHOICE_KEY = "monocode.nestedRepoChoice";
const listeners = new Set<() => void>();
let choices: Record<string, string> = readChoices();

function readChoices(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** The repo Changes works on: the one picked for this folder, else the first. */
export function chosenNestedRepo(
  repos: readonly NestedRepo[],
  saved: string | undefined,
): NestedRepo | undefined {
  return repos.find((repo) => saved && pathKey(repo.path) === pathKey(saved)) ?? repos[0];
}

export function chooseNestedRepo(folder: string, repo: string): void {
  choices = { ...choices, [pathKey(folder)]: repo };
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choices));
  } catch {
    // Kept for this run only when storage is full or blocked.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Fork (L-370): for a project folder that isn't a git repository but holds
 * some (`rigorup-active/Teacher`, `…/student_dash`), the repos and the one
 * Changes and History work on. `repoCwd` is `cwd` itself otherwise, so
 * callers can always use it. Looked up again when the folder changes or on
 * `refresh` (the repo picker opening), so a repo cloned meanwhile appears.
 */
export function useNestedRepos(
  cwd: string,
  enabled: boolean,
): { repos: NestedRepo[]; repoCwd: string; refresh: () => void } {
  const [found, setFound] = useState<{ cwd: string; repos: NestedRepo[] }>({ cwd, repos: [] });
  const [lookup, setLookup] = useState(0);
  const refresh = useCallback(() => setLookup((count) => count + 1), []);
  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") return;
    let live = true;
    gitNestedRepos(cwd).then(
      (repos) => {
        if (live) setFound({ cwd, repos });
      },
      (error: unknown) => {
        console.warn("Couldn't look for repositories inside the project", error);
        if (live) setFound({ cwd, repos: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [cwd, enabled, lookup]);
  const saved = useSyncExternalStore(
    subscribe,
    () => choices[pathKey(cwd)],
    () => choices[pathKey(cwd)],
  );
  const repos = found.cwd === cwd ? found.repos : [];
  return { repos, repoCwd: chosenNestedRepo(repos, saved)?.path ?? cwd, refresh };
}
