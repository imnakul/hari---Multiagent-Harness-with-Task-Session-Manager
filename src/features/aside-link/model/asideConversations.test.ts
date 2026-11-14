import { describe, expect, it } from "vitest";
import {
  conversationKey,
  findConversation,
  rememberConversation,
  type KeyValueStore,
} from "./asideConversations";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("Aside conversations", () => {
  it("finds the session from the texts before the newest one", async () => {
    const store = memoryStore();
    const first = await conversationKey("claude", ["hello"]);
    rememberConversation(store, first, "session-1");
    expect(findConversation(store, await conversationKey("claude", ["hello"]))).toBe("session-1");
    expect(findConversation(store, await conversationKey("command-code", ["hello"]))).toBeUndefined();
    expect(findConversation(store, await conversationKey("claude", ["hello!"]))).toBeUndefined();
  });

  it("keeps the newest 500 and survives damaged storage", async () => {
    const store = memoryStore();
    for (let index = 0; index < 501; index += 1)
      rememberConversation(store, `k${index}`, `s${index}`);
    expect(findConversation(store, "k0")).toBeUndefined();
    expect(findConversation(store, "k500")).toBe("s500");
    store.data.set("monocode.asideLink.conversations", "{not json");
    expect(findConversation(store, "k500")).toBeUndefined();
  });
});
