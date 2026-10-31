/**
 * Fork (L-202): which right-clicks get MonoCode's link menu. Web links do;
 * file links keep their own menu (it claims the click first), and editors
 * and terminals keep the text menu.
 */
import { isWebUrl } from "./browserRequest";

const TEXT_SURFACES = [
  "textarea",
  "input",
  '[contenteditable]:not([contenteditable="false"])',
  ".cm-editor",
  ".monocode-terminal",
  ".xterm",
].join(", ");

export type WebLink = { href: string; text: string };

export function webLinkAt(
  event: Pick<MouseEvent, "target" | "defaultPrevented">,
): WebLink | null {
  if (event.defaultPrevented) return null;
  const node = event.target as Node | null;
  if (!node || typeof node.nodeType !== "number") return null;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element || element.closest(TEXT_SURFACES)) return null;
  const anchor = element.closest("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return null;
  const href = anchor.href || anchor.getAttribute("href") || "";
  if (!isWebUrl(href)) return null;
  const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
  return { href, text: text || href };
}

export const LINK_MENU_ITEMS = [
  { id: "open-mono", label: "Open in MonoCode browser" },
  { id: "open-default", label: "Open in default browser" },
  { id: "copy-link", label: "Copy link" },
  { id: "copy-text", label: "Copy link text" },
] as const;

export type LinkMenuAction = (typeof LINK_MENU_ITEMS)[number]["id"];
