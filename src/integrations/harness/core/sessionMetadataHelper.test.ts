import { describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({ runHarnessHelperPrompt: vi.fn() }));
vi.mock("./availability", () => ({ isHarnessAvailable: () => true }));

import type { Block } from "../../../features/sessions/model/session";
import type { SessionMetadataAiSettings } from "../../../features/sessions/model/sessionMetadataAi";
import {
  sessionMetadataHelperTargets,
  writeSessionLabel,
  writeSessionNotes,
  writeSessionPoints,
} from "./sessionMetadataHelper";

const blocks: Block[] = [
  { id: "u1", role: "user", text: "Polish the test page: spacing and dividers." },
  { id: "a1", role: "assistant", text: "Done in TestPage.tsx." },
];
const settings: SessionMetadataAiSettings = { helper: null, instructions: "", autoDefault: false };
const base = { blocks, cwd: "/repo", harness: "claude" as const, settings, isAvailable: () => true };

describe("sessionMetadataHelperTargets (L-190)", () => {
  it("puts the chosen model first, then AI helper settings, the chat's provider and the rest", () => {
    const targets = sessionMetadataHelperTargets({
      settings: { ...settings, helper: { provider: "codex", model: "m" } },
      aiHelper: { mode: "custom", primary: { provider: "opencode" }, fallback: null },
      harness: "claude",
    });
    expect(targets).toEqual([
      { provider: "codex", model: "m" },
      { provider: "opencode" },
      { provider: "claude" },
      { provider: "antigravity" },
    ]);
  });
});

describe("writeSessionLabel / writeSessionNotes", () => {
  it("returns a clean label", async () => {
    const run = vi.fn(async () => "Label: Test page polish.");
    const result = await writeSessionLabel({ ...base, targets: [{ provider: "claude" }], run });
    expect(result).toEqual({ ok: true, value: "Test page polish", helper: { provider: "claude" } });
  });

  it("sends the notes and falls through to the next helper on failure", async () => {
    const run = vi
      .fn<(target: { provider: string }, prompt: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("- Test page polish: spacing, dividers\n\n**Left off:** done");
    const result = await writeSessionNotes({
      ...base,
      notes: "**Old (bug fix)**\n- x",
      scope: "update",
      targets: [{ provider: "claude" }, { provider: "codex" }],
      run,
    });
    expect(result.ok && result.value).toEqual({
      kind: "add",
      text: "- Test page polish: spacing, dividers\n\n**Left off:** done",
    });
    expect(run.mock.calls[1]![0]).toEqual({ provider: "codex" });
    expect(run.mock.calls[1]![1]).toContain("**Old (bug fix)**");
  });

  it("reports nothing to read, failures and cancel", async () => {
    expect(await writeSessionLabel({ ...base, blocks: [] })).toMatchObject({ ok: false, cancelled: false });
    const failing = vi.fn(async () => {
      throw new Error("401 unauthorized");
    });
    const failed = await writeSessionNotes({ ...base, notes: "", scope: "full", targets: [{ provider: "claude" }], run: failing });
    expect(failed).toEqual({ ok: false, cancelled: false, message: "Couldn't write the notes: Claude Code needs sign-in." });
    const controller = new AbortController();
    controller.abort();
    expect(
      await writeSessionNotes({ ...base, notes: "", scope: "full", targets: [{ provider: "claude" }], run: failing, signal: controller.signal }),
    ).toEqual({ ok: false, cancelled: true, message: "" });
  });
});

describe("writeSessionPoints (L-192)", () => {
  it("maps the reply's message ids back to the chat's messages", async () => {
    const run = vi.fn(async () => "decision | m1 | Polish spacing and dividers\nevent | m2 | Updated TestPage.tsx");
    const result = await writeSessionPoints({
      ...base,
      data: { version: 1, points: [], bookmarks: [] },
      scope: "full",
      targets: [{ provider: "claude" }],
      run,
    });
    expect(result.ok && result.value).toEqual({
      kind: "add",
      points: [
        { kind: "decision", text: "Polish spacing and dividers", blockId: "u1" },
        { kind: "event", text: "Updated TestPage.tsx", blockId: "a1" },
      ],
    });
    expect(await writeSessionPoints({ ...base, blocks: [], data: { version: 1, points: [], bookmarks: [] }, scope: "full" }))
      .toEqual({ ok: false, cancelled: false, message: "Couldn't write the timeline: this chat has nothing to read yet." });
  });
});
