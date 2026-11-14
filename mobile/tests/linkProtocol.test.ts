import { describe, expect, it } from "vitest";

import {
  addToOutbox,
  parseCursor,
  parseLinkFrame,
  parseOutbox,
  parseSendAnswer,
  readFrames,
  retryDelay,
  settleOutbox,
  OUTBOX_LIMIT,
  OUTBOX_MAX_AGE_MS,
  type LinkFrame,
  type OutboxItem,
} from "@/features/link/linkProtocol";

const item = (seq: number, kind = "share"): LinkFrame => ({
  type: "item",
  item: { seq, id: `i${seq}`, kind, at: 1, payload: { n: seq } },
});
const hello = (epoch: string, resume: boolean): LinkFrame => ({
  type: "hello",
  epoch,
  last: 9,
  resume,
});

describe("link frames", () => {
  it("reads hello, item and signal frames and refuses malformed ones", () => {
    expect(parseLinkFrame({ type: "hello", epoch: "e1", last: 3, resume: true })).toEqual({
      type: "hello",
      epoch: "e1",
      last: 3,
      resume: true,
    });
    expect(
      parseLinkFrame({ type: "item", item: { seq: 2, id: "a", kind: "share", at: 5, payload: 1 } }),
    ).toEqual({ type: "item", item: { seq: 2, id: "a", kind: "share", at: 5, payload: 1 } });
    expect(parseLinkFrame({ type: "signal", kind: "notifications", payload: [] })).toEqual({
      type: "signal",
      kind: "notifications",
      payload: [],
    });
    expect(parseLinkFrame({ type: "item", item: { seq: -1, id: "a", kind: "x", at: 1 } })).toBeNull();
    expect(parseLinkFrame({ type: "hello", epoch: "", last: 0 })).toBeNull();
    expect(parseLinkFrame({ type: "other" })).toBeNull();
    expect(parseLinkFrame("hello")).toBeNull();
  });

  it("runs new items in order, skips resent ones and acks only when something ran", () => {
    const first = readFrames(null, [hello("e1", false), item(1), item(2)]);
    expect(first.cursor).toEqual({ epoch: "e1", after: 2 });
    expect(first.items.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(first.ack).toBe(true);

    const again = readFrames(first.cursor, [hello("e1", true), item(2), item(3)]);
    expect(again.items.map((entry) => entry.seq)).toEqual([3]);
    expect(again.cursor).toEqual({ epoch: "e1", after: 3 });

    const quiet = readFrames(again.cursor, [hello("e1", true)]);
    expect(quiet.ack).toBe(false);
    expect(quiet.cursor).toEqual({ epoch: "e1", after: 3 });
  });

  it("starts counting again when the computer's outbox is new", () => {
    const read = readFrames({ epoch: "old", after: 40 }, [hello("e2", false), item(1)]);
    expect(read.cursor).toEqual({ epoch: "e2", after: 1 });
    expect(read.items).toHaveLength(1);
  });

  it("keeps the latest value per signal", () => {
    const read = readFrames({ epoch: "e1", after: 0 }, [
      { type: "signal", kind: "notifications", payload: 1 },
      { type: "signal", kind: "notifications", payload: 2 },
    ]);
    expect([...read.signals]).toEqual([["notifications", 2]]);
    expect(read.ack).toBe(false);
  });

  it("reads a stored cursor or nothing", () => {
    expect(parseCursor({ epoch: "e", after: 4 })).toEqual({ epoch: "e", after: 4 });
    expect(parseCursor({ epoch: "e", after: 1.5 })).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });
});

describe("phone outbox", () => {
  const entry = (id: string, at: number): OutboxItem => ({
    id,
    kind: "share",
    at,
    payload: null,
    tries: 0,
  });

  it("keeps the newest items within the limit and age", () => {
    let outbox: OutboxItem[] = [entry("old", 0)];
    const now = OUTBOX_MAX_AGE_MS + 1;
    for (let n = 0; n < OUTBOX_LIMIT + 3; n++) outbox = addToOutbox(outbox, entry(`n${n}`, now), now);
    expect(outbox).toHaveLength(OUTBOX_LIMIT);
    expect(outbox[0]?.id).toBe("n3");
    expect(outbox.some((stored) => stored.id === "old")).toBe(false);
  });

  it("drops taken and refused items and keeps the rest", () => {
    const outbox = [entry("a", 1), entry("b", 1), entry("c", 1)];
    const answer = parseSendAnswer({ accepted: ["a"], rejected: [{ id: "b", error: "No" }, 4] });
    expect(answer).toEqual({ accepted: ["a"], rejected: [{ id: "b", error: "No" }] });
    expect(settleOutbox(outbox, answer!).map((stored) => stored.id)).toEqual(["c"]);
    expect(parseSendAnswer({ accepted: [] })).toBeNull();
  });

  it("reads a stored outbox, skipping broken entries", () => {
    expect(parseOutbox([{ id: "a", kind: "share", at: 1, payload: 2 }, { id: 3 }])).toEqual([
      { id: "a", kind: "share", at: 1, payload: 2, tries: 0 },
    ]);
    expect(parseOutbox("x")).toEqual([]);
  });

  it("waits longer after each failure, up to 30 s", () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([1_000, 2_000, 5_000, 15_000, 30_000, 30_000]);
  });
});
