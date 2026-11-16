/**
 * Fork (Hari, L-325): the paired phone's notifications, as the Notifications
 * view in Share shows them. The computer keeps them in memory only.
 */
export const PHONE_NOTIFICATIONS_EVENT = "monocode-phone-notifications-changed";

export type PhoneNotice = {
  key: string;
  package: string;
  app: string;
  title: string;
  text: string;
  postedAt: number;
};

export type PhoneNotices = {
  /** The phone has sent its list since it last said it stopped. */
  receiving: boolean;
  paired: boolean;
  onPhone: PhoneNotice[];
  /** Left the phone in the last 24 hours, newest first. */
  earlier: PhoneNotice[];
  /** Base64 PNG by app package. */
  icons: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function parseNotices(value: unknown): PhoneNotice[] {
  if (!Array.isArray(value)) return [];
  const notices: PhoneNotice[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.package !== "string") continue;
    notices.push({
      key: item.key,
      package: item.package,
      app: text(item.app) || item.package,
      title: text(item.title),
      text: text(item.text),
      postedAt: typeof item.postedAt === "number" ? item.postedAt : 0,
    });
  }
  return notices;
}

/** Reads the computer's list; null when it isn't one. */
export function parsePhoneNotices(raw: unknown): PhoneNotices | null {
  if (!isRecord(raw)) return null;
  const icons: Record<string, string> = {};
  if (isRecord(raw.icons))
    for (const [pkg, icon] of Object.entries(raw.icons)) if (typeof icon === "string") icons[pkg] = icon;
  return {
    receiving: raw.receiving === true,
    paired: raw.paired === true,
    onPhone: parseNotices(raw.onPhone),
    earlier: parseNotices(raw.earlier),
    icons,
  };
}

const CODE_WORDS =
  /\b(otp|code|passcode|password|pin|verification|verify|one[\s-]?time|2fa|security|login|sign[\s-]?in|authenticat\w*)\b/i;
const CODE_DIGITS = /(?<![\d.,:/])\d{4,8}(?![\d.,:/-]?\d)/g;

/** A one-time code: a 4–8 digit number next to words like "OTP" or "code". */
export function looksLikeCode(notice: Pick<PhoneNotice, "title" | "text">): boolean {
  const both = `${notice.title}\n${notice.text}`;
  CODE_DIGITS.lastIndex = 0;
  return CODE_WORDS.test(both) && CODE_DIGITS.test(both);
}

/** The text with any 4–8 digit number dotted out. */
export function maskCodes(value: string): string {
  return value.replace(CODE_DIGITS, (digits) => "•".repeat(digits.length));
}

/** "now", "5 min", "3 h", then the day and time. */
export function noticeTime(postedAt: number, now: number): string {
  const minutes = Math.floor((now - postedAt) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`;
  return new Date(postedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}
