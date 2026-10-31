import type { WhiteboardChatMessage, WhiteboardOps } from "./whiteboardAgent";

/**
 * Fork (L-223): Whiteboard agent runs live here, outside the chat panel, so
 * they keep going when you switch sheets, close the chat or leave the
 * Whiteboard. The reply is saved to its sheet's chat; drawing changes wait
 * until that sheet's canvas is open again.
 */

/** Note on a reply whose drawing is waiting for its sheet to open. */
export const WAITING_NOTE = "Draws when you open this sheet";

type Draw = (ops: WhiteboardOps) => string | null;

const running = new Map<string, AbortController>();
const pending = new Map<string, { ops: WhiteboardOps; at: number }>();
const canvases = new Map<string, Draw>();
/** The newest chat for a sheet, ahead of the save on disk. */
const chats = new Map<string, WhiteboardChatMessage[]>();
const runListeners = new Set<() => void>();
const chatListeners = new Set<(id: string, messages: WhiteboardChatMessage[]) => void>();

const notifyRuns = () => runListeners.forEach((listener) => listener());

export function subscribeRuns(listener: () => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

export function isRunning(sheetId: string): boolean {
  return running.has(sheetId);
}

export function startRun(sheetId: string, controller: AbortController): void {
  running.get(sheetId)?.abort();
  running.set(sheetId, controller);
  notifyRuns();
}

export function endRun(sheetId: string, controller: AbortController): void {
  if (running.get(sheetId) !== controller) return;
  running.delete(sheetId);
  notifyRuns();
}

/** Stop button, or the sheet was deleted. */
export function stopRun(sheetId: string): void {
  const controller = running.get(sheetId);
  if (!controller) return;
  controller.abort();
  running.delete(sheetId);
  notifyRuns();
}

/** A sheet's chat changed: tell the open chat panel and remember it. */
export function publishChat(sheetId: string, messages: WhiteboardChatMessage[]): void {
  chats.set(sheetId, messages);
  chatListeners.forEach((listener) => listener(sheetId, messages));
}

/** The chat as last published, if newer than what is on disk. */
export function publishedChat(sheetId: string): WhiteboardChatMessage[] | undefined {
  return chats.get(sheetId);
}

export function subscribeChats(listener: (id: string, messages: WhiteboardChatMessage[]) => void): () => void {
  chatListeners.add(listener);
  return () => {
    chatListeners.delete(listener);
  };
}

/** The open sheet's canvas, ready to draw. Returns the unregister call. */
export function registerCanvas(sheetId: string, draw: Draw): () => void {
  canvases.set(sheetId, draw);
  return () => {
    if (canvases.get(sheetId) === draw) canvases.delete(sheetId);
  };
}

/**
 * Draws now when the sheet is open, otherwise keeps the changes for later.
 * Returns the note for the reply.
 */
export function drawOrQueue(sheetId: string, ops: WhiteboardOps, at: number): string {
  const draw = canvases.get(sheetId);
  if (draw) return draw(ops) ?? "Nothing to change";
  pending.set(sheetId, { ops, at });
  return WAITING_NOTE;
}

/** Changes waiting for this sheet, removed as they are handed over. */
export function takePending(sheetId: string): { ops: WhiteboardOps; at: number } | undefined {
  const waiting = pending.get(sheetId);
  pending.delete(sheetId);
  return waiting;
}

/** The sheet was deleted: drop what it was waiting for. */
export function forgetSheet(sheetId: string): void {
  stopRun(sheetId);
  pending.delete(sheetId);
  chats.delete(sheetId);
}

/** Replaces the waiting note on the reply sent at `at`. */
export function withDrawnNote(
  messages: WhiteboardChatMessage[],
  at: number,
  note: string,
): WhiteboardChatMessage[] {
  return messages.map((message) =>
    message.role === "assistant" && message.at === at && message.note === WAITING_NOTE
      ? { ...message, note }
      : message,
  );
}
