/**
 * Fork (L-215): MonoCode's right-click menu for a Browser page. The native
 * page reports what was clicked (link, image, selected text or the page);
 * this builds the items for it. Pure, so the item lists are testable.
 */

export type BrowserContextTarget = {
  tab: number;
  /** Where the click was, in the page's physical pixels. */
  x: number;
  y: number;
  kind: "page" | "image" | "selection" | "audio" | "video";
  pageUrl: string;
  linkUrl: string;
  linkText: string;
  sourceUrl: string;
  selection: string;
};

export type BrowserMenuAction =
  | "link.newTab"
  | "link.background"
  | "link.external"
  | "link.copy"
  | "link.chat"
  | "link.phone"
  | "image.newTab"
  | "image.copy"
  | "image.chat"
  | "image.phone"
  | "selection.copy"
  | "selection.search"
  | "selection.chat"
  | "selection.phone"
  | "page.back"
  | "page.forward"
  | "page.reload"
  | "page.hardReload"
  | "tools.pick"
  | "tools.shot"
  | "tools.area"
  | "tools.page"
  | "tools.pagePhone"
  | "dev.selector"
  | "dev.html"
  | "dev.element"
  | "dev.errors"
  | "dev.clearData"
  | "dev.inspect"
  | "page.copyAddress"
  | "page.external"
  | "page.print";

type Action = {
  kind: "item";
  id: BrowserMenuAction | "dev";
  label: string;
  disabled?: boolean;
  danger?: boolean;
  count?: number;
  shortcut?: string;
};

export type BrowserMenuItem = { kind: "sep" } | (Action & { submenu?: Action[] });

const item = (id: BrowserMenuAction, label: string, extra: Partial<Action> = {}): Action => ({
  kind: "item",
  id,
  label,
  ...extra,
});

const SEP = { kind: "sep" } as const;

/** Joins groups with one separator between non-empty ones. */
function groups(...lists: BrowserMenuItem[][]): BrowserMenuItem[] {
  return lists
    .filter((list) => list.length > 0)
    .flatMap((list, index) => (index === 0 ? list : [SEP, ...list]));
}

export function browserMenuItems(
  target: BrowserContextTarget,
  { errors = 0 }: { errors?: number } = {},
): BrowserMenuItem[] {
  const link = target.linkUrl
    ? [
        item("link.newTab", "Open link in new tab"),
        item("link.background", "Open link in background tab"),
        item("link.external", "Open link in default browser"),
        item("link.copy", "Copy link address"),
        item("link.chat", "Add link to chat"),
        item("link.phone", "Send link to phone"),
      ]
    : [];
  const image =
    target.kind === "image" && target.sourceUrl
      ? [
          item("image.newTab", "Open image in new tab"),
          item("image.copy", "Copy image address"),
          item("image.chat", "Add image to chat"),
          item("image.phone", "Send image address to phone"),
        ]
      : [];
  const text = target.selection.trim();
  const selection = text
    ? [
        item("selection.copy", "Copy", { shortcut: "Ctrl+C" }),
        item("selection.search", `Search the web for “${clipLabel(text, 24)}”`),
        item("selection.chat", "Add selection to chat"),
        item("selection.phone", "Send selection to phone"),
      ]
    : [];
  const developer: Action & { submenu: Action[] } = {
    kind: "item",
    id: "dev",
    label: "Developer",
    submenu: [
      item("dev.selector", "Copy element selector"),
      item("dev.html", "Copy element HTML"),
      item("dev.element", "Add element to chat"),
      item("dev.errors", "Add console errors to chat", {
        disabled: errors === 0,
        count: errors || undefined,
      }),
      item("dev.clearData", "Clear site data and reload", { danger: true }),
    ],
  };
  const inspect = item("dev.inspect", "Inspect", { shortcut: "F12" });
  // A link, image or selection keeps the menu about that thing, like Edge.
  if (link.length || image.length || selection.length) {
    return groups(link, image, selection, [developer, inspect]);
  }
  return groups(
    [
      item("page.back", "Back", { shortcut: "Alt+←" }),
      item("page.forward", "Forward", { shortcut: "Alt+→" }),
      item("page.reload", "Reload", { shortcut: "Ctrl+R" }),
      item("page.hardReload", "Reload without cache", { shortcut: "Ctrl+Shift+R" }),
    ],
    [
      item("tools.pick", "Pick and comment"),
      item("tools.shot", "Screenshot visible page"),
      item("tools.area", "Screenshot an area"),
      item("tools.page", "Add page address to chat"),
      item("tools.pagePhone", "Send page to phone"),
    ],
    [developer, inspect],
    [
      item("page.copyAddress", "Copy page address"),
      item("page.external", "Open page in default browser"),
      item("page.print", "Print…", { shortcut: "Ctrl+P" }),
    ],
  );
}

function clipLabel(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The click point in the app window's CSS pixels. */
export function menuPoint(
  target: Pick<BrowserContextTarget, "x" | "y">,
  pageBox: { left: number; top: number },
  ratio: number,
): { x: number; y: number } {
  const scale = ratio > 0 ? ratio : 1;
  return { x: pageBox.left + target.x / scale, y: pageBox.top + target.y / scale };
}
