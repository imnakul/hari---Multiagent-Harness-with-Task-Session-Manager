/**
 * Whiteboard agent chat (fork, L-194): the prompt that shows an AI helper
 * what is on the sheet, and the parser for its reply. The reply is plain
 * text plus, when it draws, one fenced `whiteboard` JSON block of changes.
 */

/** The parts of an Excalidraw element the agent sees. */
export type SceneElementLike = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  containerId?: string | null;
  text?: string;
  strokeColor?: string;
  backgroundColor?: string;
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};

export type WhiteboardShapeType = "rectangle" | "ellipse" | "diamond";
export type WhiteboardStrokeStyle = "solid" | "dashed" | "dotted";
export type WhiteboardFillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";

type Style = {
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: WhiteboardStrokeStyle;
  fillStyle?: WhiteboardFillStyle;
};

export type WhiteboardAddShape = Style & {
  type: WhiteboardShapeType;
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
};

export type WhiteboardAddText = Style & {
  type: "text";
  id?: string;
  x: number;
  y: number;
  text: string;
  fontSize?: number;
};

export type WhiteboardAddLine = Style & {
  type: "arrow" | "line";
  id?: string;
  /** Ids of the shapes it joins (new in this reply or already on the sheet). */
  from?: string;
  to?: string;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  label?: string;
};

export type WhiteboardAdd = WhiteboardAddShape | WhiteboardAddText | WhiteboardAddLine;

export type WhiteboardUpdate = Style & {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
};

export type WhiteboardOps = {
  clear: boolean;
  remove: string[];
  update: WhiteboardUpdate[];
  add: WhiteboardAdd[];
};

export type WhiteboardChatMessage = {
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Short note of what the reply drew, e.g. "Drew 6 items". */
  note?: string;
  error?: boolean;
};

export type WhiteboardReply = { text: string; ops: WhiteboardOps | null };

const SCENE_LIMIT = 120;
const ADD_LIMIT = 200;
const HISTORY_LIMIT = 12;
const HISTORY_TEXT_LIMIT = 1500;
const SIZE_MIN = 1;
const SIZE_MAX = 4000;
const COORD_LIMIT = 100_000;

const round = (value: number) => Math.round(value);
const oneLine = (text: string, limit = 80) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

/** One compact line per visible element; text inside a shape shows as its label. */
export function describeScene(
  elements: readonly SceneElementLike[],
  limit = SCENE_LIMIT,
): string[] {
  const live = elements.filter((element) => !element.isDeleted);
  const labels = new Map<string, string>();
  for (const element of live) {
    if (element.type === "text" && element.containerId && element.text) {
      labels.set(element.containerId, element.text);
    }
  }
  const lines: string[] = [];
  const shown = live.filter((element) => !(element.type === "text" && element.containerId));
  for (const element of shown.slice(0, limit)) {
    const parts = [element.id, element.type];
    if (element.type === "arrow" || element.type === "line") {
      if (element.startBinding?.elementId) parts.push(`from=${element.startBinding.elementId}`);
      if (element.endBinding?.elementId) parts.push(`to=${element.endBinding.elementId}`);
    }
    parts.push(
      `x=${round(element.x)}`,
      `y=${round(element.y)}`,
      `w=${round(element.width)}`,
      `h=${round(element.height)}`,
    );
    const label = element.type === "text" ? element.text : labels.get(element.id);
    if (label) parts.push(JSON.stringify(oneLine(label)));
    if (element.strokeColor && element.strokeColor !== "#1e1e1e") {
      parts.push(`stroke=${element.strokeColor}`);
    }
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      parts.push(`fill=${element.backgroundColor}`);
    }
    lines.push(parts.join(" "));
  }
  if (shown.length > limit) lines.push(`… and ${shown.length - limit} more`);
  return lines;
}

