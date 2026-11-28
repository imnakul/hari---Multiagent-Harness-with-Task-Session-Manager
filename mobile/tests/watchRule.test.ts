import { describe, expect, it, vi } from "vitest";

import { LOST_AFTER_MS } from "@/features/liveUpdates/liveCards";
import { nextWatchLink, shouldWatch, type WatchLink } from "@/features/notifications/watchRule";
// Hoisted above the imports: liveCards reads the app's link scheme from the Expo config (L-413).
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "monocode" } } }));

const never: WatchLink = { phase: "never" };
const up: WatchLink = { phase: "up" };

describe("background watching follows the computer (L-367)", () => {
  it("waits for the computer to answer before watching", () => {
    expect(shouldWatch({ wanted: true, link: never, now: 0 })).toBe(false);
    expect(shouldWatch({ wanted: true, link: up, now: 0 })).toBe(true);
  });

  it("never watches when the user turned it off", () => {
    expect(shouldWatch({ wanted: false, link: up, now: 0 })).toBe(false);
  });

  it("rides out a short drop, then stops", () => {
    const lost = nextWatchLink(up, false, 1_000);
    expect(lost).toEqual({ phase: "lost", since: 1_000 });
    expect(shouldWatch({ wanted: true, link: lost, now: 1_000 + LOST_AFTER_MS - 1 })).toBe(true);
    expect(shouldWatch({ wanted: true, link: lost, now: 1_000 + LOST_AFTER_MS })).toBe(false);
  });

  it("keeps the time it was first lost, and clears it when the computer answers", () => {
    const lost = nextWatchLink(up, false, 1_000);
    expect(nextWatchLink(lost, false, 9_000)).toBe(lost);
    expect(nextWatchLink(lost, true, 9_000)).toEqual(up);
    expect(nextWatchLink(up, true, 9_000)).toBe(up);
  });

  it("stays waiting when the computer was never reached", () => {
    expect(nextWatchLink(never, false, 5_000)).toBe(never);
  });
});
