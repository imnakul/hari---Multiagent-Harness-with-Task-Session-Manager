// Fork (Hari, L-292..L-297): what the computer says about its sound, media,
// camera, Bluetooth, hibernate-on-idle and files. Anything unexpected is
// dropped rather than trusted.

const record = (raw: unknown): Record<string, unknown> =>
  typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
const text = (raw: unknown): string | undefined => (typeof raw === "string" && raw ? raw : undefined);
const flag = (raw: unknown): boolean | undefined => (typeof raw === "boolean" ? raw : undefined);
const num = (raw: unknown): number | undefined => (typeof raw === "number" && Number.isFinite(raw) ? raw : undefined);
const list = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);

export type PcAudio = {
  micMuted?: boolean;
  speakerMuted: boolean;
  volume: number;
  outputs: { id: string; name: string; default: boolean }[];
};

export function parseAudio(raw: unknown): PcAudio {
  const value = record(raw);
  return {
    micMuted: flag(value.micMuted),
    speakerMuted: flag(value.speakerMuted) ?? false,
    volume: Math.min(1, Math.max(0, num(value.volume) ?? 0)),
    outputs: list(value.outputs).flatMap((item) => {
      const output = record(item);
      const id = text(output.id);
      return id ? [{ id, name: text(output.name) ?? "Sound output", default: output.default === true }] : [];
    }),
  };
}

export type PcMedia = { playing: boolean; title?: string; artist?: string; app?: string };

export function parseMedia(raw: unknown): PcMedia {
  const value = record(raw);
  return {
    playing: value.playing === true,
    title: text(value.title),
    artist: text(value.artist),
    app: text(value.app),
  };
}

export type PcBluetooth = { available: boolean; on: boolean; devices: { name: string; connected: boolean }[] };

export function parseBluetooth(raw: unknown): PcBluetooth {
  const value = record(raw);
  return {
    available: value.available === true,
    on: value.on === true,
    devices: list(value.devices).flatMap((item) => {
      const device = record(item);
      const name = text(device.name);
      return name ? [{ name, connected: device.connected === true }] : [];
    }),
  };
}

export type PcFileEntry = {
  name: string;
  path: string;
  dir: boolean;
  drive: boolean;
  size?: number;
  modified?: number;
  free?: number;
  total?: number;
};

export type PcFolder = { path: string; parent: string | null; entries: PcFileEntry[]; more: boolean };

export function parseFolder(raw: unknown): PcFolder {
  const value = record(raw);
  return {
    path: typeof value.path === "string" ? value.path : "",
    parent: typeof value.parent === "string" ? value.parent : null,
    more: value.more === true,
    entries: list(value.entries).flatMap((item) => {
      const entry = record(item);
      const name = text(entry.name);
      const path = text(entry.path);
      if (!name || !path) return [];
      return [
        {
          name,
          path,
          dir: entry.dir === true,
          drive: entry.drive === true,
          size: num(entry.size),
          modified: num(entry.modified),
          free: num(entry.free),
          total: num(entry.total),
        },
      ];
    }),
  };
}
