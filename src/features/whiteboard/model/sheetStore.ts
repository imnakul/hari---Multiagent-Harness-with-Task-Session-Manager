import {
  ensureWhiteboardDir,
  movePath,
  readTextFile,
  revealPath,
  statFiles,
  writeTextFile,
} from "../../../platform/tauri/fs";
import {
  parseChatHistory,
  serializeChatHistory,
  type WhiteboardChatMessage,
} from "./whiteboardAgent";
import {
  parseWhiteboardIndex,
  serializeWhiteboardIndex,
  sheetChatPath,
  sheetScenePath,
  WHITEBOARD_INDEX_FILE,
  WHITEBOARD_TRASH_DIR,
  type WhiteboardIndex,
  type WhiteboardSheet,
} from "./sheets";

/** Whiteboard files under `~/.monocode/whiteboards` (fork, L-194). */
let dirPromise: Promise<string> | undefined;

export function whiteboardDir(): Promise<string> {
  dirPromise ??= ensureWhiteboardDir().catch((error) => {
    dirPromise = undefined;
    throw error;
  });
  return dirPromise;
}

async function exists(path: string): Promise<boolean> {
  const [entry] = await statFiles([path]);
  return entry?.mtimeMs != null;
}

/** A missing index is an empty one; a broken file is read as empty too. */
export async function loadWhiteboardIndex(): Promise<WhiteboardIndex> {
  const dir = await whiteboardDir();
  const path = `${dir}/${WHITEBOARD_INDEX_FILE}`;
  if (!(await exists(path))) return parseWhiteboardIndex(undefined);
  return parseWhiteboardIndex(await readTextFile(path));
}

export async function saveWhiteboardIndex(index: WhiteboardIndex): Promise<void> {
  const dir = await whiteboardDir();
  await writeTextFile(`${dir}/${WHITEBOARD_INDEX_FILE}`, serializeWhiteboardIndex(index));
}

/**
 * The scene file's text, or null for a sheet that was never saved. A read
 * error is thrown so the caller can hold saving instead of overwriting it.
 */
export async function loadSheetScene(sheet: WhiteboardSheet): Promise<string | null> {
  const dir = await whiteboardDir();
  const path = sheetScenePath(dir, sheet.id);
  if (!sheet.saved && !(await exists(path))) return null;
  return readTextFile(path);
}

export async function saveSheetScene(id: string, json: string): Promise<void> {
  const dir = await whiteboardDir();
  await writeTextFile(sheetScenePath(dir, id), json);
}

export async function loadSheetChat(id: string): Promise<WhiteboardChatMessage[]> {
  const dir = await whiteboardDir();
  const path = sheetChatPath(dir, id);
  if (!(await exists(path))) return [];
  try {
    return parseChatHistory(await readTextFile(path));
  } catch {
    return [];
  }
}

export async function saveSheetChat(
  id: string,
  messages: readonly WhiteboardChatMessage[],
): Promise<void> {
  const dir = await whiteboardDir();
  await writeTextFile(sheetChatPath(dir, id), serializeChatHistory(messages));
}

/** Moves the sheet's files into `.trash`, so a delete can be undone by hand. */
export async function trashSheetFiles(id: string): Promise<void> {
  const dir = await whiteboardDir();
  const trash = `${dir}/${WHITEBOARD_TRASH_DIR}`;
  for (const path of [sheetScenePath(dir, id), sheetChatPath(dir, id)]) {
    if (await exists(path)) await movePath(path, trash);
  }
}

export async function revealWhiteboardDir(): Promise<void> {
  const dir = await whiteboardDir();
  await revealPath(`${dir}/${WHITEBOARD_INDEX_FILE}`).catch(() => revealPath(dir));
}
