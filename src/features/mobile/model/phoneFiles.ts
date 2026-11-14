/**
 * Fork (Hari, L-297): one folder of the phone's storage, as the phone lists it
 * for the computer's Phone files browser.
 */
export type PhoneFileItem = { name: string; path: string; dir: boolean; size: number; modified: number };
export type PhoneFolder = {
  path: string;
  parent: string | null;
  label: string;
  total: number;
  items: PhoneFileItem[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads the phone's answer; null when it isn't a folder list. */
export function parsePhoneFolder(raw: unknown): PhoneFolder | null {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isRecord(value) || typeof value.path !== "string" || !Array.isArray(value.items)) return null;
  const items: PhoneFileItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.path !== "string") continue;
    items.push({
      name: item.name,
      path: item.path,
      dir: item.dir === true,
      size: typeof item.size === "number" ? item.size : 0,
      modified: typeof item.modified === "number" ? item.modified : 0,
    });
  }
  const root = typeof value.root === "string" ? value.root : "";
  const inside = root && value.path.startsWith(root) ? value.path.slice(root.length) : value.path;
  return {
    path: value.path,
    parent: typeof value.parent === "string" && value.parent ? value.parent : null,
    label: `Phone${inside ? ` / ${inside.replace(/^\/+/, "").split("/").join(" / ")}` : ""}`,
    total: typeof value.total === "number" ? value.total : items.length,
    items,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
