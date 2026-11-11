// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { savePickerProviderVisible } from "../../sessions/model/models";
import { HARNESSES } from "../../sessions/model/session";
import {
  getProviderCheckSnapshot,
  resetProviderCheck,
  runProviderCheck,
  subscribeProviderCheck,
} from "./providerCheck";

vi.mock("../../../integrations/harness/core/availability", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../integrations/harness/core/availability")
  >()),
  probeHarnessAvailability: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../integrations/harness/core/registry")
  >()),
  refreshHarnessCatalogs: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  resetProviderCheck();
  vi.mocked(probeHarnessAvailability).mockResolvedValue();
  vi.mocked(refreshHarnessCatalogs).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("provider check store", () => {
  it("goes idle → checking → ready", async () => {
    const phases: string[] = [];
    const unsubscribe = subscribeProviderCheck(() =>
      phases.push(getProviderCheckSnapshot().phase),
    );
    await runProviderCheck();
    unsubscribe();

    expect(phases).toEqual(["checking", "ready"]);
    expect(getProviderCheckSnapshot().completedAt).toBeTypeOf("number");
    expect(probeHarnessAvailability).toHaveBeenCalledWith({ force: false });
  });

  it("leaves hidden providers alone", async () => {
    savePickerProviderVisible("codex", false);
    await runProviderCheck();
    const ids = vi.mocked(refreshHarnessCatalogs).mock.calls[0]?.[0] ?? [];
    expect(ids).not.toContain("codex");
    expect(ids.length).toBeLessThan(HARNESSES.length);
  });

  it("shares a run that is already in flight", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(probeHarnessAvailability).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const first = runProviderCheck();
    const second = runProviderCheck();
    finish?.();
    await Promise.all([first, second]);
    expect(probeHarnessAvailability).toHaveBeenCalledTimes(1);
  });

  it("a forced run during a check waits for it, then runs again", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(probeHarnessAvailability).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const startup = runProviderCheck();
    const manual = runProviderCheck({ force: true });
    expect(probeHarnessAvailability).toHaveBeenCalledTimes(1);
    finish?.();
    await Promise.all([startup, manual]);

    expect(probeHarnessAvailability).toHaveBeenCalledTimes(2);
    expect(probeHarnessAvailability).toHaveBeenLastCalledWith({ force: true });
    expect(getProviderCheckSnapshot().phase).toBe("ready");
  });

  it("a rejected check ends in error and names the failed providers", async () => {
    vi.mocked(probeHarnessAvailability).mockRejectedValue(new Error("scan failed"));
    await runProviderCheck();
    const snapshot = getProviderCheckSnapshot();
    expect(snapshot.phase).toBe("error");
    expect(snapshot.failed.length).toBeGreaterThan(0);
    expect(snapshot.completedAt).toBeTypeOf("number");
  });

  it("keeps the earlier completion time while a later run is checking", async () => {
    await runProviderCheck();
    const completedAt = getProviderCheckSnapshot().completedAt;
    let finish: (() => void) | undefined;
    vi.mocked(probeHarnessAvailability).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const again = runProviderCheck({ force: true });
    expect(getProviderCheckSnapshot()).toMatchObject({ phase: "checking", completedAt });
    finish?.();
    await again;
  });
});
