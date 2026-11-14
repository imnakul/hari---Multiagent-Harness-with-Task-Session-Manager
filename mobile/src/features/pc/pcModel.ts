// Fork (Hari, L-280): what the computer reports for the Computer screen, read
// defensively (a field of the wrong shape is dropped, a row without what it
// needs is skipped), and the rules for the computer's `ring` and `stats.want`.

export type PcStats = {
  /** Percent, 0..100; undefined until the computer has two readings. */
  cpu?: number;
  gpu?: number;
  memory?: { used: number; total: number };
  disks: { name: string; free: number; total: number }[];
  /** Bytes per second. */
  network?: { down?: number; up?: number };
  /** Seconds since Windows started. */
  uptime?: number;
  /** Fork (L-288): off from the phone, with no input on the computer since. */
  monitorOff?: boolean;
};

export type PcApp = {
  pid: number;
  /** Pid and start time: a reused pid never matches. */
  identity: string;
  name: string;
  title: string;
  cpu?: number;
  memory: number;
  windows: number;
  /** MonoCode itself: Close and End are refused. */
  self: boolean;
  /** Part of Windows: End is refused. */
  protected: boolean;
};

export type PcShortcut = { id: string; name: string; self: boolean; found: boolean; running: boolean };

export type WakeCard = { name: string; mac: string; broadcast: string; wifi: boolean };

export type AppSort = "cpu" | "memory" | "name";

/** Changes the computer: refused there when `sentAt` is over a minute off. */
export type PcAction = "close" | "end" | "minimize" | "maximize";
export type PowerAction = "monitorOff" | "monitorOn" | "lock" | "hibernate";
export type ShortcutAction = "open" | "close" | "minimize" | "maximize" | "restart";

/** A ring older than this is ignored (the phone was off when it was sent). */
export const RING_MAX_AGE_MS = 2 * 60_000;
/** The phone sends its stats every this often while the computer asks. */
export const PHONE_STATS_EVERY_MS = 5_000;
/** One ask runs at most this long (the computer renews it every 45 s). */
export const PHONE_STATS_MAX_MS = 90_000;

const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
const number = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function parsePcStats(raw: unknown): PcStats {
  const stats: PcStats = { disks: [] };
  const cpu = number(field(raw, "cpu"), 0, 100);
  const gpu = number(field(raw, "gpu"), 0, 100);
  const used = number(field(field(raw, "memory"), "used"));
  const total = number(field(field(raw, "memory"), "total"));
  const down = number(field(field(raw, "network"), "down"));
  const up = number(field(field(raw, "network"), "up"));
  const uptime = number(field(raw, "uptime"));
  if (cpu !== undefined) stats.cpu = cpu;
  if (gpu !== undefined) stats.gpu = gpu;
  if (used !== undefined && total !== undefined && total > 0 && used <= total) stats.memory = { used, total };
  if (down !== undefined || up !== undefined) stats.network = { down, up };
  if (uptime !== undefined) stats.uptime = uptime;
  if (field(raw, "monitorOff") === true) stats.monitorOff = true;
  for (const disk of list(field(raw, "disks"))) {
    const name = text(field(disk, "name"));
    const free = number(field(disk, "free"));
    const size = number(field(disk, "total"));
    if (name && free !== undefined && size !== undefined && size > 0 && free <= size)
      stats.disks.push({ name, free, total: size });
  }
  return stats;
}

export function parsePcApps(raw: unknown): PcApp[] {
  return list(field(raw, "apps")).flatMap((item): PcApp[] => {
    const pid = number(field(item, "pid"), 1, 0xffffffff);
    const identity = text(field(item, "identity"));
    const name = text(field(item, "name"));
    if (pid === undefined || !identity || !name) return [];
    return [
      {
        pid,
        identity,
        name,
        title: text(field(item, "title")),
        cpu: number(field(item, "cpu"), 0, 100),
        memory: number(field(item, "memory")) ?? 0,
        windows: number(field(item, "windows")) ?? 1,
        self: field(item, "self") === true,
        protected: field(item, "protected") === true,
      },
    ];
  });
}

export function parsePcShortcuts(raw: unknown): PcShortcut[] {
  return list(field(raw, "apps")).flatMap((item): PcShortcut[] => {
    const id = text(field(item, "id"));
    const name = text(field(item, "name"));
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        self: field(item, "self") === true,
        found: field(item, "found") !== false,
        running: field(item, "running") === true,
      },
    ];
  });
}

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseWakeCards(raw: unknown): WakeCard[] {
  const cards = Array.isArray(raw) ? raw : list(field(raw, "cards"));
  return cards.flatMap((item): WakeCard[] => {
    const mac = text(field(item, "mac")).toUpperCase();
    const broadcast = text(field(item, "broadcast"));
    const octets = IPV4.exec(broadcast);
    if (!MAC.test(mac) || mac === "00:00:00:00:00:00") return [];
    if (!octets || octets.slice(1).some((octet) => Number(octet) > 255)) return [];
    return [{ name: text(field(item, "name")) || "Network card", mac, broadcast, wifi: field(item, "wifi") === true }];
  });
}

export function sortPcApps(apps: PcApp[], by: AppSort): PcApp[] {
  const byName = (a: PcApp, b: PcApp) =>
    (a.title || a.name).localeCompare(b.title || b.name, undefined, { sensitivity: "base" });
  return [...apps].sort((a, b) => {
    if (by === "cpu") return (b.cpu ?? -1) - (a.cpu ?? -1) || byName(a, b);
    if (by === "memory") return b.memory - a.memory || byName(a, b);
    return byName(a, b);
  });
}

/** "1.4 GB", "820 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export const formatRate = (bytesPerSecond: number | undefined): string =>
  bytesPerSecond === undefined ? "—" : `${formatBytes(bytesPerSecond)}/s`;

/** "3 d 4 h", "5 h 12 m", "14 m". */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  return `${minutes} m`;
}

/** The computer's `ring` item: what to do, or null when it's old or malformed. */
export function parseRing(payload: unknown, now: number): "start" | "stop" | null {
  const action = field(payload, "action");
  const at = number(field(payload, "at"));
  if (action !== "start" && action !== "stop") return null;
  // Stop always applies; an old start would ring long after anyone asked.
  if (action === "start" && (at === undefined || Math.abs(now - at) > RING_MAX_AGE_MS)) return null;
  return action;
}

/**
 * The computer's `stats.want {until}`: when (phone clock) to stop sending, or
 * null when the ask is already over. Clamped, so a clock gap between the two
 * can't keep the phone sending for long.
 */
export function statsWantUntil(payload: unknown, now: number): number | null {
  const until = number(field(payload, "until"));
  if (until === undefined || until <= now) return null;
  return now + Math.min(until - now, PHONE_STATS_MAX_MS);
}

/** Why a request failed, in words for the screen. */
export function pcError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/Unsupported mobile operation/i.test(message)) return "Update MonoCode on your computer to use this.";
  return message;
}
