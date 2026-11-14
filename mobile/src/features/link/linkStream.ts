import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
  closeWatch,
  makeCommandId,
  nextUpdates,
  openWatch,
  type Pairing,
} from "@/features/connection/nativeLink";
import { onLiveEvent, setLiveStreamLive } from "@/features/liveUpdates/nativeLive";

import {
  addToOutbox,
  parseCursor,
  parseLinkFrame,
  parseOutbox,
  parseSendAnswer,
  readFrames,
  retryDelay,
  settleOutbox,
  OUTBOX_BATCH,
  type LinkCursor,
  type LinkFrame,
  type LinkItem,
  type OutboxItem,
  type SendAnswer,
} from "./linkProtocol";

// Fork (Hari, L-277): the phone's end of the always-open event stream. While
// paired, one `events.watch` stays open: in view on the usual connection, and
// in the background (with "Keep watching in the background" on) on a quiet one
// that pings every 20 s. Items from the computer run once each, in order, and
// are acked; signals go to whoever listens. The phone's own outbox goes out
// with `events.send` whenever the stream comes up, and keeps what didn't.

export type LinkStreamState =
  | { phase: "off" }
  | { phase: "connecting" }
  | { phase: "live" }
  | { phase: "retrying"; error: string }
  /** The computer runs a MonoCode from before the stream. */
  | { phase: "unsupported" };

type Command = <T>(method: string, params?: object, id?: string) => Promise<T>;

const UNSUPPORTED = "Unsupported mobile operation";
/** How long one pull waits for news: the heartbeat comes sooner. */
const PULL_MS = { view: 10_000, quiet: 25_000 } as const;
/** An older computer is asked again this rarely. */
const UNSUPPORTED_RETRY_MS = 5 * 60_000;

let state: LinkStreamState = { phase: "off" };
const stateListeners = new Set<() => void>();

function setState(next: LinkStreamState) {
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  setLiveStreamLive(next.phase === "live");
  for (const listener of stateListeners) listener();
}

export function linkStreamState(): LinkStreamState {
  return state;
}

/** Whether the stream is open now: news arrives on it, so polling can slow. */
export function linkStreamLive(): boolean {
  return state.phase === "live";
}

export function useLinkStream(): LinkStreamState {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    linkStreamState,
  );
}

type SignalHandler = (payload: unknown) => void;
type ItemHandler = (item: LinkItem) => void | Promise<void>;
const signalHandlers = new Map<string, Set<SignalHandler>>();
const itemHandlers = new Map<string, ItemHandler>();
const settledListeners = new Set<(answer: SendAnswer) => void>();

/** Hears each new value of a signal (for example "notifications"). */
export function onLinkSignal(kind: string, handler: SignalHandler): () => void {
  const handlers = signalHandlers.get(kind) ?? new Set<SignalHandler>();
  handlers.add(handler);
  signalHandlers.set(kind, handlers);
  return () => handlers.delete(handler);
}

/**
 * Runs the computer's items of one kind. One handler per kind; an item with
 * no handler (a kind this Hari doesn't know) is still acked, so it can't block
 * the outbox.
 */
export function onLinkItem(kind: string, handler: ItemHandler): () => void {
  itemHandlers.set(kind, handler);
  return () => {
    if (itemHandlers.get(kind) === handler) itemHandlers.delete(kind);
  };
}

/** Hears the computer's answer for items the phone sent (taken or refused). */
export function onLinkOutboxSettled(listener: (answer: SendAnswer) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

const cursorKey = (fingerprint: string) => `hari.link.cursor.${fingerprint}`;
const outboxKey = (fingerprint: string) => `hari.link.outbox.${fingerprint}`;

function readStored(key: string): unknown {
  try {
    return JSON.parse(Storage.getItemSync(key) ?? "null");
  } catch {
    return null;
  }
}

function loadCursor(fingerprint: string): LinkCursor | null {
  return parseCursor(readStored(cursorKey(fingerprint)));
}

function saveCursor(fingerprint: string, cursor: LinkCursor) {
  Storage.setItemSync(cursorKey(fingerprint), JSON.stringify(cursor));
}

function loadOutbox(fingerprint: string): OutboxItem[] {
  return parseOutbox(readStored(outboxKey(fingerprint)));
}

function saveOutbox(fingerprint: string, outbox: OutboxItem[]) {
  Storage.setItemSync(outboxKey(fingerprint), JSON.stringify(outbox));
}

/** The computer the stream runs for, while it runs. */
let current: { fingerprint: string; command: Command } | null = null;
let flushing = false;

/**
 * Queues an item for the computer and sends it now if it can. Kept on the
 * phone until the computer takes or refuses it. Never for commands (power,
 * app control): those must not run late.
 */
export function sendLinkItem(kind: string, payload: unknown): string {
  const link = current;
  if (!link) throw new Error("Pair with your computer first");
  const id = makeCommandId();
  const now = Date.now();
  saveOutbox(
    link.fingerprint,
    addToOutbox(loadOutbox(link.fingerprint), { id, kind, at: now, payload, tries: 0 }, now),
  );
  void flushOutbox();
  return id;
}

/** Items still waiting for the computer. */
export function pendingLinkItems(): OutboxItem[] {
  return current ? loadOutbox(current.fingerprint) : [];
}

/** Sends what waits in the outbox, a batch at a time, until it is empty or the link fails. */
async function flushOutbox(): Promise<void> {
  const link = current;
  if (!link || flushing) return;
  flushing = true;
  try {
    for (;;) {
      const batch = loadOutbox(link.fingerprint).slice(0, OUTBOX_BATCH);
      if (!batch.length || current !== link) return;
      let answer: SendAnswer | null;
      try {
        answer = parseSendAnswer(
          await link.command<unknown>("events.send", {
            items: batch.map(({ id, kind, at, payload }) => ({ id, kind, at, payload })),
          }),
        );
      } catch {
        // Kept for the next try (stream up again, or the next tick).
        const failed = new Set(batch.map((item) => item.id));
        saveOutbox(
          link.fingerprint,
          loadOutbox(link.fingerprint).map((item) =>
            failed.has(item.id) ? { ...item, tries: item.tries + 1 } : item,
          ),
        );
        return;
      }
      if (!answer) return;
      saveOutbox(link.fingerprint, settleOutbox(loadOutbox(link.fingerprint), answer));
      for (const listener of settledListeners) listener(answer);
      if (!answer.accepted.length && !answer.rejected.length) return;
    }
  } finally {
    flushing = false;
  }
}

function emitSignal(kind: string, payload: unknown) {
  for (const handler of signalHandlers.get(kind) ?? []) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`Link signal ${kind} failed`, error);
    }
  }
}

