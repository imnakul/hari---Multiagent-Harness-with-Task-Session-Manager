import { describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { addRuleToAgentsFile, appendStandingRule } from "./agentsRule";

describe("appendStandingRule (L-252)", () => {
  it("adds a Standing rules section at the end", () => {
    expect(
      appendStandingRule(
        "# Project\n\nIntro.\n\n",
        "Never commit opencode.json",
      ),
    ).toBe(
      "# Project\n\nIntro.\n\n## Standing rules\n\n- Never commit opencode.json\n",
    );
  });
  it("starts an empty file with the section", () => {
    expect(appendStandingRule("", "Use pnpm")).toBe(
      "## Standing rules\n\n- Use pnpm\n",
    );
  });
  it("appends inside an existing section, before the next heading", () => {
    const content =
      "# P\n\n## Standing rules\n\n- Use pnpm\n\n## Commands\n\n- dev\n";
    expect(appendStandingRule(content, "Never force push")).toBe(
      "# P\n\n## Standing rules\n\n- Use pnpm\n- Never force push\n\n## Commands\n\n- dev\n",
    );
  });
  it("fills an empty section", () => {
    expect(appendStandingRule("## Standing rules\n## Next\n", "Use pnpm")).toBe(
      "## Standing rules\n\n- Use pnpm\n## Next\n",
    );
  });
  it("keeps CRLF line endings", () => {
    expect(appendStandingRule("# P\r\n", "Use pnpm")).toBe(
      "# P\r\n\r\n## Standing rules\r\n\r\n- Use pnpm\r\n",
    );
  });
  it("leaves the file alone when the rule is already there, or empty", () => {
    const content = "## Standing rules\n\n- Never commit `opencode.json`.\n";
    expect(appendStandingRule(content, "never commit opencode.json")).toBe(
      content,
    );
    expect(appendStandingRule(content, "   ")).toBe(content);
  });
});

describe("addRuleToAgentsFile", () => {
  it("creates AGENTS.md in the project root when it is missing", async () => {
    const write = vi.fn(async () => {});
    const result = await addRuleToAgentsFile("E:\\work\\shop\\", "Use pnpm", {
      read: async () => {
        throw new Error(
          "The system cannot find the file specified. (os error 2)",
        );
      },
      write,
    });
    expect(result).toEqual({
      ok: true,
      path: "E:\\work\\shop\\AGENTS.md",
      created: true,
    });
    expect(write).toHaveBeenCalledWith(
      "E:\\work\\shop\\AGENTS.md",
      "## Standing rules\n\n- Use pnpm\n",
    );
  });
  it("does not write when the rule is already in the file", async () => {
    const write = vi.fn(async () => {});
    const result = await addRuleToAgentsFile("/home/me/site", "Use pnpm", {
      read: async () => "## Standing rules\n\n- Use pnpm\n",
      write,
    });
    expect(result).toEqual({
      ok: true,
      path: "/home/me/site/AGENTS.md",
      created: false,
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("refuses to overwrite a file it could not read", async () => {
    const write = vi.fn(async () => {});
    const result = await addRuleToAgentsFile("/site", "Use pnpm", {
      read: async () => {
        throw new Error("Access is denied. (os error 5)");
      },
      write,
    });
    expect(result).toEqual({
      ok: false,
      message: "Couldn't read AGENTS.md, so nothing was added.",
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("reports a failed save", async () => {
    const result = await addRuleToAgentsFile("/site", "Use pnpm", {
      read: async () => "",
      write: async () => {
        throw new Error("read-only");
      },
    });
    expect(result).toEqual({
      ok: false,
      message: "Couldn't save AGENTS.md. Check the file isn't read-only.",
    });
  });
});
