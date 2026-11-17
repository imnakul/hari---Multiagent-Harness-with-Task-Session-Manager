import { describe, expect, it } from "vitest";

import {
  DEFAULT_SKIPPED_APPS,
  iconsNeeded,
  noticesToSend,
  parseActiveNotices,
  skipRows,
  type PhoneNotice,
} from "@/features/phoneNotifications/noticeModel";

const notice = (pkg: string, key = `${pkg}:1`, app = pkg): PhoneNotice => ({
  key,
  package: pkg,
  app,
  title: "Title",
  text: "Body",
  postedAt: 1,
});

describe("phone notifications (L-325)", () => {
  it("reads the native list and drops broken entries", () => {
    const raw = JSON.stringify({
      listening: true,
      items: [
        { key: "a", package: "com.chat", app: "Chat", title: "Ann", text: "Hi", postedAt: 5 },
        { key: "b", package: "com.mail", postedAt: 4 },
        { key: "c", postedAt: 3 },
        "nonsense",
      ],
    });
    expect(parseActiveNotices(raw)).toEqual({
      listening: true,
      stalled: false,
      items: [
        { key: "a", package: "com.chat", app: "Chat", title: "Ann", text: "Hi", postedAt: 5 },
        { key: "b", package: "com.mail", app: "com.mail", title: "", text: "", postedAt: 4 },
      ],
    });
  });

  it("reads access on but no reader as stalled (L-334)", () => {
    expect(parseActiveNotices('{"listening":false,"allowed":true,"items":[]}')).toEqual({
      listening: false,
      stalled: true,
      items: [],
    });
    expect(parseActiveNotices('{"listening":false,"allowed":false,"items":[]}').stalled).toBe(false);
  });

  it("reads unreadable JSON as not listening", () => {
    expect(parseActiveNotices("{")).toEqual({ listening: false, stalled: false, items: [] });
    expect(parseActiveNotices("{}")).toEqual({ listening: false, stalled: false, items: [] });
  });

  it("never sends a skipped app's notifications", () => {
    const bank = DEFAULT_SKIPPED_APPS[0] ?? "";
    const sent = noticesToSend([notice("com.chat"), notice(bank)], DEFAULT_SKIPPED_APPS);
    expect(sent.map((item) => item.package)).toEqual(["com.chat"]);
  });

  it("asks for each app's icon once per connection", () => {
    const items = [notice("com.chat", "1"), notice("com.chat", "2"), notice("com.mail")];
    expect(iconsNeeded(items, new Set())).toEqual(["com.chat", "com.mail"]);
    expect(iconsNeeded(items, new Set(["com.chat"]))).toEqual(["com.mail"]);
  });

  it("lists showing apps and installed skipped apps, skipped first", () => {
    const rows = skipRows(
      [notice("com.chat", "1", "Chat"), notice("com.bank", "2", "Bank")],
      ["com.bank", "com.vault", "com.gone"],
      { "com.vault": "Vault" },
    );
    expect(rows).toEqual([
      { package: "com.bank", app: "Bank", skipped: true },
      { package: "com.vault", app: "Vault", skipped: true },
      { package: "com.chat", app: "Chat", skipped: false },
    ]);
  });
});
