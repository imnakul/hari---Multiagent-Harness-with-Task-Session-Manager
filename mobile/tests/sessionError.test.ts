import { describe, expect, it } from "vitest";

import { sessionErrorContent } from "@/features/sessions/sessionError";

describe("sessionErrorContent", () => {
  it("offers Stop Claude when Interactive Claude refuses a message (L-235)", () => {
    const content = sessionErrorContent(
      "Claude has not reached an idle conversation state. Open the model picker → Open native terminal. Use Return to chat once its prompt is empty; if it is already empty, Copy diagnostics there. No prompt was sent.",
    );
    expect(content.stopClaude).toBe(true);
    expect(content.recoveryTitle).toBe("Stop Claude");
    expect(content.message).not.toMatch(/native terminal/i);
  });

  it("keeps other errors as the desktop wrote them", () => {
    const content = sessionErrorContent("Network error");
    expect(content).toMatchObject({ message: "Network error", stopClaude: false, recovery: undefined });
  });
});
