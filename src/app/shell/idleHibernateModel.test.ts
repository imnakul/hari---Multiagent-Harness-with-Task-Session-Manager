import { describe, expect, it } from "vitest";
import { IDLE_GRACE_MS, IDLE_NOTICE_MS, idlePhase } from "./idleHibernateModel";

describe("idlePhase", () => {
  it("is off while busy or disarmed", () => {
    expect(idlePhase(null, 10)).toEqual({ kind: "off" });
  });

  it("waits two minutes, counts down 30 seconds, then hibernates", () => {
    expect(idlePhase(0, IDLE_GRACE_MS - 1)).toEqual({ kind: "waiting" });
    expect(idlePhase(0, IDLE_GRACE_MS)).toEqual({ kind: "notice", seconds: 30 });
    expect(idlePhase(0, IDLE_GRACE_MS + 29_500)).toEqual({ kind: "notice", seconds: 1 });
    expect(idlePhase(0, IDLE_GRACE_MS + IDLE_NOTICE_MS)).toEqual({ kind: "now" });
  });
});
