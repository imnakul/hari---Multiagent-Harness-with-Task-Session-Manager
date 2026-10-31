import type { Element, ElementContent, Root } from "hast";

/*
 * Fork (L-217): a web link that is the only thing in its paragraph or list
 * item gets `data-link-card`, so with Link previews set to Always it shows as
 * a page card in place, rather than as a chip in a line of prose.
 */

const LINE_TAGS = new Set(["p", "li"]);

function blank(node: ElementContent): boolean {
  if (node.type === "text") return !node.value.trim();
  if (node.type === "comment") return true;
  // The word fade wraps text in spans; a span of spaces or a <br> is still blank.
  if (node.type === "element" && (node.tagName === "span" || node.tagName === "br")) {
    return node.children.every(blank);
  }
  return false;
}

function soleLink(element: Element): Element | null {
  const rest = element.children.filter((child) => !blank(child));
  if (rest.length !== 1) return null;
  const only = rest[0]!;
  if (only.type !== "element" || only.tagName !== "a") return null;
  const href = only.properties?.href;
  return typeof href === "string" && /^https?:\/\//i.test(href) ? only : null;
}

function visit(node: Root | Element) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (LINE_TAGS.has(child.tagName)) {
      const link = soleLink(child);
      if (link) {
        link.properties = { ...link.properties, dataLinkCard: "" };
        continue;
      }
    }
    visit(child);
  }
}

export function rehypeSoleLinks() {
  return (tree: Root) => visit(tree);
}
