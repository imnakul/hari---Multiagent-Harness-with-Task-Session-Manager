import { describe, expect, it } from "vitest";

import { sessionModelLabel } from "@/features/sessions/sessionModelLabel";

describe("session model label (L-368)", () => {
  it("adds the account after the model when the desktop names one", () => {
    expect(sessionModelLabel({ model: "claude:opus", modelName: "Opus 5.5", accountName: "Work" })).toBe(
      "Opus 5.5 · Work",
    );
  });

  it("shows only the model when no account is named (one account, or an older desktop)", () => {
    expect(sessionModelLabel({ model: "claude:opus", modelName: "Opus 5.5" })).toBe("Opus 5.5");
    expect(sessionModelLabel({ model: "claude:opus" })).toBe("claude:opus");
  });

  it("shows the account alone when there is no model", () => {
    expect(sessionModelLabel({ model: "", accountName: "Work" })).toBe("Work");
  });
});
