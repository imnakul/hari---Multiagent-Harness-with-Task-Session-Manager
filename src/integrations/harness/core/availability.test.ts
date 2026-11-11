import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../../../features/sessions/model/session";
import {
  hasHarnessEvidence,
  isHarnessAvailable,
  probeHarnessAvailability,
  resetHarnessAvailability,
} from "./availability";

const probed: string[] = [];
vi.mock("./registry", () => ({ isLiveHarness: (): boolean => true }));
vi.mock("./child", () => ({
  probeHarnessBinary: async (id: string): Promise<{ path: string }> => {
    probed.push(id);
    return { path: `/bin/${id}` };
  },
}));

beforeEach(() => {
  resetHarnessAvailability();
  probed.length = 0;
});

describe("deferred harness availability", () => {
  it("starts with no evidence for any harness", () => {
    expect(hasHarnessEvidence("antigravity-cli")).toBe(false);
    expect(hasHarnessEvidence("claude")).toBe(false);
    expect(isHarnessAvailable("antigravity-cli")).toBe(false);
  });

  it("probes every harness", async () => {
    await probeHarnessAvailability({ force: true });
    expect(probed).toContain("antigravity-cli");
    const ids: HarnessId[] = ["claude", "antigravity-cli"];
    for (const id of ids) {
      expect(hasHarnessEvidence(id)).toBe(true);
      expect(isHarnessAvailable(id)).toBe(true);
    }
  });
});
