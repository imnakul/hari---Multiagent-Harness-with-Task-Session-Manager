import type { CSSProperties } from "react";
import type { NestedRepo } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import {
  colorSurfaceStyle,
  createColorSurfaceSetting,
  type ColorSurfaceStyle,
} from "../../../shared/ui/colorSurface";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";

/**
 * Fork (L-372, L-374): how the Explorer marks each repository inside a folder
 * that holds several (L-370). Same choices as session and project groups.
 * Older builds saved "both" (tint and bar).
 */
export type RepoColorMode = ColorSurfaceStyle;

const repoSetting = createColorSurfaceSetting("monocode.repoColorMode", "tint", {
  both: "tint-bar",
});

export const loadRepoColorMode = repoSetting.load;
export const saveRepoColorMode = repoSetting.save;
export const subscribeRepoColorMode = repoSetting.subscribe;

/**
 * Colour of each repo, by its place in the name-sorted list, so the Explorer
 * and the Changes switcher agree. The grey first palette entry is skipped: it
 * reads as "no colour".
 */
export function repoColors(repos: readonly NestedRepo[]): Map<string, string> {
  const palette = TAB_GROUP_COLORS.slice(1);
  return new Map(
    repos.map((repo, index) => [pathKey(repo.path), palette[index % palette.length]]),
  );
}

/** Style for a repo's Explorer subtree. */
export function repoColorStyle(
  color: string | undefined,
  mode: RepoColorMode,
): CSSProperties | undefined {
  return colorSurfaceStyle(color, mode);
}
