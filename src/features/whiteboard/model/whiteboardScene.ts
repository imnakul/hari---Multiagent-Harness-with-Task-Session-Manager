/**
 * Applies an agent's whiteboard changes to the Excalidraw scene (fork,
 * L-194). Excalidraw's own helpers are passed in, so this stays testable
 * without loading the editor.
 */
import type {
  SceneElementLike,
  WhiteboardAdd,
  WhiteboardAddLine,
  WhiteboardOps,
  WhiteboardUpdate,
} from "./whiteboardAgent";

/** The skeleton shape `convertToExcalidrawElements` takes. */
export type WhiteboardSkeleton = Record<string, unknown> & {
  type: string;
  id: string;
  x: number;
  y: number;
};

export type SceneDeps<E extends SceneElementLike> = {
  /** `convertToExcalidrawElements(skeletons, { regenerateIds: false })`. */
  convert: (skeletons: WhiteboardSkeleton[]) => E[];
  /** `newElementWith(element, changes)`. */
  withChanges: (element: E, changes: Partial<E>) => E;
};

export type ApplyResult<E> = {
  elements: E[];
  /** Agent id → id used on the sheet (differs when it clashed). */
  ids: Map<string, string>;
  added: number;
  changed: number;
  removed: number;
  skipped: number;
};

const ARROW_GAP = 8;

type Box = { x: number; y: number; width: number; height: number };
const isLine = (op: WhiteboardAdd): op is WhiteboardAddLine =>
  op.type === "arrow" || op.type === "line";
