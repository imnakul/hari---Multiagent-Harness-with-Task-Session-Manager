import { describe, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { sanitizeSessionForPersist } from "../../../features/sessions/data/sessionStore";
import { applyHarnessEvent, applyHarnessEvents, appendUser } from "./apply";
import type { HarnessEvent } from "./types";
import { operatorEnabledInThread } from "../../../features/sessions/model/operatorCommand";

describe("independent phone transcript", () => {
  it.each(["Native terminal prompt", undefined])(
    "freezes the external duration at completion without ending a concurrent local turn (%s)",
    (text) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
      try {
        let session = applyHarnessEvent(newSession("claude", "/tmp"), {
          type: "externalTurn.started",
          turnId: "native",
          text,
        });
        clock.mockReturnValue(5_000);
        session = appendUser(session, "Queued local follow-up");
        clock.mockReturnValue(26_000);
        session = applyHarnessEvent(session, {
          type: "externalTurn.finished",
          turnId: "native",
        });
        expect(session.blocks[0]).toMatchObject({
          startedAt: 1_000,
          durationMs: 25_000,
        });
        expect(session.blocks[1].durationMs).toBeUndefined();
        expect(session.busy).toBe(true);
        clock.mockReturnValue(90_000);
        expect(
          applyHarnessEvent(session, {
            type: "externalTurn.finished",
            turnId: "native",
          }).blocks[0].durationMs,
        ).toBe(25_000);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it("batches deltas and snapshots with the same result as individual delivery", () => {
    const session = applyHarnessEvent(newSession("claude", "/tmp"), {
      type: "externalTurn.started",
      turnId: "phone",
      text: "Phone prompt",
    });
    const events: HarnessEvent[] = ["Hello", " world", "Hello world"].map(
      (text) => ({
        type: "externalTurn.event",
        turnId: "phone",
        event: { type: "message.delta", text },
      }),
    );
    events.push({
      type: "externalTurn.event",
      turnId: "other",
      event: { type: "message.delta", text: "ignored" },
    });
    const individual = events.reduce(applyHarnessEvent, session);
    const batched = applyHarnessEvents(session, events);
    expect(
      batched.blocks.map((block) => [
        block.role,
        block.text,
        block.externalTurnId,
      ]),
    ).toEqual(
      individual.blocks.map((block) => [
        block.role,
        block.text,
        block.externalTurnId,
      ]),
    );
    expect(batched.blocks.at(-1)?.text).toBe("Hello world");
  });
  it("preserves explicit Operator Off through persistence without touching the earlier activation", () => {
    let session = appendUser(
      newSession("claude", "/tmp"),
      "Enable app access",
      [],
      { monocode: true },
    );
    session = {
      ...session,
      blocks: [
        ...session.blocks,
        {
          id: "operator-off",
          role: "system",
          text: "Operator off",
          operatorAccess: false,
        },
      ],
    };
    const saved = sanitizeSessionForPersist(session);
    expect(saved.blocks[0]?.monocode).toBe(true);
    expect(saved.blocks[1]?.operatorAccess).toBe(false);
    expect(operatorEnabledInThread(saved.blocks)).toBe(false);
  });
  it("streams into its own saved boundary while a local follow-up remains active", () => {
    let session = newSession("claude", "/tmp");
    const start = {
      type: "externalTurn.started" as const,
      turnId: "phone-turn",
      text: "Phone prompt",
      nativeId: "phone-uuid",
    };
    session = applyHarnessEvent(session, start);
    const once = session;
    expect(
      sanitizeSessionForPersist(session).blocks[0]?.providerMessageId,
    ).toBe("phone-uuid");
    expect(applyHarnessEvent(session, start)).toBe(once);
    session = appendUser(session, "Local follow-up");
    session = { ...session, busy: true };
    session = applyHarnessEvent(session, {
      type: "externalTurn.event",
      turnId: "phone-turn",
      event: { type: "message.delta", text: "Phone reply" },
    });
    expect(session.blocks.map((block) => block.text)).toEqual([
      "Phone prompt",
      "Phone reply",
      "Local follow-up",
    ]);
    session = applyHarnessEvent(session, {
      type: "externalTurn.finished",
      turnId: "phone-turn",
    });
    expect(session.busy).toBe(true);
    expect(session.externalTurnId).toBeUndefined();
    expect(sanitizeSessionForPersist(session).blocks[1]).toMatchObject({
      externalTurnId: "phone-turn",
      text: "Phone reply",
    });
    expect(applyHarnessEvent(session, start)).toBe(session);
    expect(
      applyHarnessEvent(session, {
        type: "externalTurn.event",
        turnId: "phone-turn",
        event: { type: "message.delta", text: "late duplicate" },
      }),
    ).toBe(session);
  });

  it("does not invent a user prompt when Claude only supplies assistant activity", () => {
    let session = applyHarnessEvent(newSession("claude", "/tmp"), {
      type: "externalTurn.started",
      turnId: "unknown-prompt",
    });
    expect(session.blocks[0]?.role).toBe("system");
    session = applyHarnessEvent(session, {
      type: "externalTurn.event",
      turnId: "unknown-prompt",
      event: { type: "status", text: "Real status" },
    });
    session = applyHarnessEvent(session, {
      type: "externalTurn.user",
      turnId: "unknown-prompt",
      text: "Actual prompt",
    });
    expect(session.blocks[0]).toMatchObject({
      role: "user",
      text: "Actual prompt",
    });
    expect(session.blocks[1]?.text).toBe("Real status");
  });
});