export function buildWhiteboardPrompt(input: {
  message: string;
  history: readonly WhiteboardChatMessage[];
  scene: readonly SceneElementLike[];
  locked?: boolean;
}): string {
  const scene = describeScene(input.scene);
  const history = input.history
    .filter((message) => !message.error)
    .slice(-HISTORY_LIMIT)
    .map((message) => {
      const who = message.role === "user" ? "User" : "You";
      const note = message.note ? ` (${message.note})` : "";
      return `${who}: ${oneLine(message.text, HISTORY_TEXT_LIMIT)}${note}`;
    });
  return [
    "You are the drawing assistant on a whiteboard (Excalidraw) inside MonoCode.",
    "Answer in plain text, 1–3 short sentences. When the user wants something drawn or changed, add ONE fenced block tagged whiteboard after the text, holding JSON:",
    "```whiteboard",
    '{"clear":false,"remove":["old-id"],"update":[{"id":"box1","x":100,"label":"New label","backgroundColor":"#a5d8ff"}],"add":[',
    '  {"type":"rectangle","id":"login","x":100,"y":100,"width":180,"height":70,"label":"Login"},',
    '  {"type":"diamond","id":"ok","x":360,"y":90,"width":160,"height":90,"label":"Valid?"},',
    '  {"type":"arrow","from":"login","to":"ok","label":"submit"},',
    '  {"type":"text","x":100,"y":40,"text":"Sign-in flow","fontSize":28}',
    "]}",
    "```",
    "Rules:",
    "- Types: rectangle, ellipse, diamond (need x, y, width, height; optional label), text (x, y, text, fontSize), arrow or line (from/to ids, or x, y, endX, endY; optional label).",
    "- Coordinates are pixels, x to the right, y down. Leave about 60px between shapes; a normal box is about 180x70.",
    "- Give every new shape an id so arrows can use it; arrows may also join shapes already on the sheet by their ids.",
    "- Put new drawings beside or below what is already there unless asked to change it. Use clear only when asked to start over.",
    "- Optional styles: strokeColor and backgroundColor as hex (#1e1e1e, #e03131, #2f9e44, #1971c2, #f08c00, #a5d8ff, #b2f2bb, #ffec99, #ffc9c9) or transparent; strokeStyle solid, dashed or dotted; fillStyle solid, hachure or cross-hatch.",
    "- At most 60 new elements per reply. Do not use tools or read files; you only draw.",
    input.locked
      ? "- The sheet is locked (view only): answer, but do not include a whiteboard block."
      : "",
    "",
    scene.length
      ? `On the sheet now (${scene.length} lines; id type position size "label"):\n${scene.join("\n")}`
      : "The sheet is empty.",
    "",
    history.length ? `Conversation so far:\n${history.join("\n")}\n` : "",
    `User: ${input.message.trim()}`,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

const COLOR = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$/;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const STROKES = new Set(["solid", "dashed", "dotted"]);
const FILLS = new Set(["hachure", "cross-hatch", "solid", "zigzag"]);

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  !!value && typeof value === "object" && !Array.isArray(value);

function num(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}
function coord(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, parsed));
}
function size(value: unknown, fallback?: number): number | undefined {
  const parsed = num(value) ?? fallback;
  return parsed === undefined ? undefined : Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.abs(parsed)));
}
function str(value: unknown, limit = 2000): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).slice(0, limit);
  return text.trim() ? text : undefined;
}
function id(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && ID.test(text) ? text : undefined;
}

function style(raw: Raw): Style {
  const out: Style = {};
  if (typeof raw.strokeColor === "string" && COLOR.test(raw.strokeColor)) out.strokeColor = raw.strokeColor;
  if (typeof raw.backgroundColor === "string" && COLOR.test(raw.backgroundColor)) {
    out.backgroundColor = raw.backgroundColor;
  }
  if (typeof raw.strokeStyle === "string" && STROKES.has(raw.strokeStyle)) {
    out.strokeStyle = raw.strokeStyle as WhiteboardStrokeStyle;
  }
  if (typeof raw.fillStyle === "string" && FILLS.has(raw.fillStyle)) {
    out.fillStyle = raw.fillStyle as WhiteboardFillStyle;
  }
  return out;
}

function fontSize(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : Math.max(8, Math.min(120, Math.round(parsed)));
}

function parseAdd(raw: unknown): WhiteboardAdd | null {
  if (!isRaw(raw) || typeof raw.type !== "string") return null;
  const type = raw.type.toLowerCase();
  const common = { ...style(raw), ...(id(raw.id) ? { id: id(raw.id) } : {}) };
  if (SHAPES.has(type)) {
    const x = coord(raw.x);
    const y = coord(raw.y);
    if (x === undefined || y === undefined) return null;
    const label = str(raw.label ?? raw.text, 500);
    const size_ = fontSize(raw.fontSize);
    return {
      type: type as WhiteboardShapeType,
      ...common,
      x,
      y,
      width: size(raw.width ?? raw.w, 180)!,
      height: size(raw.height ?? raw.h, 70)!,
      ...(label ? { label } : {}),
      ...(size_ ? { fontSize: size_ } : {}),
    };
  }
  if (type === "text") {
    const x = coord(raw.x);
    const y = coord(raw.y);
    const text = str(raw.text ?? raw.label);
    if (x === undefined || y === undefined || !text) return null;
    const size_ = fontSize(raw.fontSize);
    return { type: "text", ...common, x, y, text, ...(size_ ? { fontSize: size_ } : {}) };
  }
  if (type === "arrow" || type === "line") {
    const from = id(raw.from ?? raw.start);
    const to = id(raw.to ?? raw.end);
    const x = coord(raw.x);
    const y = coord(raw.y);
    const endX = coord(raw.endX ?? raw.x2);
    const endY = coord(raw.endY ?? raw.y2);
    const free = x !== undefined && y !== undefined && endX !== undefined && endY !== undefined;
    if (!(from && to) && !free) return null;
    const label = str(raw.label, 200);
    return {
      type,
      ...common,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(free ? { x, y, endX, endY } : {}),
      ...(label ? { label } : {}),
    };
  }
  return null;
}

