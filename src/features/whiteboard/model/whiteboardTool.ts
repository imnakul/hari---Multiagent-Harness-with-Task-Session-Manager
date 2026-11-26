import { cleanSheetName } from "./sheets";
import { describeScene, parseWhiteboardOps, type SceneElementLike, type WhiteboardOps } from "./whiteboardAgent";

/**
 * Fork (L-394): the `whiteboard.draw` app CLI action. Any chat with app access
 * (Operator, or the Whiteboard item in the composer's + menu) can draw on the
 * Whiteboard: a new sheet by default, or a sheet it drew before by id. The
 * drawing format is the Whiteboard agent's own ops (`parseWhiteboardOps`).
 */

export type WhiteboardDrawInput = {
  /** Name for a new sheet; ignored with `sheetId`. */
  name?: string;
  /** Draw on this existing sheet instead of making a new one. */
  sheetId?: string;
  ops: WhiteboardOps;
};

export type WhiteboardDrawResult = {
  sheetId: string;
  name: string;
  created: boolean;
  /** What happened to the drawing, as the Whiteboard chat would say it. */
  note: string;
};

const SHEET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates the CLI input. Throws a message the calling agent can act on. */
export function parseWhiteboardDrawInput(input: Record<string, unknown>): WhiteboardDrawInput {
  const { name, sheetId, ops } = input;
  if (name !== undefined && typeof name !== "string") throw new Error("name must be a string.");
  if (sheetId !== undefined && (typeof sheetId !== "string" || !SHEET_ID.test(sheetId)))
    throw new Error("sheetId must be the id a previous whiteboard.draw returned.");
  const parsed = parseWhiteboardOps(ops);
  if (!parsed || (!parsed.clear && !parsed.add.length && !parsed.update.length && !parsed.remove.length))
    throw new Error(
      'ops must be an object like {"add":[{"type":"rectangle","id":"a","x":0,"y":0,"width":180,"height":70,"label":"Start"}]} with at least one valid change. Run --help for the element format.',
    );
  const cleanName = typeof name === "string" ? cleanSheetName(name) : "";
  return {
    ...(cleanName && !sheetId ? { name: cleanName } : {}),
    ...(sheetId ? { sheetId } : {}),
    ops: parsed,
  };
}

/** Instructions added to a turn sent with the Whiteboard item on. */
export function whiteboardToolContext(cli: string): string {
  return [
    "<monocode_whiteboard>",
    `The user turned on the Whiteboard for this message: show the visual they ask for (diagram, flow, architecture, mind map, wireframe, timeline) by drawing it on MonoCode's Whiteboard with \`${cli} whiteboard.draw\`. Run \`${cli} --help\` once for the element format.`,
    'One call makes a new sheet, opens it on the Whiteboard and draws: {"name":"Sign-in flow","ops":{"add":[...]}}. It returns the sheetId; pass {"sheetId":"...","ops":{...}} to change that sheet later (update or remove by element id, or add more).',
    "Give every shape an id and join them with arrows by id. Leave about 60px between shapes; a normal box is about 180x70. At most 60 new elements per call; split bigger drawings over several calls to the same sheet.",
    "Reply briefly with what you drew; do not repeat the element JSON in chat.",
    "</monocode_whiteboard>",
  ].join("\n");
}

/** Fork (L-403): `whiteboard.read`. Without a sheetId it lists the sheets. */
export type WhiteboardReadInput = { sheetId?: string };

export type WhiteboardReadResult =
  | { sheets: { sheetId: string; name: string; locked: boolean }[] }
  | {
      sheetId: string;
      name: string;
      locked: boolean;
      /** One line per element: id, type, position, size, label, colours (see describeScene). */
      elements: string[];
    };

export function parseWhiteboardReadInput(input: Record<string, unknown>): WhiteboardReadInput {
  const { sheetId } = input;
  if (sheetId === undefined) return {};
  if (typeof sheetId !== "string" || !SHEET_ID.test(sheetId))
    throw new Error("sheetId must be a sheet id from whiteboard.read or whiteboard.draw.");
  return { sheetId };
}

/** Reads a saved Excalidraw scene's elements; anything unreadable is an empty sheet. */
export function sceneElementsFromJson(json: string | null): SceneElementLike[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null) return [];
    const elements: unknown = Reflect.get(value, "elements");
    if (!Array.isArray(elements)) return [];
    return elements.filter(
      (element): element is SceneElementLike =>
        typeof element === "object" &&
        element !== null &&
        typeof Reflect.get(element, "id") === "string" &&
        typeof Reflect.get(element, "type") === "string",
    );
  } catch {
    return [];
  }
}

