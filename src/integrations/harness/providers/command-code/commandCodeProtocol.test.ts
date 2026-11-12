import { describe, expect, it } from "vitest";
import {
  COMMAND_CODE_AUTH_HELP,
  commandCodeExitError,
  commandCodePrintArgs,
  commandCodePromptText,
  commandCodeToolKind,
  commandCodeToolOutput,
  commandCodeToolPreview,
  commandCodeToolTitle,
  commandCodeUsage,
  isCommandCodeMissingResume,
  isCommandCodePermissionBlock,
  parseCommandCodeLine,
} from "./commandCodeProtocol";
import type { Attachment } from "../../../../features/sessions/model/session";

const BASE = [
  "-p",
  "--output-format",
  "json",
  "--skip-onboarding",
  "--trust",
  "--no-auto-update",
];

describe("commandCodePrintArgs", () => {
  it("runs Full access turns with --yolo and the chosen model and effort", () => {
    expect(
      commandCodePrintArgs({
        model: "meta/muse-ember",
        effort: "high",
        runtimeMode: "full-access",
        planning: false,
      }),
    ).toEqual([...BASE, "--model", "meta/muse-ember", "--effort", "high", "--yolo"]);
  });

  it("keeps Read only turns without --yolo so edits are refused", () => {
    expect(
      commandCodePrintArgs({ runtimeMode: "supervised", planning: false }),
    ).toEqual(BASE);
  });

  it("uses plan mode for plan turns at any access level", () => {
    const args = commandCodePrintArgs({ runtimeMode: "full-access", planning: true });
    expect(args).toContain("plan");
    expect(args).not.toContain("--yolo");
  });

  it("resumes, forks and skips saving when asked", () => {
    expect(
      commandCodePrintArgs({
        resume: "8f1c-a",
        fork: true,
        ephemeral: true,
        runtimeMode: "supervised",
        planning: true,
      }),
    ).toEqual([
      ...BASE,
      "--resume",
      "8f1c-a",
      "--fork-session",
      "--no-session",
      "--permission-mode",
      "plan",
    ]);
  });

  it("rejects ids that cmd.exe would expand or split", () => {
    expect(() =>
      commandCodePrintArgs({ model: "a&b", runtimeMode: "supervised", planning: false }),
    ).toThrow(/unsupported characters/);
    expect(() =>
      commandCodePrintArgs({ resume: "%PATH%", runtimeMode: "supervised", planning: false }),
    ).toThrow(/unsupported characters/);
  });
});

describe("commandCodePromptText", () => {
  it("asks Command Code to open attached images by path", () => {
    const image = {
      kind: "image",
      name: "shot.png",
      path: "C:\\shots\\shot.png",
    } as Attachment;
    const text = commandCodePromptText("What is this?", [image]);
    expect(text).toContain("What is this?");
    expect(text).toContain("read_file");
    expect(text).toContain(JSON.stringify("C:\\shots\\shot.png"));
  });
});

describe("parseCommandCodeLine", () => {
  it("reads stream events", () => {
    expect(
      parseCommandCodeLine(
        JSON.stringify({ type: "event", event: { type: "text_delta", delta: "Hi" } }),
      ),
    ).toEqual({
      kind: "event",
      type: "text_delta",
      event: { type: "text_delta", delta: "Hi" },
    });
  });

  it("reads the final result with usage", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      sessionId: "s-1",
      stopReason: "end_turn",
      finalText: "Done",
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100 },
    });
    expect(parseCommandCodeLine(line)).toEqual({
      kind: "result",
      result: {
        ok: true,
        sessionId: "s-1",
        stopReason: "end_turn",
        finalText: "Done",
        usage: { total: 150, input: 120, output: 30, cachedInput: 100, cacheWrite: 0 },
      },
    });
  });

  it("reports a failed result with its error", () => {
    const parsed = parseCommandCodeLine(
      JSON.stringify({ type: "result", subtype: "error", error: { message: "boom" } }),
    );
    expect(parsed).toMatchObject({ kind: "result", result: { ok: false, error: "boom" } });
  });

  it("ignores banners and broken lines", () => {
    expect(parseCommandCodeLine("Command Code v1.88")).toBeNull();
    expect(parseCommandCodeLine("{not json")).toBeNull();
    expect(parseCommandCodeLine(JSON.stringify({ type: "event" }))).toBeNull();
  });

  it("returns no usage when the counts are missing", () => {
    expect(commandCodeUsage({})).toBeUndefined();
  });
});

describe("tools", () => {
  it("maps tool names to MonoCode kinds and titles", () => {
    expect(commandCodeToolKind("read_file")).toBe("read");
    expect(commandCodeToolKind("edit_file")).toBe("edit");
    expect(commandCodeToolKind("powershell")).toBe("execute");
    expect(commandCodeToolKind("grep")).toBe("search");
    expect(commandCodeToolKind("mystery")).toBe("other");
    expect(commandCodeToolTitle("shell_command", { command: "npm test\nmore" })).toBe(
      "Run npm test",
    );
    expect(commandCodeToolTitle("read_file", {})).toBe("Read");
  });

  it("previews edits as a diff and reads tool output text", () => {
    expect(
      commandCodeToolPreview("edit_file", {
        file_path: "a.ts",
        old_string: "x",
        new_string: "y\nz",
      }),
    ).toMatchObject({ kind: "write", path: "a.ts", additions: 2, deletions: 1 });
    expect(
      commandCodeToolOutput([
        { type: "text", text: "one" },
        { type: "image" },
        { type: "text", text: "two" },
      ]),
    ).toBe("one\ntwo");
  });
});

describe("errors", () => {
  it("turns documented exit codes into actionable messages", () => {
    expect(commandCodeExitError(3).message).toContain(COMMAND_CODE_AUTH_HELP);
    expect(commandCodeExitError(5).message).toMatch(/rate limited/);
    expect(commandCodeExitError(10).message).toMatch(/out of credits/);
  });

  it("adds the sign-in hint to auth failures and keeps other details", () => {
    expect(commandCodeExitError(1, "Not authenticated").message).toContain(
      COMMAND_CODE_AUTH_HELP,
    );
    expect(commandCodeExitError(1, "disk full").message).toBe(
      "Command Code stopped: disk full",
    );
    expect(commandCodeExitError(1).message).toMatch(/code 1/);
  });

  it("spots permission blocks and missing sessions", () => {
    expect(isCommandCodePermissionBlock("This tool requires permissions; use --yolo")).toBe(
      true,
    );
    expect(isCommandCodeMissingResume("No session abc found to resume")).toBe(true);
    expect(isCommandCodeMissingResume("network down")).toBe(false);
  });
});
