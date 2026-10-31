import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import {
  consoleNote,
  picksNote,
  shortUrl,
  type PickItem,
} from "../model/browserContext";
import {
  browserMenuItems,
  type BrowserContextTarget,
  type BrowserMenuAction,
} from "../model/browserMenu";
import { openInBackgroundTab } from "../model/backgroundTabs";
import { SEARCH_URL } from "../model/browserRequest";
import {
  attachNote,
  attachScreenshot,
  newTab,
  setPicking,
  showNotice,
  type BrowserTab,
} from "../model/browserTabs";

type ContextElement = {
  url: string;
  title?: string;
  viewport?: { width: number; height: number };
  item: PickItem;
  html: string;
};

function copy(text: string, what: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => showNotice(`${what} copied`))
    .catch(() => showNotice(`Couldn't copy the ${what.toLowerCase()}`, "error"));
}

function report(cause: unknown) {
  showNotice(String(cause), "error");
}

/**
 * Fork (L-215): MonoCode's right-click menu over a Browser page, opened where
 * the page was clicked. The page shows frozen behind it (L-214).
 */
export function BrowserContextMenu({
  target,
  tab,
  x,
  y,
  onClose,
}: {
  target: BrowserContextTarget;
  tab: BrowserTab;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const errors = tab.console.filter((row) => row.level === "error");
  const items = useMemo(
    () => browserMenuItems(target, { errors: errors.length }) as ExplorerMenuItem[],
    [target, errors.length],
  );
  // The clicked element's details load while the menu is open, for the
  // Developer items.
  const element = useRef<Promise<ContextElement | null> | null>(null);
  useEffect(() => {
    element.current = invoke<ContextElement | null>("browser_context_element", {
      tab: target.tab,
    }).catch(() => null);
  }, [target.tab]);

  const withElement = (use: (found: ContextElement) => void) => {
    void (element.current ?? Promise.resolve(null)).then((found) => {
      if (found?.item) use(found);
      else showNotice("Couldn't find the clicked element", "error");
    });
  };

  const pageUrl = target.pageUrl || tab.url;
  const history = (action: string) =>
    void invoke("browser_history", { tab: target.tab, action }).catch(report);

  const run = (id: BrowserMenuAction) => {
    switch (id) {
      case "link.newTab":
        newTab(target.linkUrl);
        break;
      case "link.background":
        openInBackgroundTab(target.linkUrl);
        break;
      case "link.external":
        void openUrl(target.linkUrl).catch(report);
        break;
      case "link.copy":
        copy(target.linkUrl, "Link");
        break;
      case "link.chat":
        attachNote(
          "Link",
          shortUrl(target.linkUrl, 60),
          [
            `Link on ${shortUrl(pageUrl)}:`,
            target.linkText.trim() ? `"${target.linkText.trim()}" → ${target.linkUrl}` : target.linkUrl,
          ].join("\n"),
        );
        break;
      case "image.newTab":
        newTab(target.sourceUrl);
        break;
      case "image.copy":
        copy(target.sourceUrl, "Image address");
        break;
      case "image.chat":
        withElement((found) => {
          const rect = found.item.rect;
          if (rect && rect.width >= 1 && rect.height >= 1) void attachScreenshot(target.tab, rect);
          else attachNote("Image", shortUrl(target.sourceUrl, 60), `Image on ${shortUrl(pageUrl)}: ${target.sourceUrl}`);
        });
        break;
      case "selection.copy":
        copy(target.selection, "Text");
        break;
      case "selection.search":
        newTab(SEARCH_URL + encodeURIComponent(target.selection.trim().slice(0, 300)));
        break;
      case "selection.chat":
        attachNote(
          "Selection",
          shortUrl(pageUrl, 60),
          `Selected text on ${shortUrl(pageUrl)}:\n${target.selection.trim()}`,
        );
        break;
      case "page.back":
        history("back");
        break;
      case "page.forward":
        history("forward");
        break;
      case "page.reload":
        history("reload");
        break;
      case "page.hardReload":
        history("hardReload");
        break;
      case "tools.pick":
        setPicking(target.tab, "element");
        break;
      case "tools.shot":
        void attachScreenshot(target.tab);
        break;
      case "tools.area":
        setPicking(target.tab, "area");
        break;
      case "tools.page":
        attachNote(
          "Page",
          shortUrl(pageUrl, 60),
          `Browser page: ${tab.title ? `${tab.title} · ` : ""}${pageUrl}`,
        );
        break;
      case "dev.selector":
        withElement((found) => copy(found.item.path, "Selector"));
        break;
      case "dev.html":
        withElement((found) => copy(found.html, "HTML"));
        break;
      case "dev.element":
        withElement((found) =>
          attachNote(
            "Element",
            `<${found.item.tag}>`,
            picksNote({
              kind: "picks",
              url: found.url,
              title: found.title,
              viewport: found.viewport,
              items: [found.item],
            }),
          ),
        );
        break;
      case "dev.errors":
        attachNote(
          "Console errors",
          `${errors.length}`,
          errors
            .slice(-20)
            .map((row) => consoleNote(row, pageUrl))
            .join("\n\n"),
        );
        break;
      case "dev.clearData":
        void invoke("browser_page_action", { tab: target.tab, action: "clearSiteData" })
          .then(() => showNotice("Site data cleared"))
          .catch(report);
        break;
      case "dev.inspect":
        void invoke("browser_devtools", { tab: target.tab }).catch(report);
        break;
      case "page.copyAddress":
        copy(pageUrl, "Address");
        break;
      case "page.external":
        void openUrl(pageUrl).catch(report);
        break;
      case "page.print":
        void invoke("browser_page_action", { tab: target.tab, action: "print" }).catch(report);
        break;
    }
  };

  return (
    <ExplorerMenu
      x={x}
      y={y}
      glide
      width={248}
      items={items}
      ariaLabel="Page actions"
      onPick={(id) => {
        if (id === "dev") return;
        onClose();
        run(id as BrowserMenuAction);
      }}
      onClose={onClose}
    />
  );
}