async function runItem(item: LinkItem) {
  const handler = itemHandlers.get(item.kind);
  if (!handler) return;
  try {
    await handler(item);
  } catch (error) {
    // Acked anyway: a handler that always fails must not hold the queue.
    console.warn(`Link item ${item.kind} failed`, error);
  }
}

const isFrame = (frame: LinkFrame | null): frame is LinkFrame => frame !== null;

/**
 * Holds the stream open for one pairing until the returned stop is called.
 * `keepInBackground` says whether to hold it with Hari out of view (the
 * background watcher keeps the app's code running then).
 */
export function runLinkStream(options: {
  fingerprint: string;
  /** The pairing now: its addresses change as the computer's network does. */
  pairing: () => Pairing | null;
  command: Command;
  keepInBackground: () => boolean;
}): () => void {
  const { fingerprint, command } = options;
  const link = { fingerprint, command };
  current = link;
  let disposed = false;
  let watchId: number | null = null;
  let quiet = false;
  let switching = false;
  let wakeUp: (() => void) | null = null;

  const wake = () => {
    const resume = wakeUp;
    wakeUp = null;
    resume?.();
  };
  // Timers don't run out of view: a tick or a change of app state wakes it too.
  const rest = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wakeUp = done;
    });
  const inView = () => AppState.currentState === "active";
  const wanted = () => inView() || options.keepInBackground();

  const appState = AppState.addEventListener("change", () => {
    // In view and in the background want different connections: reopen.
    if (watchId !== null && !inView() !== quiet) {
      switching = true;
      void closeWatch(watchId);
    }
    wake();
  });
  const ticks = onLiveEvent((event) => {
    if (event.action !== "tick") return;
    wake();
    void flushOutbox();
  });

  const run = async () => {
    let failures = 0;
    while (!disposed) {
      if (!wanted()) {
        setState({ phase: "off" });
        await rest(60_000);
        continue;
      }
      let cursor = loadCursor(fingerprint);
      quiet = !inView();
      switching = false;
      try {
        if (state.phase !== "retrying") setState({ phase: "connecting" });
        const pairing = options.pairing();
        if (pairing?.desktop.fingerprint !== fingerprint) break;
        watchId = await openWatch(
          pairing,
          "events.watch",
          cursor ? { epoch: cursor.epoch, after: cursor.after } : {},
          { quiet },
        );
        if (disposed) break;
        failures = 0;
        setState({ phase: "live" });
        void flushOutbox();
        while (!disposed && wanted() && !inView() === quiet) {
          const raw = await nextUpdates<unknown>(watchId, quiet ? PULL_MS.quiet : PULL_MS.view);
          if (disposed) break;
          const frames = raw.map(parseLinkFrame).filter(isFrame);
          if (!frames.length) continue;
          const read = readFrames(cursor, frames);
          for (const item of read.items) await runItem(item);
          if (read.cursor && JSON.stringify(read.cursor) !== JSON.stringify(cursor)) {
            cursor = read.cursor;
            saveCursor(fingerprint, cursor);
          }
          for (const [kind, payload] of read.signals) emitSignal(kind, payload);
          if (read.ack && cursor) {
            void command("events.ack", { epoch: cursor.epoch, seq: cursor.after }).catch(() => {});
          }
        }
      } catch (reason) {
        if (disposed) break;
        if (switching) {
          switching = false;
          continue;
        }
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message.includes(UNSUPPORTED)) {
          setState({ phase: "unsupported" });
          await rest(UNSUPPORTED_RETRY_MS);
          continue;
        }
        setState({ phase: "retrying", error: message });
        await rest(retryDelay(failures));
        failures += 1;
      } finally {
        if (watchId !== null) void closeWatch(watchId);
        watchId = null;
      }
    }
  };
  void run();

  return () => {
    disposed = true;
    if (current === link) current = null;
    appState.remove();
    ticks?.remove();
    if (watchId !== null) void closeWatch(watchId);
    wake();
    setState({ phase: "off" });
  };
}
