/**
 * Fork (L-207): Browser findings as short text notes for a chat. Each note is
 * what an agent needs to find the code (selector, component, source file)
 * and nothing more, so a few picks cost a few hundred tokens, not a page
 * dump or a screenshot. Modelled on React Grab and Agentation.
 */

export type PickRect = { x: number; y: number; width: number; height: number };

export type PickItem = {
  tag: string;
  path: string;
  text?: string;
  role?: string;
  label?: string;
  href?: string;
  components?: string[];
  source?: string;
  rect?: PickRect;
  styles?: Record<string, string>;
  comment?: string;
};

export type PicksPayload = {
  kind: "picks";
  url: string;
  title?: string;
  viewport?: { width: number; height: number };
  items: PickItem[];
};

export type ConsoleRow = {
  kind: "console";
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  source?: string | null;
};

export type NetworkRow = {
  kind: "network";
  id: string;
  method: string;
  url: string;
  type?: string;
  postData?: string | null;
  status?: number;
  statusText?: string;
  mimeType?: string;
  error?: string;
  size?: number;
  done: boolean;
};

/** Styles worth naming for a visual change; the box gives size already. */
const STYLE_KEYS = [
  "font-size",
  "font-weight",
  "color",
  "background-color",
  "padding",
  "margin",
  "gap",
  "border-radius",
  "opacity",
];

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Shortens long page addresses: keeps origin and path, drops long queries. */
export function shortUrl(url: string, max = 160): string {
  try {
    const parsed = new URL(url);
    const base = `${parsed.origin}${parsed.pathname}`;
    const query = parsed.search.length > 60 ? "?…" : parsed.search;
    return oneLine(base + query, max);
  } catch {
    return oneLine(url, max);
  }
}

/** A dev-server source URL to a project path: /src/App.tsx:12. */
export function sourcePath(source: string): string {
  try {
    const parsed = new URL(source.replace(/:(\d+)(?::\d+)?$/, ""));
    const line = source.match(/:(\d+)(?::\d+)?$/)?.[1];
    const path = decodeURIComponent(parsed.pathname).replace(/^\/@fs\//, "/");
    return line ? `${path}:${line}` : path;
  } catch {
    return source;
  }
}

function pickLines(item: PickItem, index: number): string[] {
  const head = [`<${item.tag}>`];
  if (item.text) head.push(JSON.stringify(oneLine(item.text, 80)));
  if (item.role) head.push(`role=${item.role}`);
  if (item.label && item.label !== item.text) head.push(`aria-label=${JSON.stringify(item.label)}`);
  if (item.href) head.push(`href=${item.href}`);
  const lines = [
    `${index + 1}. ${item.comment?.trim() ? oneLine(item.comment, 1000) : "(no comment)"}`,
    `   element: ${head.join(" ")}`,
    `   selector: ${item.path}`,
  ];
  if (item.components?.length) lines.push(`   component: ${item.components.join(" < ")}`);
  if (item.source) lines.push(`   source: ${sourcePath(item.source)}`);
  const styles = STYLE_KEYS.filter((key) => item.styles?.[key])
    .map((key) => `${key}: ${item.styles![key]}`)
    .join("; ");
  const box = item.rect
    ? `${item.rect.width}×${item.rect.height} at ${item.rect.x},${item.rect.y}`
    : "";
  if (box || styles) lines.push(`   ${[box && `box: ${box}`, styles].filter(Boolean).join(" · ")}`);
  return lines;
}

/** Page picks with comments as one note. */
export function picksNote(payload: PicksPayload): string {
  const where = [
    payload.title ? oneLine(payload.title, 80) : null,
    shortUrl(payload.url),
    payload.viewport ? `viewport ${payload.viewport.width}×${payload.viewport.height}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const items = payload.items.flatMap((item, index) => pickLines(item, index));
  return [
    `Browser feedback on ${where}`,
    "Each item: the change asked for, then how to find the element.",
    "",
    ...items,
  ].join("\n");
}

export function consoleNote(row: ConsoleRow, pageUrl?: string): string {
  const lines = [`Browser console ${row.level}${pageUrl ? ` on ${shortUrl(pageUrl)}` : ""}:`];
  lines.push(row.text.length > 4000 ? `${row.text.slice(0, 4000)}…` : row.text);
  if (row.source) lines.push(`at ${sourcePath(row.source)}`);
  return lines.join("\n");
}

/** Response bodies are cut hard: the start of a payload is what explains it. */
export const MAX_BODY_CHARS = 3000;

export function networkNote(
  row: NetworkRow,
  body?: { body: string; base64Encoded?: boolean } | null,
): string {
  const status = row.error
    ? `failed: ${row.error}`
    : row.status != null
      ? `${row.status}${row.statusText ? ` ${row.statusText}` : ""}`
      : "pending";
  const lines = [
    `Browser network request: ${row.method} ${shortUrl(row.url, 400)}`,
    `status: ${status}${row.mimeType ? ` · ${row.mimeType}` : ""}${row.size != null ? ` · ${row.size} bytes` : ""}`,
  ];
  if (row.postData) {
    lines.push("request body:", oneLine(row.postData, 2000));
  }
  if (body && !body.base64Encoded && body.body) {
    const text = body.body.trim();
    lines.push(
      "response body:",
      text.length > MAX_BODY_CHARS
        ? `${text.slice(0, MAX_BODY_CHARS)}… (${text.length - MAX_BODY_CHARS} more characters cut)`
        : text,
    );
  } else if (body?.base64Encoded) {
    lines.push("response body: binary, not included");
  }
  return lines.join("\n");
}

/** Whether a response body is worth fetching as text. */
export function textualMime(mime?: string): boolean {
  if (!mime) return false;
  return /^text\/|json|xml|javascript|graphql|x-www-form-urlencoded/i.test(mime);
}

/** A short chip name for a note. */
export function noteName(kind: string, detail: string): string {
  return oneLine(`${kind}: ${detail}`, 48);
}
