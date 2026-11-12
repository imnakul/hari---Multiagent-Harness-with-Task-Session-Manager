import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLI_UPDATE_CHANNELS,
  checkCliUpdates,
  compareCliVersions,
  fetchLatestCliVersion,
  parseCliVersion,
} from "./cliVersions";

describe("cliVersions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the first x.y.z from a CLI version banner", () => {
    expect(parseCliVersion("2.1.267 (Claude Code)")).toBe("2.1.267");
    expect(parseCliVersion("codex-cli 0.42.1")).toBe("0.42.1");
    expect(parseCliVersion("no version here")).toBeNull();
  });

  it("compares versions numerically per segment", () => {
    expect(compareCliVersions("2.1.267", "2.1.280")).toBeLessThan(0);
    expect(compareCliVersions("2.1.280", "2.1.280")).toBe(0);
    expect(compareCliVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareCliVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });

  it("covers exactly the npm-distributed channels with npm update commands", () => {
    expect(Object.keys(CLI_UPDATE_CHANNELS).sort()).toEqual([
      "claude",
      "cline",
      "codex",
      "command-code",
      "pi",
    ]);
    for (const channel of Object.values(CLI_UPDATE_CHANNELS)) {
      expect(channel?.updateCommand).toMatch(/^npm i -g /);
      expect(channel?.updateCommand).toContain(channel!.packageName);
    }
  });

  it("reads the registry latest version and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "9.9.9" }),
      })),
    );
    await expect(fetchLatestCliVersion("@openai/codex")).resolves.toBe("9.9.9");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await expect(fetchLatestCliVersion("@openai/codex")).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(fetchLatestCliVersion("@openai/codex")).resolves.toBeNull();
  });

  it("notices an outdated CLI and carries its npm update command", async () => {
    const notices = await checkCliUpdates({ claude: "claude" }, {
      readVersion: async () => "2.1.267 (Claude Code)",
      fetchLatest: async () => "2.1.300",
    });
    expect(notices).toEqual([
      {
        harness: "claude",
        currentVersion: "2.1.267",
        latestVersion: "2.1.300",
        updateCommand: "npm i -g @anthropic-ai/claude-code",
      },
    ]);
  });

  it("stays silent for current, unknown, and unprobeable CLIs", async () => {
    const readVersion = vi.fn(async (binary: string) => {
      if (binary === "codex") throw new Error("spawn failed");
      return "2.1.300";
    });
    const notices = await checkCliUpdates(
      { claude: "claude", codex: "codex", grok: "grok", pi: "pi" },
      { readVersion, fetchLatest: async () => "2.1.300" },
    );
    expect(notices).toEqual([]);
    expect(readVersion).toHaveBeenCalledTimes(3);
  });
});
