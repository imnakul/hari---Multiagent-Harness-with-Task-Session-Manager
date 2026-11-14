/**
 * Fork (Hari, L-280): what the paired phone reports about itself (battery,
 * temperature, storage, network) and the apps the phone may open on this
 * computer. Read defensively from the Rust side (`mobile_pc_*`): a field of the
 * wrong shape is dropped, a row without its required fields is skipped.
 */

export type PhoneNetwork = "wifi" | "cellular" | "ethernet" | "none" | "other";

export type PhoneStats = {
  /** 0..1. */
  battery?: number;
  charging?: boolean;
  /** Battery temperature, °C. */
  temperature?: number;
  storageFree?: number;
  storageTotal?: number;
  network?: PhoneNetwork;
};

export type PhoneStatsRow = {
  peer: string;
  name: string;
  /** When the phone last reported, ms; undefined when it never has. */
  at?: number;
  stats?: PhoneStats;
};

export type PhoneApp = { id: string; name: string; detail: string };

export const PHONE_STATS_EVENT = "monocode-phone-stats";
/** Stats older than this are shown as old (the phone sends every 5 s while asked). */
export const PHONE_STATS_FRESH_MS = 30_000;

const NETWORKS: readonly PhoneNetwork[] = ["wifi", "cellular", "ethernet", "none", "other"];
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
const number = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;

export function parsePhoneStats(raw: unknown): PhoneStats | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const stats: PhoneStats = {};
  const battery = number(field(raw, "battery"), 0, 1);
  const charging = field(raw, "charging");
  const temperature = number(field(raw, "temperature"), -40, 150);
  const storageFree = number(field(raw, "storageFree"), 0, Number.MAX_SAFE_INTEGER);
  const storageTotal = number(field(raw, "storageTotal"), 0, Number.MAX_SAFE_INTEGER);
  const network = field(raw, "network");
  if (battery !== undefined) stats.battery = battery;
  if (typeof charging === "boolean") stats.charging = charging;
  if (temperature !== undefined) stats.temperature = temperature;
  if (storageFree !== undefined && storageTotal !== undefined && storageFree <= storageTotal) {
    stats.storageFree = storageFree;
    stats.storageTotal = storageTotal;
  }
  if (typeof network === "string") {
    const known = NETWORKS.find((kind) => kind === network);
    if (known) stats.network = known;
  }
  return stats;
}

export function parsePhoneStatsRow(raw: unknown): PhoneStatsRow | null {
  const peer = field(raw, "peer");
  if (typeof peer !== "string" || !peer) return null;
  const name = field(raw, "name");
  const row: PhoneStatsRow = { peer, name: typeof name === "string" && name.trim() ? name : "Phone" };
  const at = number(field(raw, "at"), 0, Number.MAX_SAFE_INTEGER);
  const stats = parsePhoneStats(field(raw, "stats"));
  if (at !== undefined && stats) {
    row.at = at;
    row.stats = stats;
  }
  return row;
}

export function parsePhoneStatsList(raw: unknown): PhoneStatsRow[] {
  const phones = field(raw, "phones");
  return Array.isArray(phones)
    ? phones.map(parsePhoneStatsRow).filter((row): row is PhoneStatsRow => row !== null)
    : [];
}

/** Replaces the row for the same phone (a live update), or adds it. */
export function mergePhoneStats(rows: PhoneStatsRow[], update: PhoneStatsRow): PhoneStatsRow[] {
  if (!update.stats) return rows;
  const index = rows.findIndex((row) => row.peer === update.peer);
  if (index < 0) return [...rows, update];
  return rows.map((row, at) => (at === index ? { ...row, ...update, name: update.name || row.name } : row));
}

const GB = 1024 ** 3;

/** "82% · charging · 34 °C · 41 of 128 GB free · Wi-Fi" — pieces in order. */
export function phoneStatsParts(stats: PhoneStats): string[] {
  const parts: string[] = [];
  if (stats.battery !== undefined) {
    parts.push(`${Math.round(stats.battery * 100)}%${stats.charging ? " · charging" : ""}`);
  }
  if (stats.temperature !== undefined) parts.push(`${Math.round(stats.temperature)} °C`);
  if (stats.storageFree !== undefined && stats.storageTotal !== undefined) {
    parts.push(`${Math.round(stats.storageFree / GB)} of ${Math.round(stats.storageTotal / GB)} GB free`);
  }
  if (stats.network) {
    const label: Record<PhoneNetwork, string> = {
      wifi: "Wi-Fi",
      cellular: "Mobile data",
      ethernet: "Ethernet",
      none: "Offline",
      other: "Online",
    };
    parts.push(label[stats.network]);
  }
  return parts;
}

export function parsePhoneApps(raw: unknown): PhoneApp[] {
  const apps = field(raw, "apps");
  if (!Array.isArray(apps)) return [];
  return apps.flatMap((item: unknown) => {
    const id = field(item, "id");
    const name = field(item, "name");
    const detail = field(item, "detail");
    return typeof id === "string" && id && typeof name === "string" && name
      ? [{ id, name, detail: typeof detail === "string" ? detail : "" }]
      : [];
  });
}
