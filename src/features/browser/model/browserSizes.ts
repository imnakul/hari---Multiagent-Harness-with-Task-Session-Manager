/**
 * Fork (L-216): Browser page sizes. A tab shows the page at "Fit" (the space
 * it has) or at a fixed size: a built-in width or a size the user saved
 * (name, width, optional height). A size larger than the space shrinks the
 * page to fit on both sides, keeping its layout.
 */

/** A fixed page size in CSS pixels; no height means the full height. */
export type PageSize = { width: number; height?: number };

export type SizePreset = PageSize & { id: string; name: string; custom?: boolean };

export const MIN_SIZE = 200;
export const MAX_SIZE = 4000;
export const MAX_CUSTOM_SIZES = 12;
const CUSTOM_KEY = "monocode.browser.sizes";

export const BUILT_IN_SIZES: SizePreset[] = [
  { id: "phone", name: "Phone", width: 375 },
  { id: "tablet", name: "Tablet", width: 768 },
  { id: "laptop", name: "Laptop", width: 1280 },
];

const validSide = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_SIZE && value <= MAX_SIZE;

/** A saved size, or null when it is missing or out of range. */
export function parseSize(raw: unknown): PageSize | null {
  // Sizes saved before L-216 were a bare width.
  if (validSide(raw)) return { width: raw };
  if (!raw || typeof raw !== "object") return null;
  const { width, height } = raw as { width?: unknown; height?: unknown };
  if (!validSide(width)) return null;
  return validSide(height) ? { width, height } : { width };
}

export function sameSize(a: PageSize | null, b: PageSize | null): boolean {
  if (!a || !b) return a === b;
  return a.width === b.width && (a.height ?? null) === (b.height ?? null);
}

export function sizeLabel(size: PageSize): string {
  return size.height ? `${size.width} × ${size.height}` : `${size.width}`;
}

/** How much the page shrinks so `size` fits in `space` (1 when it fits). */
export function fitScale(size: PageSize | null, space: { width: number; height: number }): number {
  if (!size || space.width <= 0) return 1;
  const across = space.width / size.width;
  const down = size.height && space.height > 0 ? space.height / size.height : 1;
  return Math.min(1, across, down);
}

export function loadCustomSizes(): SizePreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .flatMap((item): SizePreset[] => {
        const size = parseSize(item);
        const name = typeof item?.name === "string" ? item.name.trim().slice(0, 40) : "";
        const id = typeof item?.id === "string" ? item.id : "";
        return size && name && id ? [{ ...size, id, name, custom: true }] : [];
      })
      .slice(0, MAX_CUSTOM_SIZES);
  } catch {
    return [];
  }
}

export function saveCustomSizes(list: SizePreset[]) {
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify(list.map(({ id, name, width, height }) => ({ id, name, width, height }))),
    );
  } catch {
    // private mode / quota
  }
}

/** Checks a new size from the form; returns the preset or what is wrong. */
export function newCustomSize(
  list: SizePreset[],
  input: { name: string; width: string; height: string },
  id = `size-${Date.now().toString(36)}`,
): { preset: SizePreset } | { error: string } {
  const width = Number(input.width.trim());
  const heightText = input.height.trim();
  const height = heightText ? Number(heightText) : undefined;
  if (!validSide(width) || (height !== undefined && !validSide(height))) {
    return { error: `Use whole numbers from ${MIN_SIZE} to ${MAX_SIZE}` };
  }
  if (list.length >= MAX_CUSTOM_SIZES) return { error: `Up to ${MAX_CUSTOM_SIZES} sizes` };
  const size: PageSize = height ? { width, height } : { width };
  if ([...BUILT_IN_SIZES, ...list].some((preset) => sameSize(preset, size))) {
    return { error: "That size is already in the list" };
  }
  const name = input.name.trim().slice(0, 40) || sizeLabel(size);
  return { preset: { ...size, id, name, custom: true } };
}
