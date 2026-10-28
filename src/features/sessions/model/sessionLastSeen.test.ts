// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { awayLongerThan, recordSessionSeen, sessionLastSeen } from "./sessionLastSeen";

beforeEach(() => localStorage.clear());

describe("sessionLastSeen (L-190)", () => {
  it("counts a never-seen chat as away", () => {
    expect(sessionLastSeen("a")).toBeNull();
    expect(awayLongerThan("a", 1_000, 5_000)).toBe(true);
  });

  it("compares the gap with the wait", () => {
    recordSessionSeen("a", 1_000);
    expect(awayLongerThan("a", 5_000, 5_999)).toBe(false);
    expect(awayLongerThan("a", 5_000, 6_000)).toBe(true);
  });

  it("keeps only the newest 300 chats", () => {
    for (let index = 0; index < 305; index += 1) recordSessionSeen(`s${index}`, index);
    recordSessionSeen("s0", 999);
    expect(sessionLastSeen("s0")).toBe(999);
    expect(sessionLastSeen("s5")).toBeNull();
    expect(sessionLastSeen("s6")).toBe(6);
  });
});
