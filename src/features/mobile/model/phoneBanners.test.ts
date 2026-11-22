import { describe, expect, it } from "vitest";
import {
  flushPhoneBanners,
  initialPhoneBannerState,
  planPhoneBanners,
  PHONE_BANNER_WINDOW_MS,
  type PhoneBannerState,
} from "./phoneBanners";
import type { PhoneNotice, PhoneNotices } from "./phoneNotifications";

const notice = (key: string, patch: Partial<PhoneNotice> = {}): PhoneNotice => ({
  key,
  package: "com.whatsapp",
  app: "WhatsApp",
  title: "Asha",
  text: "Running late",
  postedAt: 1,
  ...patch,
});

const list = (onPhone: PhoneNotice[], receiving = true): PhoneNotices => ({
  receiving,
  stalled: false,
  paired: true,
  onPhone,
  earlier: [],
  icons: {},
});

function live(onPhone: PhoneNotice[] = []): PhoneBannerState {
  return planPhoneBanners(initialPhoneBannerState(), list(onPhone), 0).state;
}

describe("planPhoneBanners", () => {
  it("shows nothing for what the phone already holds (AC-F2)", () => {
    const plan = planPhoneBanners(
      initialPhoneBannerState(),
      list([1, 2, 3, 4, 5].map((n) => notice(`k${n}`))),
      0,
    );
    expect(plan.show).toEqual([]);
    expect(plan.state.phase).toBe("live");
  });

  it("shows a new notice with the app, title and text (AC-F3)", () => {
    const plan = planPhoneBanners(live(), list([notice("a")]), 100);
    expect(plan.show).toEqual([
      {
        key: "a",
        package: "com.whatsapp",
        title: "Hari-Phone · WhatsApp",
        subtitle: "Asha",
        body: "Running late",
      },
    ]);
  });

  it("hides codes (AC-F4)", () => {
    const code = notice("c", {
      app: "Bank",
      package: "com.bank",
      title: "OTP 482913",
      text: "Your code is 482913",
    });
    const [shown] = planPhoneBanners(live(), list([code]), 0).show;
    expect(shown.subtitle).toBe("OTP ••••••");
    expect(shown.body).toBe("Code hidden — open to see");
    expect(JSON.stringify(shown)).not.toContain("482913");
  });

  it("skips Hari's own packages (AC-F5)", () => {
    for (const pkg of ["com.hardbeat920.monocodemobile", "com.hardbeat920.monocode-mobile"])
      expect(
        planPhoneBanners(live(), list([notice("h", { package: pkg })]), 0).show,
      ).toEqual([]);
  });

  it("folds a burst into one banner when the window ends (AC-F6)", () => {
    let plan = planPhoneBanners(live(), list([notice("a", { postedAt: 1 })]), 0);
    expect(plan.show).toHaveLength(1);
    const all = [notice("a", { postedAt: 1 })];
    all.push(notice("b", { postedAt: 2, title: "Ben" }));
    plan = planPhoneBanners(plan.state, list(all), 2000);
    all.push(notice("c", { postedAt: 3, title: "Cy" }));
    plan = planPhoneBanners(plan.state, list(all), 4000);
    expect(plan.show).toEqual([]);
    expect(plan.flushAt.get("com.whatsapp")).toBe(PHONE_BANNER_WINDOW_MS);
    const flushed = flushPhoneBanners(plan.state, "com.whatsapp", PHONE_BANNER_WINDOW_MS);
    expect(flushed.show).toEqual([
      expect.objectContaining({
        key: "c",
        title: "Hari-Phone · WhatsApp",
        subtitle: "2 new notifications",
        body: "Cy",
      }),
    ]);
    expect(flushed.state.folded.size).toBe(0);
  });

  it("masks a code in a fold's latest title", () => {
    let plan = planPhoneBanners(live(), list([notice("a")]), 0);
    const all = [
      notice("a"),
      notice("b", { postedAt: 2 }),
      notice("c", { postedAt: 3, title: "OTP 123456", text: "code 123456" }),
    ];
    plan = planPhoneBanners(plan.state, list(all), 1000);
    const [folded] = flushPhoneBanners(plan.state, "com.whatsapp", 10_000).show;
    expect(folded.body).toBe("OTP ••••••");
  });

  it("flushes a single folded notice as a normal banner (AC-F7)", () => {
    let plan = planPhoneBanners(live(), list([notice("a")]), 0);
    plan = planPhoneBanners(plan.state, list([notice("a"), notice("b", { postedAt: 2 })]), 1000);
    const [shown] = flushPhoneBanners(plan.state, "com.whatsapp", 10_000).show;
    expect(shown).toMatchObject({ key: "b", subtitle: "Asha", body: "Running late" });
  });

  it("doesn't repeat resent notices after a reconnect, but shows new ones (AC-F8)", () => {
    const state = live([notice("a")]);
    const dropped = planPhoneBanners(state, list([notice("a")], false), 50_000);
    expect(dropped.state.phase).toBe("seeding");
    const back = planPhoneBanners(dropped.state, list([notice("a"), notice("b", { postedAt: 9 })]), 60_000);
    expect(back.show).toEqual([]);
    const fresh = planPhoneBanners(
      back.state,
      list([notice("a"), notice("b", { postedAt: 9 }), notice("c", { postedAt: 10 })]),
      70_000,
    );
    expect(fresh.show.map((item) => item.key)).toEqual(["c"]);
  });

  it("shows the same key again when postedAt is newer (AC-F9)", () => {
    const state = live([notice("a", { postedAt: 1 })]);
    expect(planPhoneBanners(state, list([notice("a", { postedAt: 1 })]), 50_000).show).toEqual([]);
    expect(planPhoneBanners(state, list([notice("a", { postedAt: 2 })]), 50_000).show).toHaveLength(1);
  });

  it("forgets keys that left the phone", () => {
    const plan = planPhoneBanners(live([notice("a")]), list([]), 1000);
    expect(plan.state.seen.size).toBe(0);
  });

  it("doesn't mutate the state it was given", () => {
    const state = live([notice("a")]);
    planPhoneBanners(state, list([notice("a"), notice("b", { postedAt: 2 })]), 100);
    expect([...state.seen.keys()]).toEqual(["a"]);
  });
});

describe("parseShareOpenTarget", () => {
  it("reads a banner click and ignores anything else (AC-F10)", async () => {
    const { parseShareOpenTarget } = await import("./mobileShare");
    expect(parseShareOpenTarget({ view: "notifications", key: "k1" })).toEqual({ key: "k1" });
    expect(parseShareOpenTarget(null)).toBeNull();
    expect(parseShareOpenTarget({ view: "files", key: "k1" })).toBeNull();
    expect(parseShareOpenTarget({ view: "notifications" })).toBeNull();
  });
});
