/**
 * Whiteboard sheets (fork, L-194): an index of named sheets, each saved as
 * `<dir>/<id>.excalidraw`, with its agent chat in `<dir>/<id>.chat.json`.
 */
export type WhiteboardSheet = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** View only: no drawing, no agent changes. */
  locked: boolean;
  /** Set once the scene file has been written; a new sheet has none yet. */
  saved: boolean;
};

export type WhiteboardIndex = {
  version: 1;
  sheets: WhiteboardSheet[];
  lastOpenedId?: string;
};

export const WHITEBOARD_INDEX_FILE = "index.json";
export const WHITEBOARD_TRASH_DIR = ".trash";
const NAME_LIMIT = 80;

export function emptyWhiteboardIndex(): WhiteboardIndex {
  return { version: 1, sheets: [] };
}

function isSheet(value: unknown): value is WhiteboardSheet {
  if (!value || typeof value !== "object") return false;
  const sheet = value as Record<string, unknown>;
  return (
    typeof sheet.id === "string" &&
    /^[A-Za-z0-9_-]{1,64}$/.test(sheet.id) &&
    typeof sheet.name === "string" &&
    typeof sheet.createdAt === "number" &&
    typeof sheet.updatedAt === "number"
  );
}

/** A broken or missing index reads as empty; bad rows are dropped. */
export function parseWhiteboardIndex(raw: string | null | undefined): WhiteboardIndex {
  if (!raw) return emptyWhiteboardIndex();
  try {
    const data = JSON.parse(raw) as { sheets?: unknown; lastOpenedId?: unknown };
    const seen = new Set<string>();
    const sheets = (Array.isArray(data.sheets) ? data.sheets : [])
      .filter(isSheet)
      .filter((sheet) => (seen.has(sheet.id) ? false : (seen.add(sheet.id), true)))
      .map((sheet) => ({
        id: sheet.id,
        name: cleanSheetName(sheet.name) || "Untitled",
        createdAt: sheet.createdAt,
        updatedAt: sheet.updatedAt,
        locked: sheet.locked === true,
        saved: sheet.saved !== false,
      }));
    const lastOpenedId =
      typeof data.lastOpenedId === "string" && seen.has(data.lastOpenedId)
        ? data.lastOpenedId
        : undefined;
    return { version: 1, sheets, ...(lastOpenedId ? { lastOpenedId } : {}) };
  } catch {
    return emptyWhiteboardIndex();
  }
}

export function serializeWhiteboardIndex(index: WhiteboardIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function cleanSheetName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT);
}

/** "Sheet 1", then the next free number. */
export function nextSheetName(sheets: readonly WhiteboardSheet[]): string {
  const taken = new Set(sheets.map((sheet) => sheet.name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const name = `Sheet ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function createSheet(
  index: WhiteboardIndex,
  id: string,
  now: number,
  name?: string,
): { index: WhiteboardIndex; sheet: WhiteboardSheet } {
  const sheet: WhiteboardSheet = {
    id,
    name: (name && cleanSheetName(name)) || nextSheetName(index.sheets),
    createdAt: now,
    updatedAt: now,
    locked: false,
    saved: false,
  };
  return {
    index: { ...index, sheets: [...index.sheets, sheet], lastOpenedId: id },
    sheet,
  };
}

function patchSheet(
  index: WhiteboardIndex,
  id: string,
  patch: (sheet: WhiteboardSheet) => WhiteboardSheet,
): WhiteboardIndex {
  let changed = false;
  const sheets = index.sheets.map((sheet) => {
    if (sheet.id !== id) return sheet;
    const next = patch(sheet);
    if (next !== sheet) changed = true;
    return next;
  });
  return changed ? { ...index, sheets } : index;
}

/** An empty name keeps the old one. */
export function renameSheet(
  index: WhiteboardIndex,
  id: string,
  name: string,
  now: number,
): WhiteboardIndex {
  const clean = cleanSheetName(name);
  return patchSheet(index, id, (sheet) =>
    !clean || clean === sheet.name ? sheet : { ...sheet, name: clean, updatedAt: now },
  );
}

export function setSheetLocked(
  index: WhiteboardIndex,
  id: string,
  locked: boolean,
): WhiteboardIndex {
  return patchSheet(index, id, (sheet) =>
    sheet.locked === locked ? sheet : { ...sheet, locked },
  );
}

export function markSheetSaved(
  index: WhiteboardIndex,
  id: string,
  now: number,
): WhiteboardIndex {
  return patchSheet(index, id, (sheet) => ({ ...sheet, saved: true, updatedAt: now }));
}

export function openSheet(index: WhiteboardIndex, id: string): WhiteboardIndex {
  return index.lastOpenedId === id || !index.sheets.some((sheet) => sheet.id === id)
    ? index
    : { ...index, lastOpenedId: id };
}

/** Drops the sheet; the next one to show is the most recently edited. */
export function removeSheet(
  index: WhiteboardIndex,
  id: string,
): { index: WhiteboardIndex; nextId?: string } {
  const sheets = index.sheets.filter((sheet) => sheet.id !== id);
  const nextId =
    index.lastOpenedId && index.lastOpenedId !== id
      ? index.lastOpenedId
      : sortedSheets(sheets)[0]?.id;
  return { index: { version: 1, sheets, ...(nextId ? { lastOpenedId: nextId } : {}) }, nextId };
}

/** Most recently edited first. */
export function sortedSheets(sheets: readonly WhiteboardSheet[]): WhiteboardSheet[] {
  return [...sheets].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export function sheetScenePath(dir: string, id: string): string {
  return `${dir}/${id}.excalidraw`;
}

export function sheetChatPath(dir: string, id: string): string {
  return `${dir}/${id}.chat.json`;
}

/** A file name for exports: the sheet name without characters Windows forbids. */
export function exportFileName(name: string, extension: string): string {
  const base = cleanSheetName(name)
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/[. ]+$/, "")
    .trim();
  return `${base || "Whiteboard"}.${extension}`;
}

export function newSheetId(random: () => number = Math.random, now = Date.now()): string {
  const tail = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `wb-${now.toString(36)}-${tail}`;
}
