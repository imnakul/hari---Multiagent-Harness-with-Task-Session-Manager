/**
 * Fork (L-401): which block of a rendered agent reply the pointer is over, and
 * what "Copy section" / "Copy list" / Alt+click copy put on the clipboard.
 * Reads Streamdown's DOM; the Markdown source is preferred where it can be
 * matched, so copies keep their formatting marks.
 */

import {
  comparableText,
  listMarkdown,
  markdownSections,
  type ListText,
} from "../model/markdownSections";
import type { BlockContent } from "./BlockActions";

export const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

/** Blocks that already have their own actions (code, tables, quotes, diagrams, images). */
const OWN_ACTIONS =
  "pre,table,[data-quote-actions],[data-overlay-actions],[data-streamdown='code-block'],[data-streamdown='mermaid-block'],[data-streamdown='table-wrapper']";

/** Copy marks and controls that never belong in a copy. */
const NOT_CONTENT = "[data-block-actions],button,[data-hover-actions]";

export type HoverTarget = { kind: "section" | "list"; element: HTMLElement };

function headingLevel(element: Element): number {
  return Number(element.tagName.slice(1)) || 6;
}

/** A heading in the reply's own flow: not inside a list, quote or table. */
function isFlowHeading(element: Element): boolean {
  return !element.parentElement?.closest("li,blockquote,table");
}

/** The section heading or outermost list under `start`, or null over anything else. */
export function hoverTargetAt(start: Element, root: HTMLElement): HoverTarget | null {
  if (!root.contains(start)) return null;
  const owned = start.closest(OWN_ACTIONS);
  if (owned && root.contains(owned)) return null;
  const heading = start.closest<HTMLElement>(HEADING_SELECTOR);
  if (heading && root.contains(heading) && isFlowHeading(heading)) {
    return { kind: "section", element: heading };
  }
  let list = start.closest<HTMLElement>("ul,ol");
  if (!list || !root.contains(list)) return null;
  for (;;) {
    const outer: HTMLElement | null | undefined = list.parentElement?.closest<HTMLElement>("ul,ol");
    if (!outer || !root.contains(outer)) break;
    list = outer;
  }
  if (list.parentElement?.closest("blockquote,table")) return null;
  return { kind: "list", element: list };
}

/** Text of an element without copy controls; paragraphs inside it stay on their own lines. */
export function plainText(element: Element): string {
  const clone = element.cloneNode(true);
  if (!(clone instanceof Element)) return element.textContent?.trim() ?? "";
  for (const control of Array.from(clone.querySelectorAll(NOT_CONTENT))) control.remove();
  const blocks = Array.from(clone.children).filter((child) =>
    /^(P|DIV|H[1-6]|UL|OL|PRE|BLOCKQUOTE)$/.test(child.tagName),
  );
  if (blocks.length > 1) {
    return blocks
      .map((child) => child.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return clone.textContent?.replace(/\s+\n/g, "\n").trim() ?? "";
}

function cleanHtml(elements: readonly Element[]): string {
  return elements
    .map((element) => {
      const clone = element.cloneNode(true);
      if (!(clone instanceof Element)) return "";
      for (const control of Array.from(clone.querySelectorAll(NOT_CONTENT))) control.remove();
      clone.removeAttribute("data-hover-actions-host");
      return clone.outerHTML;
    })
    .join("");
}

/** The reply-level block that holds `element` (Streamdown may wrap each block in a direction box). */
function topBlock(element: Element, root: HTMLElement): Element | null {
  let current: Element | null = element;
  while (current && current.parentElement !== root) current = current.parentElement;
  return current;
}

/** The heading a reply-level block starts with, if any. */
function blockHeading(block: Element): Element | null {
  if (block.matches(HEADING_SELECTOR)) return block;
  const first = block.firstElementChild;
  return first?.matches(HEADING_SELECTOR) ? first : null;
}

/** The heading's block and every block after it up to the next heading of the same or a higher level. */
export function sectionBlocks(heading: Element, root: HTMLElement): Element[] {
  const top = topBlock(heading, root);
  if (!top) return [heading];
  const level = headingLevel(heading);
  const blocks: Element[] = [top];
  for (let next = top.nextElementSibling; next; next = next.nextElementSibling) {
    const nextHeading = blockHeading(next);
    if (nextHeading && headingLevel(nextHeading) <= level) break;
    blocks.push(next);
  }
  return blocks;
}

/**
 * The section under a heading. The Markdown source is used when the heading at
 * the same position in the source has the same text; otherwise the rendered text.
 */
export function sectionContent(heading: HTMLElement, root: HTMLElement, source: string): BlockContent {
  const blocks = sectionBlocks(heading, root);
  const html = cleanHtml(blocks);
  const flow = Array.from(root.querySelectorAll(HEADING_SELECTOR)).filter(isFlowHeading);
  const match = markdownSections(source)[flow.indexOf(heading)];
  if (match && comparableText(match.title) === comparableText(plainText(heading))) {
    return { text: match.markdown, html };
  }
  return { text: blocks.map(plainText).filter(Boolean).join("\n\n"), html };
}

function readList(list: Element): ListText {
  const ordered = list.tagName === "OL";
  const start = Number(list.getAttribute("start"));
  const items = Array.from(list.children)
    .filter((child) => child.tagName === "LI")
    .map((item) => {
      const nested = Array.from(item.children).find((child) => child.tagName === "UL" || child.tagName === "OL");
      const own = item.cloneNode(true);
      if (own instanceof Element) {
        for (const child of Array.from(own.children)) {
          if (child.tagName === "UL" || child.tagName === "OL") child.remove();
        }
      }
      return {
        text: own instanceof Element ? plainText(own) : (item.textContent ?? ""),
        children: nested ? readList(nested) : null,
      };
    });
  return { ordered, start: Number.isFinite(start) && start > 0 ? start : 1, items };
}

export function listContent(list: HTMLElement): BlockContent {
  return { text: listMarkdown(readList(list)), html: cleanHtml([list]) };
}

/** What Alt+click copies: one paragraph or list item, or null when the click is elsewhere. */
export function altClickContent(start: Element, root: HTMLElement): { element: HTMLElement; content: BlockContent } | null {
  if (!root.contains(start) || start.closest(NOT_CONTENT)) return null;
  const owned = start.closest(OWN_ACTIONS);
  if (owned && root.contains(owned)) return null;
  const block = start.closest<HTMLElement>("p,li");
  if (!block || !root.contains(block)) return null;
  if (block.tagName === "LI") {
    const own = block.cloneNode(true);
    if (own instanceof Element) {
      for (const child of Array.from(own.children)) {
        if (child.tagName === "UL" || child.tagName === "OL") child.remove();
      }
    }
    const text = own instanceof Element ? plainText(own) : "";
    return text ? { element: block, content: { text, html: cleanHtml([own instanceof Element ? own : block]) } } : null;
  }
  const text = plainText(block);
  return text ? { element: block, content: { text, html: cleanHtml([block]) } } : null;
}
