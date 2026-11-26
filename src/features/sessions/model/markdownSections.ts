/**
 * Fork (L-401): the Markdown source behind "Copy section" on a heading in an
 * agent reply. Pure, so the fence and level rules are testable.
 */

import { isAtxHeadingLine } from "../../files/model/markdownSource";

export interface MarkdownSection {
  /** Heading level, 1 to 6. */
  level: number;
  /** Heading text without the `#` marks or a closing `#` run. */
  title: string;
  /** The heading line and everything under it, up to the next heading of the same or a higher level. */
  markdown: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Every ATX heading outside code fences, in order, with its section. A heading
 * inside a quote or list is not a line start here, so it is not counted; the
 * caller counts rendered headings the same way.
 */
export function markdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: { line: number; level: number; title: string }[] = [];
  let fence: string | null = null;
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    if (!isAtxHeadingLine(line)) return;
    const trimmed = line.trim();
    const level = /^#+/.exec(trimmed)?.[0].length ?? 1;
    const title = trimmed
      .slice(level)
      .replace(/\s+#+\s*$/, "")
      .trim();
    headings.push({ line: index, level, title });
  });
  return headings.map((heading, position) => {
    const next = headings.slice(position + 1).find((later) => later.level <= heading.level);
    const end = next ? next.line : lines.length;
    return {
      level: heading.level,
      title: heading.title,
      markdown: lines.slice(heading.line, end).join("\n").trim(),
    };
  });
}

/** Letters and digits only, lower case: compares a source heading with its rendered text. */
export function comparableText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A rendered list item, as the DOM reader sees it. */
export interface ListItemText {
  text: string;
  children: ListText | null;
}

export interface ListText {
  ordered: boolean;
  start: number;
  items: ListItemText[];
}

/** A list as Markdown: `-` or numbered markers, nested lists indented under their item. */
export function listMarkdown(list: ListText, indent = ""): string {
  return list.items
    .map((item, index) => {
      const marker = list.ordered ? `${list.start + index}.` : "-";
      const pad = `${indent}${" ".repeat(marker.length + 1)}`;
      const body = item.text
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .join(`\n${pad}`);
      const nested = item.children ? `\n${listMarkdown(item.children, pad)}` : "";
      return `${indent}${marker} ${body}${nested}`;
    })
    .join("\n");
}
