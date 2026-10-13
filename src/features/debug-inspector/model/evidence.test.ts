import { beforeEach, expect, it, vi } from "vitest";
import {
  parseLocalEvidence,
  readLocalEvidence,
  readStoredIdentity,
} from "./evidence";
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
const evidence = {
  provider: "claude",
  nativeId: "native-1",
  accountId: "default",
  observedAt: 1,
  fileBytes: 20,
  readBytes: 20,
  malformedLines: 0,
  partialLines: 0,
  measurements: [
    {
      identity: "message-1",
      scope: "message",
      uncachedInput: 10,
      prompt: "private",
    },
  ],
};
beforeEach(() => invoke.mockReset());
it("allowlists numeric evidence and rejects account/provider/native mismatches", () => {
  expect(
    JSON.stringify(
      parseLocalEvidence(evidence, "claude", "native-1", "default"),
    ),
  ).not.toContain("private");
  for (const changed of [
    { ...evidence, provider: "codex" },
    { ...evidence, accountId: "other" },
    { ...evidence, nativeId: "other" },
  ])
    expect(() =>
      parseLocalEvidence(changed, "claude", "native-1", "default"),
    ).toThrow();
});
it("rejects malformed/oversized IPC arrays and unsupported scopes", () => {
  expect(() =>
    parseLocalEvidence(
      { ...evidence, measurements: Array(1001).fill(evidence.measurements[0]) },
      "claude",
      "native-1",
      "default",
    ),
  ).toThrow();
  expect(() =>
    parseLocalEvidence(
      { ...evidence, measurements: [{ identity: "a", scope: "request" }] },
      "claude",
      "native-1",
      "default",
    ),
  ).toThrow();
});
it("rejects path input before IPC and performs only the explicit read command", async () => {
  await expect(
    readLocalEvidence("claude", "../credentials", "default"),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValue(evidence);
  await readLocalEvidence("claude", "native-1", "default");
  expect(invoke.mock.calls).toEqual([
    [
      "debug_inspector_local_evidence",
      { provider: "claude", nativeId: "native-1", accountId: "default" },
    ],
  ]);
});
it("repeated reads return replacements without accumulating usage", async () => {
  invoke.mockResolvedValue(evidence);
  const first = await readLocalEvidence("claude", "native-1", "default");
  expect(await readLocalEvidence("claude", "native-1", "default")).toEqual(
    first,
  );
  expect(first.measurements).toHaveLength(1);
});
it("stored identity reads never enter transcript repair/save pathways", async () => {
  invoke.mockResolvedValue({
    sessionId: "chat",
    provider: "claude",
    nativeId: "native-1",
    accountId: "profile-2",
    blocks: [{ text: "private prompt" }],
  });
  expect(await readStoredIdentity("chat", false)).toEqual({
    provider: "claude",
    nativeId: "native-1",
    accountId: "profile-2",
  });
  expect(invoke.mock.calls).toEqual([
    ["debug_inspector_session_identity", { sessionId: "chat" }],
  ]);
});
it("rejects Mono private Codex evidence instead of falling back to ordinary account storage", async () => {
  invoke.mockResolvedValue({
    sessionId: "mono-chat",
    provider: "codex",
    nativeId: "native-1",
    accountId: "default",
  });
  await expect(readStoredIdentity("mono-chat", true)).rejects.toThrow(
    "private Codex store",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
