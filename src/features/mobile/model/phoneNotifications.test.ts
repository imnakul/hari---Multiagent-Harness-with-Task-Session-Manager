import { describe, expect, it } from "vitest";
import { looksLikeCode, maskCodes, noticeTime, parsePhoneNotices } from "./phoneNotifications";

describe("phone notifications (L-325)", () => {
  it("reads the computer's list and drops broken entries", () => {
    const list = parsePhoneNotices({
      receiving: true,
      paired: true,
      onPhone: [{ key: "a", package: "com.chat", app: "Chat", title: "Ann", text: "Hi", postedAt: 5 }, { key: "b" }, 7],
      earlier: [{ key: "c", package: "com.mail", postedAt: 1 }],
      icons: { "com.chat": "iVBOR", "com.bad": 3 },
    });
    expect(list).toEqual({
      receiving: true,
      paired: true,
      onPhone: [{ key: "a", package: "com.chat", app: "Chat", title: "Ann", text: "Hi", postedAt: 5 }],
      earlier: [{ key: "c", package: "com.mail", app: "com.mail", title: "", text: "", postedAt: 1 }],
      icons: { "com.chat": "iVBOR" },
    });
    expect(parsePhoneNotices("nope")).toBeNull();
  });

  it("spots one-time codes, not every number", () => {
    expect(looksLikeCode({ title: "Bank", text: "Your OTP is 482913. Do not share it." })).toBe(true);
    expect(looksLikeCode({ title: "G-582014 is your Google verification code", text: "" })).toBe(true);
    expect(looksLikeCode({ title: "Login code", text: "Use 7731 to sign in" })).toBe(true);
    expect(looksLikeCode({ title: "Ann", text: "Meet at 1530 near gate 4" })).toBe(false);
    expect(looksLikeCode({ title: "Code review", text: "PR is ready" })).toBe(false);
    expect(looksLikeCode({ title: "Order", text: "Your code: 12345678901 shipped" })).toBe(false);
  });

  it("dots out the code and keeps the rest", () => {
    expect(maskCodes("Your OTP is 482913. Valid 10 min")).toBe("Your OTP is ••••••. Valid 10 min");
    expect(maskCodes("Use 7731 to sign in")).toBe("Use •••• to sign in");
  });

  it("labels times relative to now", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(noticeTime(now - 20_000, now)).toBe("now");
    expect(noticeTime(now - 5 * 60_000, now)).toBe("5 min");
    expect(noticeTime(now - 3 * 60 * 60_000, now)).toBe("3 h");
  });
});
