import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { Session } from "../model/session";
import { watchAutoNotes } from "./SessionMetadataAutoWriter";

function fakeStore(initial: Session[]) {
  let sessions = initial;
  const observers = new Set<() => void>();
  return {
    snapshot: () => sessions,
    session: (id: string) => sessions.find((session) => session.id === id),
    observe: (listener: () => void) => {
      observers.add(listener);
      return () => observers.delete(listener);
    },
    set(next: Session[]) {
      sessions = next;
      for (const observer of observers) observer();
    },
  };
}

const chat = (busy: boolean, id = "s1"): Session =>
  ({ id, harness: "claude", title: "t", cwd: "/r", blocks: [], busy }) as unknown as Session;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchAutoNotes (L-190)", () => {
  it("runs once after a turn ends and the chat stays quiet", async () => {
    const store = fakeStore([chat(true)]);
    const update = vi.fn(async () => {});
    const stop = watchAutoNotes(store, { quietMs: 60_000, isOn: () => true, waitFor: () => false, update });
    store.set([chat(false)]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(update).toHaveBeenCalledTimes(1);
    stop();
  });

  it("cancels the wait when a new turn starts, and skips chats with Auto off", async () => {
    const store = fakeStore([chat(true), chat(true, "off")]);
    const update = vi.fn(async () => {});
    watchAutoNotes(store, { quietMs: 60_000, isOn: (id) => id !== "off", waitFor: () => false, update });
    store.set([chat(false), chat(false, "off")]);
    await vi.advanceTimersByTimeAsync(30_000);
    store.set([chat(true), chat(false, "off")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).not.toHaveBeenCalled();
    store.set([chat(false), chat(false, "off")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toMatchObject({ id: "s1" });
  });

  it("waits while the editor is open, and never runs a chat twice at once", async () => {
    const store = fakeStore([chat(true)]);
    let open = true;
    let finish: () => void = () => {};
    const update = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    watchAutoNotes(store, { quietMs: 1_000, isOn: () => true, waitFor: () => open, update });
    store.set([chat(false)]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(update).not.toHaveBeenCalled();
    open = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(update).toHaveBeenCalledTimes(1);
    store.set([chat(true)]);
    store.set([chat(false)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(update).toHaveBeenCalledTimes(1);
    finish();
  });
});