function parseUpdate(raw: unknown): WhiteboardUpdate | null {
  if (!isRaw(raw)) return null;
  const target = id(raw.id);
  if (!target) return null;
  const update: WhiteboardUpdate = { id: target, ...style(raw) };
  const x = coord(raw.x);
  const y = coord(raw.y);
  const width = num(raw.width) === undefined ? undefined : size(raw.width);
  const height = num(raw.height) === undefined ? undefined : size(raw.height);
  if (x !== undefined) update.x = x;
  if (y !== undefined) update.y = y;
  if (width !== undefined) update.width = width;
  if (height !== undefined) update.height = height;
  if (typeof raw.label === "string") update.label = raw.label.slice(0, 500);
  return Object.keys(update).length > 1 ? update : null;
}

/** Reads the changes object; `null` when it has nothing usable. */
export function parseWhiteboardOps(value: unknown): WhiteboardOps | null {
  const data = Array.isArray(value) ? { add: value } : value;
  if (!isRaw(data)) return null;
  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
  const ops: WhiteboardOps = {
    clear: data.clear === true,
    remove: list("remove").map(id).filter((entry): entry is string => !!entry),
    update: list("update").map(parseUpdate).filter((entry): entry is WhiteboardUpdate => !!entry),
    add: list("add")
      .slice(0, ADD_LIMIT)
      .map(parseAdd)
      .filter((entry): entry is WhiteboardAdd => !!entry),
  };
  return ops.clear || ops.remove.length || ops.update.length || ops.add.length ? ops : null;
}

const FENCE = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g;

/**
 * Splits a reply into its text and its drawing changes. Takes the last
 * `whiteboard` block, or else the last `json` block shaped like changes.
 */
export function parseWhiteboardReply(raw: string): WhiteboardReply {
  const blocks = [...raw.matchAll(FENCE)].map((match) => ({
    whole: match[0],
    lang: match[1]!.toLowerCase(),
    body: match[2]!,
  }));
  const tryParse = (body: string) => {
    try {
      return parseWhiteboardOps(JSON.parse(body));
    } catch {
      return null;
    }
  };
  const ordered = [
    ...blocks.filter((block) => block.lang === "whiteboard").reverse(),
    ...blocks.filter((block) => block.lang === "json" || block.lang === "").reverse(),
  ];
  for (const block of ordered) {
    const ops = tryParse(block.body);
    if (!ops) continue;
    const text = blocks
      .filter((other) => other.lang === "whiteboard" || other === block)
      .reduce((rest, other) => rest.replace(other.whole, ""), raw)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text, ops };
  }
  const text = blocks
    .filter((block) => block.lang === "whiteboard")
    .reduce((rest, block) => rest.replace(block.whole, ""), raw)
    .trim();
  return { text: text || raw.trim(), ops: null };
}

/** "Drew 4 items, changed 1, removed 2" for the chat bubble. */
export function describeOps(ops: WhiteboardOps): string {
  const parts: string[] = [];
  if (ops.clear) parts.push("cleared the sheet");
  if (ops.add.length) parts.push(`drew ${ops.add.length} item${ops.add.length === 1 ? "" : "s"}`);
  if (ops.update.length) parts.push(`changed ${ops.update.length}`);
  if (ops.remove.length) parts.push(`removed ${ops.remove.length}`);
  const text = parts.join(", ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

export function parseChatHistory(raw: string | null | undefined): WhiteboardChatMessage[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { messages?: unknown };
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages
      .filter(
        (message): message is WhiteboardChatMessage =>
          isRaw(message) &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.text === "string" &&
          typeof message.at === "number",
      )
      .slice(-200);
  } catch {
    return [];
  }
}

export function serializeChatHistory(messages: readonly WhiteboardChatMessage[]): string {
  return `${JSON.stringify({ version: 1, messages: messages.slice(-200) }, null, 2)}\n`;
}
