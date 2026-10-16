import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type DataPayload = { id: string; data: string };
type ExitPayload = { id: string; code: number | null };

/**
 * The Rust backend implements PTYs on Unix (`fork`/`openpty`) and on Windows
 * (ConPTY via portable-pty), so spawns are attempted everywhere. The message
 * below survives for unknown platforms whose backend still rejects.
 * Must stay identical to the backend rejection in `src-tauri/src/pty.rs`.
 */
export const PTY_UNSUPPORTED_MESSAGE =
  "Terminals are supported on macOS and Linux.";

/** True on every platform with a PTY runtime (Unix + Windows). */
export const PTY_SUPPORTED = true;

/**
 * Remount guard for the unsupported notice. Terminal views remount whenever
 * their parent pane remounts (tab switches, layout restores), and each mount
 * would otherwise reprint the notice. Window-scoped: one notice per terminal
 * id per app launch is enough.
 */
const unsupportedNotified = new Set<string>();

/** Returns true on the first call per id (caller should print), false after. */
export function markUnsupportedNotified(id: string): boolean {
  if (unsupportedNotified.has(id)) return false;
  unsupportedNotified.add(id);
  return true;
}

type DataHandler = (data: Uint8Array, start: number) => void;
type ExitHandler = (code: number | null) => void;

const dataHandlers = new Map<string, DataHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const dataBuffer = new Map<string, Uint8Array[]>();
const dataBufferStarts = new Map<string, number[]>();
const dataBufferBytes = new Map<string, number>();
/** Total bytes delivered to this page per PTY id. The terminal view keeps its
 * own synced offset against this to detect and recover stalled delivery. */
const bytesSeen = new Map<string, number>();
/** PTYs this window opened. Global `pty-data` still fires for every terminal
 * in the process; decoding those in a window that never mounted them was
 * megabytes of base64 work and a 256KB replay buffer per stranger id. */
const openedPtys = new Set<string>();

/**
 * Replay budget for a PTY whose view is not mounted. Chunks arrive at up to
 * 32KB each, so a count-based cap let one unsubscribed terminal retain
 * megabytes; bound the bytes instead. Whole chunks are dropped oldest-first.
 */
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_BUFFERED = 200;
let bridge: Promise<UnlistenFn[]> | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Same as decodeBase64, but a payload the backend never actually sends
 * malformed should not throw inside the pty-data listener and lose the
 * chunk (and whatever else was queued behind it). Returns null instead.
 */
export function decodePtyChunk(data: string): Uint8Array | null {
  try {
    return decodeBase64(data);
  } catch {
    return null;
  }
}

/**
 * Leading chunks to drop to bring a replay buffer back within budget, and the
 * byte total that remains. Never drops the newest chunk, even when that chunk
 * alone exceeds the budget — replaying something beats replaying nothing.
 */
export function trimReplay(
  sizes: number[],
  bytes: number,
): { drop: number; bytes: number } {
  let drop = 0;
  let left = bytes;
  while (
    drop < sizes.length - 1 &&
    (left > MAX_BUFFERED_BYTES || sizes.length - drop > MAX_BUFFERED)
  ) {
    left -= sizes[drop];
    drop += 1;
  }
  return { drop, bytes: left };
}

function pushBuffered(id: string, chunk: Uint8Array, start: number) {
  const queued = dataBuffer.get(id) ?? [];
  queued.push(chunk);
  const starts = dataBufferStarts.get(id) ?? [];
  starts.push(start);
  dataBufferStarts.set(id, starts);
  const trimmed = trimReplay(
    queued.map((entry) => entry.byteLength),
    (dataBufferBytes.get(id) ?? 0) + chunk.byteLength,
  );
  if (trimmed.drop > 0) {
    queued.splice(0, trimmed.drop);
    starts.splice(0, trimmed.drop);
  }
  dataBuffer.set(id, queued);
  dataBufferBytes.set(id, trimmed.bytes);
}

function clearBuffered(id: string) {
  dataBuffer.delete(id);
  dataBufferStarts.delete(id);
  dataBufferBytes.delete(id);
}

function ensureBridge() {
  if (bridge) return;
  bridge = Promise.all([
    listen<DataPayload>("pty-data", (event) => {
      const { id, data } = event.payload;
      const handler = dataHandlers.get(id);
      if (!handler && !openedPtys.has(id)) return;
      const chunk = decodePtyChunk(data);
      if (!chunk) return;
      const start = bytesSeen.get(id) ?? 0;
      bytesSeen.set(id, start + chunk.byteLength);
      if (handler) handler(chunk, start);
      else pushBuffered(id, chunk, start);
    }),
    listen<ExitPayload>("pty-exit", (event) => {
      const { id, code } = event.payload;
      exitHandlers.get(id)?.(code);
    }),
  ]);
}

function retain() {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0 || !bridge) return;
  const pending = bridge;
  teardownTimer = setTimeout(() => {
    teardownTimer = undefined;
    if (users > 0) return;
    bridge = null;
    void pending.then((fns) => fns.forEach((fn) => fn()));
  }, 500);
}

export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("pty_spawn", { id, cwd, cols, rows });
}

export async function writePty(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

export async function resizePty(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("pty_resize", { id, cols, rows });
}

export async function getPtyStatus(
  id: string,
): Promise<{ foreground: string | null }> {
  return invoke<{ foreground: string | null }>("pty_status", { id });
}

export async function killPty(id: string): Promise<void> {
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  openedPtys.delete(id);
  bytesSeen.delete(id);
  clearBuffered(id);
  await invoke("pty_kill", { id }).catch(() => undefined);
}

export async function killAllPtys(): Promise<void> {
  dataHandlers.clear();
  exitHandlers.clear();
  openedPtys.clear();
  bytesSeen.clear();
  dataBuffer.clear();
  dataBufferStarts.clear();
  dataBufferBytes.clear();
  await invoke("pty_kill_all").catch(() => undefined);
}

export type PtyReplayChunk = {
  /** Absolute offset of `data` within the session's full output. */
  start: number;
  /** Total bytes the session has ever produced (backend side). */
  total: number;
  data: Uint8Array;
};

/**
 * Everything the PTY produced past `offset`, for recovering output that was
 * emitted while the webview was throttled and the live `pty-data` events were
 * stalled or lost. Returns an empty `data` when the caller is current.
 */
export async function ptyReplayFrom(
  id: string,
  offset: number,
): Promise<PtyReplayChunk> {
  const res = await invoke<{ start: number; total: number; data: string }>(
    "pty_replay",
    { id, offset },
  );
  return { start: res.start, total: res.total, data: decodeBase64(res.data) };
}

export function subscribePty(
  id: string,
  onData: DataHandler,
  onExit: ExitHandler,
  options?: { fresh?: boolean },
): () => void {
  // Only fresh process owners reset offsets. Reattaching a view must retain them.
  if (options?.fresh) {
    bytesSeen.delete(id);
    clearBuffered(id);
  }
  retain();
  openedPtys.add(id);
  dataHandlers.set(id, onData);
  exitHandlers.set(id, onExit);
  const queued = dataBuffer.get(id);
  if (queued) {
    const starts = dataBufferStarts.get(id) ?? [];
    clearBuffered(id);
    queued.forEach((chunk, index) => onData(chunk, starts[index] ?? 0));
  }
  return () => {
    if (dataHandlers.get(id) === onData) dataHandlers.delete(id);
    if (exitHandlers.get(id) === onExit) exitHandlers.delete(id);
    release();
  };
}
