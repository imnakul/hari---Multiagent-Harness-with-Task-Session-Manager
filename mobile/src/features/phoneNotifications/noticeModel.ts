/**
 * Fork (Hari, L-325): the phone's notifications as they go to the computer.
 * The native list is read defensively (an entry of the wrong shape is
 * dropped), and skipped apps are filtered out here, so their notifications
 * never leave the phone.
 */

export type PhoneNotice = {
  key: string;
  package: string;
  app: string;
  title: string;
  text: string;
  postedAt: number;
};

/** `stalled` (L-334): access is on but Android hasn't started the reader. */
export type ActiveNotices = { listening: boolean; stalled: boolean; items: PhoneNotice[] };

/**
 * Pre-filled skip list: banking, UPI, authenticator and password apps, whose
 * notifications carry money alerts and sign-in codes. Editable in Settings.
 */
export const DEFAULT_SKIPPED_APPS: readonly string[] = [
  "com.google.android.apps.authenticator2",
  "com.azure.authenticator",
  "com.authy.authy",
  "com.x8bit.bitwarden",
  "com.onepassword.android",
  "com.lastpass.lpandroid",
  "com.google.android.apps.nbu.paisa.user",
  "com.phonepe.app",
  "net.one97.paytm",
  "in.org.npci.upiapp",
  "com.dreamplug.androidapp",
  "com.mobikwik_new",
  "com.sbi.lotusintouch",
  "com.sbi.SBIFreedomPlus",
  "com.snapwork.hdfc",
  "com.csam.icici.bank.imobile",
  "com.axis.mobile",
  "com.msf.kbank.mobile",
  "com.bankofbaroda.mconnect",
  "com.pnb.pnbone",
  "com.canarabank.mobility",
  "com.unionbank.ecommerce.mobile.android",
  "com.idbibank.abhay_card",
  "com.fss.indus",
  "com.yesbank",
];

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

function parseNotice(value: unknown): PhoneNotice | null {
  const key = text(field(value, "key"));
  const pkg = text(field(value, "package"));
  const postedAt = field(value, "postedAt");
  if (!key || !pkg || typeof postedAt !== "number" || !Number.isFinite(postedAt)) return null;
  return {
    key,
    package: pkg,
    app: text(field(value, "app")) || pkg,
    title: text(field(value, "title")) ?? "",
    text: text(field(value, "text")) ?? "",
    postedAt,
  };
}

/** The native module's JSON list; nothing when it can't be read. */
export function parseActiveNotices(raw: string): ActiveNotices {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { listening: false, stalled: false, items: [] };
  }
  const items = field(parsed, "items");
  const listening = field(parsed, "listening") === true;
  return {
    listening,
    stalled: !listening && field(parsed, "allowed") === true,
    items: Array.isArray(items)
      ? items.map(parseNotice).filter((notice): notice is PhoneNotice => notice !== null)
      : [],
  };
}

/** The notifications that may go to the computer: none from a skipped app. */
export function noticesToSend(items: readonly PhoneNotice[], skipped: readonly string[]): PhoneNotice[] {
  const skip = new Set(skipped);
  return items.filter((notice) => !skip.has(notice.package));
}

/** Apps whose icons the computer hasn't had on this connection. */
export function iconsNeeded(items: readonly PhoneNotice[], sent: ReadonlySet<string>): string[] {
  return [...new Set(items.map((notice) => notice.package))].filter((pkg) => !sent.has(pkg));
}

export type SkipRow = { package: string; app: string; skipped: boolean };

/**
 * The rows of the skip list screen: apps showing notifications now and
 * skipped apps that are installed (named), skipped first, then by name.
 */
export function skipRows(
  active: readonly PhoneNotice[],
  skipped: readonly string[],
  installedNames: Readonly<Record<string, string>>,
): SkipRow[] {
  const rows = new Map<string, SkipRow>();
  const skip = new Set(skipped);
  for (const notice of active) {
    rows.set(notice.package, { package: notice.package, app: notice.app, skipped: skip.has(notice.package) });
  }
  for (const pkg of skipped) {
    const name = installedNames[pkg];
    if (name && !rows.has(pkg)) rows.set(pkg, { package: pkg, app: name, skipped: true });
  }
  return [...rows.values()].sort(
    (a, b) => Number(b.skipped) - Number(a.skipped) || a.app.localeCompare(b.app),
  );
}
