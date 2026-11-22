import { listGithubWorkItems, type GithubWorkItem } from "./githubTasks";

/** Fork (L-380): how long a repository's rows in the Inbox pane count as fresh. */
export const SIDEBAR_INBOX_FRESH_MS = 2 * 60_000;

type Cached = { items: GithubWorkItem[]; fetchedAt: number };
const cache = new Map<string, Cached>();

export function readSidebarInboxCache(repo: string, now = Date.now()): GithubWorkItem[] | null {
  const hit = cache.get(repo);
  return hit && now - hit.fetchedAt < SIDEBAR_INBOX_FRESH_MS ? hit.items : null;
}

/** Rows kept for a repository even when stale, so a failed refresh can leave them showing. */
export function readSidebarInboxStale(repo: string): GithubWorkItem[] | null {
  return cache.get(repo)?.items ?? null;
}

export function clearSidebarInboxCache(): void {
  cache.clear();
}

/** Open pull requests and issues of the repository, newest update first. Throws if either call fails. */
export async function fetchSidebarInboxItems(cwd: string, repo: string): Promise<GithubWorkItem[]> {
  const query = { assignedToMe: false, state: "open", search: "" } as const;
  const [pulls, issues] = await Promise.all([
    listGithubWorkItems(cwd, repo, { ...query, kind: "pr" }),
    listGithubWorkItems(cwd, repo, { ...query, kind: "issue" }),
  ]);
  const items = [...pulls, ...issues].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  cache.set(repo, { items, fetchedAt: Date.now() });
  return items;
}
