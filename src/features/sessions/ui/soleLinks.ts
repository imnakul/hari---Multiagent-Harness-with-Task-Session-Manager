import type { Element, ElementContent, Root } from "hast";

/*
 * Fork (L-217, L-224): with Link previews set to Always, every web link in a
 * paragraph or list item shows its page card on that line.
 * - A link alone on its line, or at the end of a short label ("GitHub: link"),
 *   gets `data-link-card` and shows as the card in its own place.
 * - Links inside longer text stay chips (`data-card-below`), and their cards
 *   are added under the line as copies marked `data-link-card="below"`.
 */

const LINE_TAGS = new Set(["p", "li"]);
/** A list item's own line ends where a nested list or paragraph starts. */
const BLOCK_TAGS = new Set(["p", "ul", "ol", "div", "pre", "blockquote", "table"]);
/** Words before a link that still read as its label. */
const LABEL_CHARS = 48;
/** Cards added under one line; further links stay chips only. */
const MAX_CARDS_BELOW = 4;

function blank(node: ElementContent): boolean {
  if (node.type === "text") return !node.value.trim();
  if (node.type === "comment") return true;
  // The word fade wraps text in spans; a span of spaces or a <br> is still blank.
  if (node.type === "element" && (node.tagName === "span" || node.tagName === "br")) {
    return node.children.every(blank);
  }
  return false;
}

function webHref(node: ElementContent): string | null {
  if (node.type !== "element" || node.tagName !== "a") return null;
  const href = node.properties?.href;
  return typeof href === "string" && /^https?:\/\//i.test(href) ? href : null;
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

function webLinksIn(nodes: ElementContent[], found: Element[] = []): Element[] {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (webHref(node)) found.push(node);
    else if (node.tagName !== "code") webLinksIn(node.children, found);
  }
  return found;
}

/** The line's last link, when only a short label comes before it. */
function cardInPlace(line: ElementContent[]): Element | null {
  const rest = line.filter((child) => !blank(child));
  const last = rest[rest.length - 1];
  if (!last || !webHref(last)) return null;
  const before = rest.slice(0, -1);
  if (webLinksIn(before).length) return null;
  return before.map(textOf).join("").trim().length <= LABEL_CHARS ? (last as Element) : null;
}

function cardsBelow(links: Element[]): Element {
  const seen = new Set<string>();
  const copies: Element[] = [];
  for (const link of links) {
    const href = webHref(link)!;
    if (seen.has(href) || copies.length >= MAX_CARDS_BELOW) continue;
    seen.add(href);
    link.properties = { ...link.properties, dataCardBelow: "" };
    copies.push({
      type: "element",
      tagName: "a",
      // The chip in the line is the link for keyboards and screen readers.
      properties: { href, dataLinkCard: "below", tabIndex: -1, ariaHidden: "true" },
      children: link.children,
    });
  }
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["link-cards-below", "flex", "flex-wrap", "gap-x-2"] },
    children: copies,
  };
}

function markLine(element: Element) {
  const end = element.children.findIndex(
    (child) => child.type === "element" && BLOCK_TAGS.has(child.tagName),
  );
  const line = end < 0 ? element.children : element.children.slice(0, end);
  const own = cardInPlace(line);
  if (own) {
    own.properties = { ...own.properties, dataLinkCard: "" };
    return;
  }
  const links = webLinksIn(line);
  if (!links.length) return;
  const at = end < 0 ? element.children.length : end;
  element.children.splice(at, 0, cardsBelow(links));
}

function visit(node: Root | Element) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (LINE_TAGS.has(child.tagName)) markLine(child);
    visit(child);
  }
}

export function rehypeSoleLinks() {
  return (tree: Root) => visit(tree);
}
