// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_ASK_KEY,
  isActivityAskSession,
  lastOpenAskId,
  listAskSessions,
  pruneAskRegistry,
  registerAskSession,
  resetAskRegistryCache,
  saveLastOpen,
  unregisterAskSession,
} from "./activityAsk";

beforeEach(() => {
  localStorage.clear();
  resetAskRegistryCache();
});

describe("Activity Ask registry", () => {
  it("registers once, remembers the last open chat and forgets a deleted one", () => {
    registerAskSession("a");
    registerAskSession("a");
    registerAskSession("b");
    expect(listAskSessions()).toEqual(["a", "b"]);
    expect(isActivityAskSession("a")).toBe(true);
    expect(isActivityAskSession("zzz")).toBe(false);
    saveLastOpen("b");
    expect(lastOpenAskId()).toBe("b");
    unregisterAskSession("b");
    expect(lastOpenAskId()).toBeNull();
    expect(listAskSessions()).toEqual(["a"]);
  });

  it("ignores a last-open id that was never registered", () => {
    saveLastOpen("ghost");
    expect(lastOpenAskId()).toBeNull();
  });

  it("treats damaged storage as empty", () => {
    localStorage.setItem(ACTIVITY_ASK_KEY, "{not json");
    resetAskRegistryCache();
    expect(listAskSessions()).toEqual([]);
    localStorage.setItem(ACTIVITY_ASK_KEY, JSON.stringify({ ids: [1, "ok", ""], lastOpenId: "gone" }));
    resetAskRegistryCache();
    expect(listAskSessions()).toEqual(["ok"]);
    expect(lastOpenAskId()).toBeNull();
  });

  it("prunes missing chats and keeps only the newest empty one (stale open)", () => {
    for (const id of ["old", "empty1", "empty2", "gone"]) registerAskSession(id);
    saveLastOpen("empty1");
    pruneAskRegistry(
      new Map([
        ["old", { hasTurn: true }],
        ["empty1", { hasTurn: false }],
        ["empty2", { hasTurn: false }],
      ]),
    );
    expect(listAskSessions()).toEqual(["old", "empty2"]);
    expect(lastOpenAskId()).toBeNull();
  });
});
