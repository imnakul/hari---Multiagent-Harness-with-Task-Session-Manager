/** The chat composer's pill trigger (model, access, project): one look in every composer. */
export function composerPillClass(open: boolean, extra?: string): string {
  return `flex h-6.5 ${extra ? `${extra} ` : ""}items-center gap-1 rounded-md px-1.5 ${
    open
      ? "bg-selection text-content"
      : "bg-selection text-content hover:bg-selection-hover"
  }`;
}
