/**
 * Copy and cut from the whiteboard's own buttons (fork, L-199). Writes the
 * same JSON Excalidraw puts on the clipboard, so Ctrl+V pastes it back.
 */
type ClipElement = {
  id: string;
  isDeleted?: boolean;
  containerId?: string | null;
  frameId?: string | null;
};

/** The selected elements plus their bound text and frame children. */
export function clipboardSelection<T extends ClipElement>(
  elements: readonly T[],
  selectedIds: Readonly<Record<string, boolean | undefined>>,
): T[] {
  const live = elements.filter((element) => !element.isDeleted);
  const picked = new Set(live.filter((element) => selectedIds[element.id]).map((element) => element.id));
  return live.filter(
    (element) =>
      picked.has(element.id) ||
      (!!element.containerId && picked.has(element.containerId)) ||
      (!!element.frameId && picked.has(element.frameId)),
  );
}

/** Files only for the images being copied. */
export function clipboardJson(
  elements: readonly (ClipElement & { fileId?: string | null })[],
  files: Readonly<Record<string, unknown>>,
): string {
  const used: Record<string, unknown> = {};
  for (const element of elements) {
    if (element.fileId && files[element.fileId]) used[element.fileId] = files[element.fileId];
  }
  return JSON.stringify({
    type: "excalidraw/clipboard",
    elements,
    ...(Object.keys(used).length ? { files: used } : {}),
  });
}
