// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHITEBOARD_CHATS_KEY,
  forgetWhiteboardChat,
  isWhiteboardChatSession,
  resetWhiteboardChatsCache,
  setWhiteboardChat,
  subscribeWhiteboardChats,
  whiteboardChatFor,
  whiteboardChatIds,
  whiteboardChatSheet,
  whiteboardChatsSnapshot,
} from "./whiteboardChats";

describe("whiteboard sheet chats (L-403)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetWhiteboardChatsCache();
  });

  it("links a sheet to its chat both ways and keeps a stable snapshot", () => {
    setWhiteboardChat("sheet-a", "session-1");
    expect(whiteboardChatFor("sheet-a")).toBe("session-1");
    expect(whiteboardChatSheet("session-1")).toBe("sheet-a");
    expect(isWhiteboardChatSession("session-1")).toBe(true);
    expect(isWhiteboardChatSession("session-2")).toBe(false);
    expect(whiteboardChatsSnapshot()).toBe(whiteboardChatsSnapshot());
    expect([...whiteboardChatIds()]).toEqual(["session-1"]);
  });

  it("forgetting a sheet frees its chat for the Chats list and notifies", () => {
    const listener = vi.fn();
    const stop = subscribeWhiteboardChats(listener);
    setWhiteboardChat("sheet-a", "session-1");
    forgetWhiteboardChat("sheet-a");
    stop();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(whiteboardChatFor("sheet-a")).toBeNull();
    expect(isWhiteboardChatSession("session-1")).toBe(false);
  });

  it("a new chat for a sheet replaces the old link", () => {
    setWhiteboardChat("sheet-a", "session-1");
    setWhiteboardChat("sheet-a", "session-2");
    expect(whiteboardChatSheet("session-1")).toBeNull();
    expect(whiteboardChatSheet("session-2")).toBe("sheet-a");
  });

  it("reads broken or hostile storage as an empty map", () => {
    localStorage.setItem(WHITEBOARD_CHATS_KEY, "{not json");
    resetWhiteboardChatsCache();
    expect(whiteboardChatsSnapshot()).toEqual({});
    localStorage.setItem(WHITEBOARD_CHATS_KEY, JSON.stringify({ "bad id!": "s", ok: 5, good: "s1" }));
    resetWhiteboardChatsCache();
    expect(whiteboardChatsSnapshot()).toEqual({ good: "s1" });
  });
});
