import { pathKey } from "../../../shared/lib/paths";

/** How many other projects a missing file is looked for in. */
const MAX_RELATED_ROOTS = 6;

/**
 * Fork (L-369): other MonoCode projects where a file an agent names may live
 * when it isn't in `cwd`. An agent working in `rigorup-active/Teacher` writes
 * `MANUAL_CHECKS.md` for a file in `rigorup-active/docs/…`: the folder that
 * holds the project comes first (closest first), then projects sharing a
 * sidebar group with it or with that folder. Only known projects are
 * searched, never arbitrary parent folders, so a reference can't trigger a
 * walk of a whole drive.
 */
export function relatedProjectRoots(
  cwd: string,
  projects: readonly string[],
  assignments: Readonly<Record<string, string>>,
): string[] {
  const here = pathKey(cwd);
  if (!here || here === "~" || here === "/") return [];
  const contains = (outer: string, inner: string) =>
    inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);

  const ancestors = projects
    .filter((path) => contains(pathKey(path), here))
    .sort((a, b) => pathKey(b).length - pathKey(a).length);
  // `cwd` may be a worktree or subfolder of a project: its group is the one
  // of the project that holds it.
  const owners = [
    ...projects.filter((path) => pathKey(path) === here),
    ...ancestors,
  ];
  const groups = new Set(
    owners
      .map((path) => assignments[pathKey(path)])
      .filter((group): group is string => Boolean(group)),
  );
  const siblings = projects.filter((path) => {
    const group = assignments[pathKey(path)];
    return Boolean(group && groups.has(group));
  });

  const out: string[] = [];
  const seen = new Set([here]);
  for (const path of [...ancestors, ...siblings]) {
    const key = pathKey(path);
    // Inside cwd is already covered by cwd's own listing.
    if (seen.has(key) || contains(here, key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length === MAX_RELATED_ROOTS) break;
  }
  return out;
}
