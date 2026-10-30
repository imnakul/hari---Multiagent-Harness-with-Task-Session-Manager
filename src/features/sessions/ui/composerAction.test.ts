import { describe, expect, it } from "vitest";
import {
  resolveComposerActionAriaLabel,
  resolveComposerActionTooltip,
  resolveComposerButtonAction,
  resolveComposerKeyAction,
  resolveEffectiveSuggestionAction,
  resolveSuggestionKeyAction,
} from "./composerAction";

describe("composerAction resolution", () => {
  describe("idle session", () => {
    const idleContext = {
      busy: false,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    it("resolves plain Enter to send", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: false },
        idleContext,
      );
      expect(action).toBe("send");
    });

    it("resolves Ctrl+Enter to send", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: true, metaKey: false },
        idleContext,
      );
      expect(action).toBe("send");
    });

    it("resolves button click to send", () => {
      expect(resolveComposerButtonAction(idleContext)).toBe("send");
    });

    it("provides standard Send tooltip and accessible label", () => {
      expect(resolveComposerActionTooltip(idleContext)).toBe("Send");
      expect(resolveComposerActionAriaLabel(idleContext)).toBe("Send");
    });
  });

  describe("Shift key precedence and IME composition", () => {
    const busyQueueContext = {
      busy: true,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    it("resolves Shift+Enter to newline and never submits, queues, or steers", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: true, ctrlKey: false, metaKey: false },
        busyQueueContext,
      );
      expect(action).toBe("newline");
    });

    it("resolves Ctrl+Shift+Enter to newline (Shift takes strict precedence)", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: true, ctrlKey: true, metaKey: false },
        busyQueueContext,
      );
      expect(action).toBe("newline");
    });

    it("resolves Cmd+Shift+Enter on macOS to newline", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: true, ctrlKey: false, metaKey: true },
        { ...busyQueueContext, isMac: true },
      );
      expect(action).toBe("newline");
    });

    it("ignores key events when IME composition is active", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: false, isComposing: true },
        busyQueueContext,
      );
      expect(action).toBe("ignore");
    });

    it("ignores non-Enter keys", () => {
      const action = resolveComposerKeyAction(
        "a",
        { shiftKey: false, ctrlKey: false, metaKey: false },
        busyQueueContext,
      );
      expect(action).toBe("ignore");
    });
  });

  describe("busy session with Queue selected", () => {
    const contextWindows = {
      busy: true,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };
    const contextMac = {
      ...contextWindows,
      isMac: true,
    };

    it("resolves plain Enter to queue", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: false },
        contextWindows,
      );
      expect(action).toBe("queue");
    });

    it("resolves button click to queue", () => {
      expect(resolveComposerButtonAction(contextWindows)).toBe("queue");
    });

    it("resolves Ctrl+Enter to steer on Windows", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: true, metaKey: false },
        contextWindows,
      );
      expect(action).toBe("steer");
    });

    it("resolves Cmd+Enter to steer on macOS", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: true },
        contextMac,
      );
      expect(action).toBe("steer");
    });

    it("resolves Ctrl+Enter to steer on macOS as well", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: true, metaKey: false },
        contextMac,
      );
      expect(action).toBe("steer");
    });

    it("derives dynamic tooltip and aria-label for Queue mode", () => {
      expect(resolveComposerActionTooltip(contextWindows)).toBe(
        "Click / Enter → Queue\nCtrl+Enter → Steer",
      );
      expect(resolveComposerActionTooltip(contextMac)).toBe(
        "Click / Enter → Queue\nCmd+Enter → Steer",
      );
      expect(resolveComposerActionAriaLabel(contextWindows)).toBe(
        "Queue follow-up",
      );
    });
  });

  describe("busy session with Steer selected", () => {
    const contextWindows = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };
    const contextMac = {
      ...contextWindows,
      isMac: true,
    };

    it("resolves plain Enter to steer", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: false },
        contextWindows,
      );
      expect(action).toBe("steer");
    });

    it("resolves button click to steer", () => {
      expect(resolveComposerButtonAction(contextWindows)).toBe("steer");
    });

    it("resolves Ctrl+Enter to queue on Windows", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: true, metaKey: false },
        contextWindows,
      );
      expect(action).toBe("queue");
    });

    it("resolves Cmd+Enter to queue on macOS", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: true },
        contextMac,
      );
      expect(action).toBe("queue");
    });

    it("derives dynamic tooltip and aria-label for Steer mode", () => {
      expect(resolveComposerActionTooltip(contextWindows)).toBe(
        "Click / Enter → Steer\nCtrl+Enter → Queue",
      );
      expect(resolveComposerActionTooltip(contextMac)).toBe(
        "Click / Enter → Steer\nCmd+Enter → Queue",
      );
      expect(resolveComposerActionAriaLabel(contextWindows)).toBe(
        "Steer active turn",
      );
    });
  });

  describe("unsupported steering", () => {
    const noSteerContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: false,
      planMode: false,
      isMac: false,
    };

    it("safely falls back to queue on Enter even if Steer was selected in settings", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: false, metaKey: false },
        noSteerContext,
      );
      expect(action).toBe("queue");
    });

    it("safely falls back to queue on Ctrl+Enter", () => {
      const action = resolveComposerKeyAction(
        "Enter",
        { shiftKey: false, ctrlKey: true, metaKey: false },
        noSteerContext,
      );
      expect(action).toBe("queue");
    });

    it("safely falls back to queue on button click", () => {
      expect(resolveComposerButtonAction(noSteerContext)).toBe("queue");
    });

    it("omits unsupported Steer from tooltip and advertises only Queue", () => {
      expect(resolveComposerActionTooltip(noSteerContext)).toBe(
        "Click / Enter → Queue",
      );
      expect(resolveComposerActionAriaLabel(noSteerContext)).toBe(
        "Queue follow-up",
      );
    });
  });

  describe("Plan mode behavior", () => {
    const planContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: true,
      planMode: true,
      isMac: false,
    };

    it("forces queue action in plan mode regardless of followUpBehavior", () => {
      expect(
        resolveComposerKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          planContext,
        ),
      ).toBe("queue");
      expect(
        resolveComposerKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          planContext,
        ),
      ).toBe("queue");
      expect(resolveComposerButtonAction(planContext)).toBe("queue");
    });

    it("explains only Queue in tooltip while in plan mode", () => {
      expect(resolveComposerActionTooltip(planContext)).toBe(
        "Click / Enter → Queue",
      );
      expect(resolveComposerActionAriaLabel(planContext)).toBe(
        "Queue follow-up",
      );
    });
  });

  describe("resolveSuggestionKeyAction and resolveEffectiveSuggestionAction", () => {
    const idleContext = {
      busy: false,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    const busyQueueContext = {
      busy: true,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    const busySteerContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    const unsupportedSteerContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: false,
      planMode: false,
      isMac: false,
    };

    const planModeContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: true,
      planMode: true,
      isMac: false,
    };

    it("returns newline on Shift+Enter regardless of item presence or modifiers", () => {
      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: true, ctrlKey: false, metaKey: false },
          true,
        ),
      ).toBe("newline");

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: true, ctrlKey: false, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "newline" });

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: true, ctrlKey: true, metaKey: false },
          false,
          busyQueueContext,
        ),
      ).toEqual({ type: "newline" });
    });

    it("returns action on Ctrl+Enter and Cmd+Enter to execute alternate queue/steer without selecting suggestion", () => {
      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          true,
        ),
      ).toBe("action");

      // With Queue configured, modifier+Enter performs Steer
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "action", action: "steer" });

      // With Steer configured, modifier+Enter performs Queue
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          true,
          busySteerContext,
        ),
      ).toEqual({ type: "action", action: "queue" });

      // macOS Cmd+Enter
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: true },
          true,
          { ...busyQueueContext, isMac: true },
        ),
      ).toEqual({ type: "action", action: "steer" });
    });

    it("returns pick on plain Enter when a suggestion item is available", () => {
      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          true,
        ),
      ).toBe("pick");

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "pick" });
    });

    it("falls through to normal action on plain Enter with unmatched mention", () => {
      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
        ),
      ).toBe("action");

      // Idle -> Send
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          idleContext,
        ),
      ).toEqual({ type: "action", action: "send" });

      // Busy with Queue -> Queue
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busyQueueContext,
        ),
      ).toEqual({ type: "action", action: "queue" });

      // Busy with Steer -> Steer
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busySteerContext,
        ),
      ).toEqual({ type: "action", action: "steer" });

      // Unsupported steering or Plan mode -> Queue
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          unsupportedSteerContext,
        ),
      ).toEqual({ type: "action", action: "queue" });

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          planModeContext,
        ),
      ).toEqual({ type: "action", action: "queue" });
    });

    it("falls through to normal action on plain Enter with unmatched non-empty slash query", () => {
      const slashOptions = { keepOpenOnUnmatched: false };

      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          slashOptions,
        ),
      ).toBe("action");

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busyQueueContext,
          slashOptions,
        ),
      ).toEqual({ type: "action", action: "queue" });

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busySteerContext,
          slashOptions,
        ),
      ).toEqual({ type: "action", action: "steer" });
    });

    it("preserves bare slash behavior by keeping picker open on plain Enter when unmatched", () => {
      const bareSlashOptions = { keepOpenOnUnmatched: true };

      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          bareSlashOptions,
        ),
      ).toBe("keep_open");

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busyQueueContext,
          bareSlashOptions,
        ),
      ).toEqual({ type: "keep_open" });

      // Modifier+Enter still performs alternate action even on bare slash
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          false,
          busyQueueContext,
          bareSlashOptions,
        ),
      ).toEqual({ type: "action", action: "steer" });
    });

    it("ignores non-Enter keys and active IME composition", () => {
      expect(
        resolveSuggestionKeyAction(
          "Tab",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          true,
        ),
      ).toBe("ignore");

      expect(
        resolveSuggestionKeyAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false, isComposing: true },
          true,
        ),
      ).toBe("ignore");

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false, isComposing: true },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "ignore" });
    });
  });

  describe("production-used decision boundary: resolveEffectiveSuggestionAction coverage", () => {
    const idleContext = {
      busy: false,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };
    const busyQueueContext = {
      busy: true,
      followUpBehavior: "queue" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };
    const busySteerContext = {
      busy: true,
      followUpBehavior: "steer" as const,
      canSteer: true,
      planMode: false,
      isMac: false,
    };

    it("covers unmatched mention by resolving to action (Send/Queue/Steer)", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          idleContext,
        ),
      ).toEqual({ type: "action", action: "send" });

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busyQueueContext,
        ),
      ).toEqual({ type: "action", action: "queue" });
    });

    it("covers unmatched non-empty slash query by resolving to action", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busySteerContext,
          { keepOpenOnUnmatched: false },
        ),
      ).toEqual({ type: "action", action: "steer" });
    });

    it("covers bare slash by keeping picker open on plain Enter", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          false,
          busyQueueContext,
          { keepOpenOnUnmatched: true },
        ),
      ).toEqual({ type: "keep_open" });
    });

    it("covers valid suggestion by returning pick", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "pick" });
    });

    it("covers Shift+Enter by returning newline", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: true, ctrlKey: false, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "newline" });
    });

    it("covers modifier+Enter by returning alternate action without picking", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "action", action: "steer" });

      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: true, metaKey: false },
          true,
          busySteerContext,
        ),
      ).toEqual({ type: "action", action: "queue" });
    });

    it("covers IME composition by returning ignore", () => {
      expect(
        resolveEffectiveSuggestionAction(
          "Enter",
          { shiftKey: false, ctrlKey: false, metaKey: false, isComposing: true },
          true,
          busyQueueContext,
        ),
      ).toEqual({ type: "ignore" });
    });
  });
});

describe("Interactive Claude Send now (L-193)", () => {
  const context = {
    busy: true,
    followUpBehavior: "steer" as const,
    canSteer: false,
    planMode: false,
    isMac: false,
    sendNow: true,
  };
  const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
  const ctrl = { shiftKey: false, ctrlKey: true, metaKey: false };

  it("queues on Enter and click, and sends now on Ctrl+Enter", () => {
    expect(resolveComposerKeyAction("Enter", plain, context)).toBe("queue");
    expect(resolveComposerKeyAction("Enter", ctrl, context)).toBe("steer");
    expect(resolveComposerButtonAction(context)).toBe("queue");
    expect(resolveComposerActionTooltip(context)).toBe(
      "Click / Enter → Queue\nCtrl+Enter → Send now (stops Claude's turn first)",
    );
  });

  it("only queues in plan mode or without Send now", () => {
    expect(resolveComposerKeyAction("Enter", ctrl, { ...context, planMode: true })).toBe("queue");
    expect(resolveComposerKeyAction("Enter", ctrl, { ...context, sendNow: false })).toBe("queue");
    expect(resolveComposerActionTooltip({ ...context, sendNow: false })).toBe("Click / Enter → Queue");
  });
});
