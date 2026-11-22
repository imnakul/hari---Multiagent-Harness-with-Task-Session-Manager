import {
  looksLikeCode,
  maskCodes,
  type PhoneNotice,
  type PhoneNotices,
} from "./phoneNotifications";

/**
 * Fork (Hari, L-384): the phone's notifications as desktop banners. This file
 * is pure: it decides which banners to show and when; the hook owns timers and
 * the OS call.
 */

export const PHONE_BANNERS_KEY = "monocode.phoneBanners.v1";
const PHONE_BANNERS_EVENT = "monocode-phone-banners-changed";
/** At most one banner per app package in this window. */
export const PHONE_BANNER_WINDOW_MS = 10_000;
const LINE_MAX = 240;
const HARI_PACKAGE_PREFIX = "com.hardbeat920.monocode";

export function loadPhoneBanners(): boolean {
  try {
    return localStorage.getItem(PHONE_BANNERS_KEY) === "1";
  } catch {
    return false;
  }
}

export function savePhoneBanners(on: boolean): void {
  try {
    localStorage.setItem(PHONE_BANNERS_KEY, on ? "1" : "0");
  } catch {
    // Storage is unavailable: the switch simply doesn't stick.
  }
  window.dispatchEvent(new Event(PHONE_BANNERS_EVENT));
}

/** Also follows other windows through the `storage` event. */
export function subscribePhoneBanners(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === PHONE_BANNERS_KEY) listener();
  };
  window.addEventListener(PHONE_BANNERS_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PHONE_BANNERS_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function isHariPackage(pkg: string): boolean {
  return pkg.startsWith(HARI_PACKAGE_PREFIX);
}

export type PhoneBanner = {
  /** Notice key the banner opens in Share (the latest one for a fold). */
  key: string;
  package: string;
  title: string;
  subtitle: string;
  body: string;
};

export type PhoneBannerState = {
  /** Seeding marks what the phone already holds as seen, without banners. */
  phase: "seeding" | "live";
  /** Notice key → the `postedAt` already handled. */
  seen: Map<string, number>;
  lastShownAt: Map<string, number>;
  folded: Map<string, { count: number; latest: PhoneNotice }>;
};

export function initialPhoneBannerState(): PhoneBannerState {
  return {
    phase: "seeding",
    seen: new Map(),
    lastShownAt: new Map(),
    folded: new Map(),
  };
}

const clipLine = (value: string): string => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
};

type BannerText = Pick<PhoneBanner, "title" | "subtitle" | "body">;

/** A one-time code never reaches the banner: the title is dotted out and the text hidden. */
export function phoneBannerText(notice: PhoneNotice): BannerText {
  const title = `Hari-Phone · ${notice.app}`;
  const heading = notice.title || notice.app;
  if (looksLikeCode(notice))
    return {
      title,
      subtitle: clipLine(maskCodes(heading)),
      body: "Code hidden — open to see",
    };
  return { title, subtitle: clipLine(heading), body: clipLine(notice.text) };
}

export function phoneFoldText(count: number, latest: PhoneNotice): BannerText {
  const heading = latest.title || latest.app;
  return {
    title: `Hari-Phone · ${latest.app}`,
    subtitle: `${count} new notifications`,
    body: clipLine(looksLikeCode(latest) ? maskCodes(heading) : heading),
  };
}

const banner = (notice: PhoneNotice, text: BannerText): PhoneBanner => ({
  key: notice.key,
  package: notice.package,
  ...text,
});

export type PhoneBannerPlan = {
  state: PhoneBannerState;
  show: PhoneBanner[];
  /** Package → time to call `flushPhoneBanners`, for packages holding folds. */
  flushAt: Map<string, number>;
};

/**
 * Compares a fresh list with what was already handled. Never mutates `state`.
 * A list with `receiving: false` returns to seeding, so a reconnect's resent
 * list shows nothing.
 */
export function planPhoneBanners(
  state: PhoneBannerState,
  notices: PhoneNotices,
  now: number,
): PhoneBannerPlan {
  const seen = new Map(state.seen);
  const lastShownAt = new Map(state.lastShownAt);
  const folded = new Map(state.folded);
  const show: PhoneBanner[] = [];

  if (!notices.receiving) {
    return {
      state: { ...state, phase: "seeding", seen, lastShownAt, folded },
      show,
      flushAt: flushTimes(lastShownAt, folded),
    };
  }

  if (state.phase === "seeding") {
    for (const notice of notices.onPhone) seen.set(notice.key, notice.postedAt);
    return {
      state: { phase: "live", seen, lastShownAt, folded },
      show,
      flushAt: flushTimes(lastShownAt, folded),
    };
  }

  const present = new Set(notices.onPhone.map((notice) => notice.key));
  const fresh = notices.onPhone
    .filter((notice) => {
      const handled = seen.get(notice.key);
      return handled === undefined || notice.postedAt > handled;
    })
    .sort((a, b) => a.postedAt - b.postedAt);
  for (const notice of fresh) {
    seen.set(notice.key, notice.postedAt);
    if (isHariPackage(notice.package)) continue;
    const last = lastShownAt.get(notice.package);
    if (last === undefined || now - last >= PHONE_BANNER_WINDOW_MS) {
      show.push(banner(notice, phoneBannerText(notice)));
      lastShownAt.set(notice.package, now);
      continue;
    }
    const held = folded.get(notice.package);
    folded.set(notice.package, {
      count: (held?.count ?? 0) + 1,
      latest: notice,
    });
  }
  for (const key of seen.keys()) if (!present.has(key)) seen.delete(key);

  return {
    state: { phase: "live", seen, lastShownAt, folded },
    show,
    flushAt: flushTimes(lastShownAt, folded),
  };
}

function flushTimes(
  lastShownAt: ReadonlyMap<string, number>,
  folded: ReadonlyMap<string, unknown>,
): Map<string, number> {
  const times = new Map<string, number>();
  for (const pkg of folded.keys())
    times.set(pkg, (lastShownAt.get(pkg) ?? 0) + PHONE_BANNER_WINDOW_MS);
  return times;
}

/** Shows what a package folded: one normal banner for a single notice, else a count. */
export function flushPhoneBanners(
  state: PhoneBannerState,
  pkg: string,
  now: number,
): { state: PhoneBannerState; show: PhoneBanner[] } {
  const held = state.folded.get(pkg);
  if (!held) return { state, show: [] };
  const folded = new Map(state.folded);
  folded.delete(pkg);
  const lastShownAt = new Map(state.lastShownAt).set(pkg, now);
  const text =
    held.count === 1
      ? phoneBannerText(held.latest)
      : phoneFoldText(held.count, held.latest);
  return {
    state: { ...state, folded, lastShownAt },
    show: [banner(held.latest, text)],
  };
}