const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Where the line from the box centre towards `toward` leaves the box, plus a gap. */
export function edgePoint(box: Box, toward: { x: number; y: number }, gap = ARROW_GAP) {
  const c = centre(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return c;
  const sx = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return {
    x: c.x + dx * scale + (dx / length) * gap,
    y: c.y + dy * scale + (dy / length) * gap,
  };
}

function uniqueId(wanted: string, taken: Set<string>): string {
  let candidate = wanted;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${wanted}-${n}`;
  taken.add(candidate);
  return candidate;
}

function styleOf(op: { strokeColor?: string; backgroundColor?: string; strokeStyle?: string; fillStyle?: string }) {
  const out: Record<string, unknown> = {};
  if (op.strokeColor) out.strokeColor = op.strokeColor;
  if (op.backgroundColor) out.backgroundColor = op.backgroundColor;
  if (op.strokeStyle) out.strokeStyle = op.strokeStyle;
  if (op.fillStyle) out.fillStyle = op.fillStyle;
  return out;
}

export function applyWhiteboardOps<E extends SceneElementLike>(
  current: readonly E[],
  ops: WhiteboardOps,
  deps: SceneDeps<E>,
  options: { fontFamily?: number } = {},
): ApplyResult<E> {
  const elements = [...current];
  let changed = 0;
  let removed = 0;
  let skipped = 0;
  const indexOf = new Map(elements.map((element, index) => [element.id, index]));
  const live = (id: string) => {
    const index = indexOf.get(id);
    const element = index === undefined ? undefined : elements[index];
    return element && !element.isDeleted ? element : undefined;
  };
  const replace = (element: E, changes: Partial<E>) => {
    const index = indexOf.get(element.id)!;
    const next = deps.withChanges(element, changes);
    elements[index] = next;
    return next;
  };
  const boundText = (container: E) =>
    elements.find(
      (element) =>
        element.type === "text" && element.containerId === container.id && !element.isDeleted,
    );
  const remove = (element: E) => {
    replace(element, { isDeleted: true } as Partial<E>);
    const text = boundText(element);
    if (text) replace(text, { isDeleted: true } as Partial<E>);
  };

  if (ops.clear) {
    for (const element of [...elements]) {
      if (!element.isDeleted) {
        replace(element, { isDeleted: true } as Partial<E>);
        if (!element.containerId) removed += 1;
      }
    }
  }

  for (const id of ops.remove) {
    const element = live(id);
    if (!element) {
      skipped += 1;
      continue;
    }
    remove(element);
    removed += 1;
  }

  const newLabels: { container: E; label: string }[] = [];
  for (const update of ops.update) {
    const element = live(update.id);
    if (!element) {
      skipped += 1;
      continue;
    }
    const next = replace(element, updateChanges(element, update) as Partial<E>);
    changed += 1;
    const text = boundText(next);
    if (text) {
      const textChanges: Record<string, unknown> = {};
      if (update.label !== undefined) {
        textChanges.text = update.label;
        textChanges.originalText = update.label;
      }
      textChanges.x = next.x + (next.width - text.width) / 2;
      textChanges.y = next.y + (next.height - text.height) / 2;
      if (update.strokeColor) textChanges.strokeColor = update.strokeColor;
      replace(text, textChanges as Partial<E>);
    } else if (update.label && next.type !== "text") {
      newLabels.push({ container: next, label: update.label });
    } else if (update.label && next.type === "text") {
      replace(next, { text: update.label, originalText: update.label } as unknown as Partial<E>);
    }
  }

  const taken = new Set(elements.map((element) => element.id));
  const ids = new Map<string, string>();
  const plan: { op: WhiteboardAdd; id: string }[] = [];
  for (const op of ops.add) {
    const wanted = op.id ?? op.type;
    const id = uniqueId(wanted, taken);
    if (op.id && !ids.has(op.id)) ids.set(op.id, id);
    plan.push({ op, id });
  }

  const fontFamily = options.fontFamily;
  const newBoxes = new Map<string, Box>();
  for (const { op, id } of plan) {
    if (isLine(op)) continue;
    newBoxes.set(id, {
      x: op.x,
      y: op.y,
      width: op.type === "text" ? 10 : op.width,
      height: op.type === "text" ? 10 : op.height,
    });
  }

  const skeletons: WhiteboardSkeleton[] = [];
  for (const { op, id } of plan) {
    if (op.type === "text") {
      skeletons.push({
        type: "text",
        id,
        x: op.x,
        y: op.y,
        text: op.text,
        ...(op.fontSize ? { fontSize: op.fontSize } : {}),
        ...(fontFamily ? { fontFamily } : {}),
        ...styleOf(op),
      });
    } else if (isLine(op)) {
      const skeleton = lineSkeleton(op, id, ids, newBoxes, live, fontFamily);
      if (skeleton) skeletons.push(skeleton);
      else skipped += 1;
    } else {
      skeletons.push({
        type: op.type,
        id,
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        ...styleOf(op),
        ...(op.label
          ? {
              label: {
                text: op.label,
                ...(op.fontSize ? { fontSize: op.fontSize } : {}),
                ...(fontFamily ? { fontFamily } : {}),
              },
            }
          : {}),
      });
    }
  }

  // Labels for existing shapes that had none: a text element bound to them.
  for (const { container, label } of newLabels) {
    skeletons.push({
      type: "text",
      id: uniqueId(`${container.id}-label`, taken),
      x: container.x,
      y: container.y,
      text: label,
      ...(fontFamily ? { fontFamily } : {}),
      textAlign: "center",
      verticalAlign: "middle",
      __containerId: container.id,
    });
  }

  const added = skeletons.filter((skeleton) => !skeleton.__containerId).length;
  const containerFor = new Map(
    skeletons
      .filter((skeleton) => typeof skeleton.__containerId === "string")
      .map((skeleton) => [skeleton.id, skeleton.__containerId as string]),
  );
  const converted = skeletons.length
    ? deps.convert(
        skeletons.map((skeleton) => {
          if (!skeleton.__containerId) return skeleton;
          const { __containerId: _drop, ...rest } = skeleton;
          return rest as WhiteboardSkeleton;
        }),
      )
    : [];
  for (const element of converted) {
    const containerId = containerFor.get(element.id);
    if (!containerId) {
      indexOf.set(element.id, elements.length);
      elements.push(element);
      continue;
    }
    const container = live(containerId);
    if (!container) continue;
    const text = deps.withChanges(element, {
      containerId,
      x: container.x + (container.width - element.width) / 2,
      y: container.y + (container.height - element.height) / 2,
    } as Partial<E>);
    indexOf.set(text.id, elements.length);
    elements.push(text);
    replace(container, {
      boundElements: [...(container.boundElements ?? []), { id: text.id, type: "text" }],
    } as unknown as Partial<E>);
  }

  return { elements, ids, added, changed, removed, skipped };
}

function updateChanges(element: SceneElementLike, update: WhiteboardUpdate) {
  const changes: Record<string, unknown> = { ...styleOf(update) };
  if (update.x !== undefined) changes.x = update.x;
  if (update.y !== undefined) changes.y = update.y;
  if (element.type !== "arrow" && element.type !== "line" && element.type !== "text") {
    if (update.width !== undefined) changes.width = update.width;
    if (update.height !== undefined) changes.height = update.height;
  }
  return changes;
}

function lineSkeleton<E extends SceneElementLike>(
  op: WhiteboardAddLine,
  id: string,
  ids: Map<string, string>,
  newBoxes: Map<string, Box>,
  live: (id: string) => E | undefined,
  fontFamily: number | undefined,
): WhiteboardSkeleton | null {
  const resolve = (ref: string | undefined) => {
    if (!ref) return undefined;
    const newId = ids.get(ref);
    if (newId && newBoxes.has(newId)) return { id: newId, box: newBoxes.get(newId)!, isNew: true };
    const existing = live(ref);
    if (existing && existing.type !== "arrow" && existing.type !== "line") {
      return { id: existing.id, box: existing as Box, isNew: false };
    }
    return undefined;
  };
  const from = resolve(op.from);
  const to = resolve(op.to);
  let start: { x: number; y: number };
  let end: { x: number; y: number };
  if (from && to) {
    start = edgePoint(from.box, centre(to.box));
    end = edgePoint(to.box, centre(from.box));
  } else if (
    op.x !== undefined &&
    op.y !== undefined &&
    op.endX !== undefined &&
    op.endY !== undefined
  ) {
    start = from ? edgePoint(from.box, { x: op.endX, y: op.endY }) : { x: op.x, y: op.y };
    end = to ? edgePoint(to.box, start) : { x: op.endX, y: op.endY };
  } else {
    return null;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    type: op.type,
    id,
    x: start.x,
    y: start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
    ...styleOf(op),
    // Excalidraw binds only within one batch; an arrow to a shape already on
    // the sheet is placed but left unbound.
    ...(op.type === "arrow" && from?.isNew && to?.isNew
      ? { start: { id: from.id }, end: { id: to.id } }
      : {}),
    ...(op.label
      ? { label: { text: op.label, ...(fontFamily ? { fontFamily } : {}) } }
      : {}),
  };
}
