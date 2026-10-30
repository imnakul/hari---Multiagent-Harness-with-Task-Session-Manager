/**
 * Every free Hugeicons glyph, for the whiteboard icon library (fork, L-194).
 * The catalog is about 5 MB, so it loads only when the picker first opens;
 * this file is the one allowed exception to the deep-import rule in
 * `shared/ui/icons.test.ts`.
 */
type IconNode = readonly [string, Record<string, unknown>];
export type CatalogIcon = { name: string; label: string; nodes: readonly IconNode[] };

let catalog: Promise<CatalogIcon[]> | undefined;

function isIcon(value: unknown): value is readonly IconNode[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((node) => Array.isArray(node) && typeof node[0] === "string")
  );
}

/** "ArrowUpRight01Icon" → "Arrow up right 01". */
export function iconLabel(name: string): string {
  const words = name
    .replace(/Icon$/, "")
    .replace(/([a-z])([A-Z0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The module lists each glyph as `X`, `XIcon` and `XFreeIcons`; keep one. */
export function catalogFromModule(module: Record<string, unknown>): CatalogIcon[] {
  const seen = new Set<unknown>();
  const out: CatalogIcon[] = [];
  for (const [name, value] of Object.entries(module)) {
    if (!name.endsWith("Icon") || !isIcon(value) || seen.has(value)) continue;
    seen.add(value);
    out.push({ name, label: iconLabel(name), nodes: value });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadIconCatalog(): Promise<CatalogIcon[]> {
  catalog ??= import("@hugeicons/core-free-icons")
    .then((module) => catalogFromModule(module as unknown as Record<string, unknown>))
    .catch((error) => {
      catalog = undefined;
      throw error;
    });
  return catalog;
}

export function searchIcons(icons: readonly CatalogIcon[], query: string, limit = 240): CatalogIcon[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return icons.slice(0, limit);
  const out: CatalogIcon[] = [];
  for (const icon of icons) {
    const label = icon.label.toLowerCase();
    if (terms.every((term) => label.includes(term))) {
      out.push(icon);
      if (out.length >= limit) break;
    }
  }
  return out;
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A standalone SVG for the glyph, drawn in one colour. */
export function iconSvg(icon: CatalogIcon, color: string, size = 96, strokeWidth = 1.5): string {
  const body = icon.nodes
    .map(([tag, attrs]) => {
      const parts: string[] = [];
      for (const [key, raw] of Object.entries(attrs)) {
        if (key === "key" || raw == null) continue;
        let value = String(raw);
        if (value === "currentColor") value = color;
        if (key === "strokeWidth") value = String(strokeWidth);
        const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        parts.push(`${name}="${escapeAttr(value)}"`);
      }
      return `<${tag} ${parts.join(" ")}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${body}</svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