/** The lines `whiteboard.read` returns for a sheet. */
export function describeSheetForAgent(elements: readonly SceneElementLike[]): string[] {
  const lines = describeScene(elements);
  return lines.length ? lines : ["(the sheet is empty)"];
}

/**
 * Instructions for a turn in a sheet's own chat (L-403). Its app actions are
 * limited to `whiteboard.*`, and they default to this sheet.
 */
export function whiteboardSheetChatContext(cli: string, sheetId: string): string {
  return [
    "<monocode_whiteboard_sheet>",
    `This chat belongs to one sheet on MonoCode's Whiteboard (sheetId "${sheetId}"). The user sees the sheet beside this chat.`,
    `Before changing the drawing, see what is on it with \`${cli} whiteboard.read\` (one line per element: id, type, x, y, width, height, label, colours). Draw with \`${cli} whiteboard.draw\` and {"ops":{...}}: both act on this sheet when sheetId is left out. Run \`${cli} --help\` once for the element format.`,
    "Update or remove existing elements by id instead of drawing them again. Give every new shape an id and join shapes with arrows by id. Leave about 60px between shapes; a normal box is about 180x70. At most 60 new elements per call.",
    "Only whiteboard.* app actions work in this chat. Read attached files and images yourself, and turn them into a drawing when the user asks.",
    "Reply briefly with what you drew; do not repeat the element JSON in chat.",
    "</monocode_whiteboard_sheet>",
  ].join("\n");
}

type DrawServer = (input: WhiteboardDrawInput) => Promise<WhiteboardDrawResult>;
type ReadServer = (input: WhiteboardReadInput) => Promise<WhiteboardReadResult>;
type Handlers = { draw: DrawServer; read: ReadServer };
type Waiting = {
  run: (handlers: Handlers) => Promise<unknown>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let server: Handlers | null = null;
const waiting: Waiting[] = [];

/** How long a draw waits for the Whiteboard to open and load its sheet list. */
export const WHITEBOARD_OPEN_TIMEOUT_MS = 20_000;

function serve(entry: Waiting, handlers: Handlers): void {
  clearTimeout(entry.timer);
  entry.run(handlers).then(entry.resolve, (cause: unknown) =>
    entry.reject(cause instanceof Error ? cause : new Error(String(cause))),
  );
}

/** Queues a call until the Whiteboard serves, failing with `timeoutMessage` after `timeoutMs`. */
function whenServing<T>(
  run: (handlers: Handlers) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const entry: Waiting = {
      run,
      // `run` produced this value, so it is a T.
      resolve: (result) => resolve(result as T),
      reject,
      timer: setTimeout(() => {
        const at = waiting.indexOf(entry);
        if (at < 0) return;
        waiting.splice(at, 1);
        reject(new Error(timeoutMessage));
      }, timeoutMs),
    };
    if (server) serve(entry, server);
    else waiting.push(entry);
  });
}

/**
 * Hands a draw to the Whiteboard. The Whiteboard loads on first open, so a
 * draw made before then waits (up to the timeout) for it to start serving.
 */
export function requestWhiteboardDraw(
  input: WhiteboardDrawInput,
  timeoutMs = WHITEBOARD_OPEN_TIMEOUT_MS,
): Promise<WhiteboardDrawResult> {
  return whenServing(
    (handlers) => handlers.draw(input),
    timeoutMs,
    "The Whiteboard didn't open in time, so nothing was drawn. Try again.",
  );
}

/** Fork (L-403): reads one sheet, or lists them, once the Whiteboard serves. */
export function requestWhiteboardRead(
  input: WhiteboardReadInput,
  timeoutMs = WHITEBOARD_OPEN_TIMEOUT_MS,
): Promise<WhiteboardReadResult> {
  return whenServing(
    (handlers) => handlers.read(input),
    timeoutMs,
    "The Whiteboard didn't open in time, so the sheet couldn't be read. Try again.",
  );
}

/** The Whiteboard serves draws and reads while it is mounted. Returns the stop call. */
export function serveWhiteboard(handlers: Handlers): () => void {
  server = handlers;
  for (const entry of waiting.splice(0)) serve(entry, handlers);
  return () => {
    if (server === handlers) server = null;
  };
}

/** True while the Whiteboard view is mounted and answering draws and reads. */
export function isWhiteboardServing(): boolean {
  return server !== null;
}
