import { cleanSheetName } from "./sheets";
import { parseWhiteboardOps, type WhiteboardOps } from "./whiteboardAgent";

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

type DrawServer = (input: WhiteboardDrawInput) => Promise<WhiteboardDrawResult>;
type Waiting = {
  input: WhiteboardDrawInput;
  resolve: (result: WhiteboardDrawResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let server: DrawServer | null = null;
const waiting: Waiting[] = [];

/** How long a draw waits for the Whiteboard to open and load its sheet list. */
export const WHITEBOARD_OPEN_TIMEOUT_MS = 20_000;

function serve(request: Waiting, handler: DrawServer): void {
  clearTimeout(request.timer);
  handler(request.input).then(request.resolve, (cause: unknown) =>
    request.reject(cause instanceof Error ? cause : new Error(String(cause))),
  );
}

/**
 * Hands a draw to the Whiteboard. The Whiteboard loads on first open, so a
 * draw made before then waits (up to the timeout) for it to start serving.
 */
export function requestWhiteboardDraw(
  input: WhiteboardDrawInput,
  timeoutMs = WHITEBOARD_OPEN_TIMEOUT_MS,
): Promise<WhiteboardDrawResult> {
  return new Promise((resolve, reject) => {
    const request: Waiting = {
      input,
      resolve,
      reject,
      timer: setTimeout(() => {
        const at = waiting.indexOf(request);
        if (at < 0) return;
        waiting.splice(at, 1);
        reject(new Error("The Whiteboard didn't open in time, so nothing was drawn. Try again."));
      }, timeoutMs),
    };
    if (server) serve(request, server);
    else waiting.push(request);
  });
}

/** The Whiteboard serves draws while it is mounted. Returns the stop call. */
export function serveWhiteboardDraws(handler: DrawServer): () => void {
  server = handler;
  for (const request of waiting.splice(0)) serve(request, handler);
  return () => {
    if (server === handler) server = null;
  };
}
