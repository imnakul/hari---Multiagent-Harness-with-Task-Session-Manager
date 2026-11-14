/** What `aside_link_status` reports. */
export type LinkStatus = {
  enabled: boolean;
  port: number;
  listening: boolean;
  /** Why the server is not listening, when it failed to start. */
  status: string;
  /** Whether a MonoCode window is answering requests. */
  attached: boolean;
  projectPath: string;
};

function field<T>(value: Record<string, unknown>, key: string, check: (item: unknown) => item is T): T {
  const item = value[key];
  if (!check(item)) throw new Error(`Aside link status has no valid ${key}`);
  return item;
}

const isBoolean = (item: unknown): item is boolean => typeof item === "boolean";
const isString = (item: unknown): item is string => typeof item === "string";
const isNumber = (item: unknown): item is number => typeof item === "number" && Number.isInteger(item);

/** Validates the status returned by the desktop side. */
export function parseLinkStatus(value: unknown): LinkStatus {
  if (!value || typeof value !== "object") throw new Error("Aside link status is missing");
  const record = value as Record<string, unknown>; // Narrowed to a non-null object above.
  return {
    enabled: field(record, "enabled", isBoolean),
    port: field(record, "port", isNumber),
    listening: field(record, "listening", isBoolean),
    status: field(record, "status", isString),
    attached: field(record, "attached", isBoolean),
    projectPath: field(record, "projectPath", isString),
  };
}

/** A port the link may use (1024–65535), or null. */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port >= 1024 && port <= 65535 ? port : null;
}
