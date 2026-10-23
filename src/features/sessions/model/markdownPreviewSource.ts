/**
 * Maps a double-click in rendered Markdown back to a caret position in its
 * source, so "double-click to edit" lands on the line that was clicked.
 *
 * The preview renderer splits Markdown into blocks and keeps no source
 * positions, so the mapping matches text instead: the clicked block's first
 * rendered line is looked up among the source lines with Markdown syntax
 * removed, the line inside the block (hard breaks, code lines) is added, and
 * the clicked word places the column. Pure, so it is unit tested; the DOM side
 * lives in `previewClickTarget`.
 */

/** What the preview knows about a double-click, read from the DOM. */
export type PreviewClickTarget = {
  /** First rendered line of the clicked block (paragraph, list item, cell…). */
  blockText: string;
  /** How many earlier blocks of the same kind show the same first line. */
  occurrence: number;
  /** Rendered line inside the block that was clicked: 0 for its first line. */
  lineInBlock: number;
  /** The word the double-click selected, or "" when none. */
  word: string;
};

/** Leading Markdown syntax: block quote, heading, list marker, task box. */
const LEADING_SYNTAX =
  /^\s*(?:>\s?)*\s*(?:#{1,6}\s+)?(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\[[ xX]\]\s+)?/;

/** Lower-cases, drops emphasis/code/table characters and collapses spaces. */
function flatten(text: string): string {
  return text
    .replace(/[*_~`\\|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A source line as it reads once rendered: syntax and link targets removed. */
export function plainMarkdownLine(line: string): string {
  return flatten(
    line
      .replace(LEADING_SYNTAX, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/\s#+\s*$/, ""),
  );
}

type Matcher = (line: { plain: string; raw: string }, needle: string) => boolean;

// Strictest first, so "Fix" picks the line that is exactly "Fix" before one
// that merely contains it. `raw` keeps code lines like "- item" matchable.
const MATCHERS: readonly Matcher[] = [
  (line, needle) => line.plain === needle || line.raw === needle,
  (line, needle) => line.plain.startsWith(needle) || line.raw.startsWith(needle),
  (line, needle) => line.plain.includes(needle) || line.raw.includes(needle),
];

function findBaseLine(
  lines: readonly { plain: string; raw: string }[],
  needle: string,
  occurrence: number,
): number | null {
  for (const matches of MATCHERS) {
    const candidates: number[] = [];
    lines.forEach((line, index) => {
      if (matches(line, needle)) candidates.push(index);
    });
    if (candidates.length > 0)
      return candidates[Math.min(occurrence, candidates.length - 1)] ?? null;
  }
  return null;
}

/**
 * Character offset in `source` for a preview double-click, or null when the
 * clicked text cannot be found (the caller then keeps its default caret).
 */
export function sourceOffsetForPreviewClick(
  source: string,
  target: PreviewClickTarget,
): number | null {
  const lines = source.split("\n");
  const indexed = lines.map((line) => ({
    plain: plainMarkdownLine(line),
    raw: flatten(line),
  }));
  const needle = flatten(target.blockText);
  const word = target.word.trim().toLowerCase();

  let lineIndex: number | null = null;
  if (needle) {
    const base = findBaseLine(indexed, needle, Math.max(0, target.occurrence));
    if (base !== null)
      lineIndex = Math.min(base + Math.max(0, target.lineInBlock), lines.length - 1);
  }
  if (lineIndex === null && word) {
    const found = lines.findIndex((line) => line.toLowerCase().includes(word));
    if (found >= 0) lineIndex = found;
  }
  if (lineIndex === null) return null;

  const line = lines[lineIndex] ?? "";
  const wordColumn = word ? line.toLowerCase().indexOf(word) : -1;
  const syntaxEnd = LEADING_SYNTAX.exec(line)?.[0].length ?? 0;
  const column = wordColumn >= 0 ? wordColumn : syntaxEnd;

  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1)
    offset += (lines[index]?.length ?? 0) + 1;
  return offset + column;
}

/** Zero-based source line that contains `offset`. */
export function lineAtOffset(source: string, offset: number): number {
  let line = 0;
  const end = Math.min(Math.max(0, offset), source.length);
  for (let index = 0; index < end; index += 1)
    if (source.charCodeAt(index) === 10) line += 1;
  return line;
}
