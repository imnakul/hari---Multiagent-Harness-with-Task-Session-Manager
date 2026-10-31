import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { Copy, ExternalLink, Globe } from "../../../shared/ui/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { openInMonoBrowser } from "../model/browserRequest";
import {
  LINK_MENU_ITEMS,
  webLinkAt,
  type LinkMenuAction,
  type WebLink,
} from "../model/linkMenu";

const ICONS: Record<LinkMenuAction, typeof Globe> = {
  "open-mono": Globe,
  "open-default": ExternalLink,
  "copy-link": Copy,
  "copy-text": Copy,
};

const MENU_ITEMS: ExplorerMenuItem[] = LINK_MENU_ITEMS.flatMap((item, index) => {
  const Icon = ICONS[item.id];
  const entry: ExplorerMenuItem = {
    kind: "item",
    id: item.id,
    label: item.label,
    icon: <Icon aria-hidden className="size-3.5" />,
  };
  return index === 2 ? [{ kind: "sep" } as const, entry] : [entry];
});

/**
 * Fork (L-202): MonoCode's own menu on right-clicked web links anywhere in
 * the main window. Listens on the window in the bubble phase, after React's
 * handlers, so a file link's menu (which prevents the default) wins.
 */
export function LinkContextMenu() {
  const [menu, setMenu] = useState<(WebLink & { x: number; y: number }) | null>(
    null,
  );

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (import.meta.env.DEV && event.shiftKey) return;
      const link = webLinkAt(event);
      if (!link) return;
      event.preventDefault();
      setMenu({ ...link, x: event.clientX, y: event.clientY });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!menu) return null;

  const pick = (id: string) => {
    const { href, text } = menu;
    setMenu(null);
    switch (id as LinkMenuAction) {
      case "open-mono":
        openInMonoBrowser(href);
        break;
      case "open-default":
        void openUrl(href).catch(() => {});
        break;
      case "copy-link":
        void copyText(href).catch(() => {});
        break;
      case "copy-text":
        void copyText(text).catch(() => {});
        break;
    }
  };

  return (
    <ExplorerMenu
      x={menu.x}
      y={menu.y}
      items={MENU_ITEMS}
      ariaLabel="Link actions"
      width={220}
      onPick={pick}
      onClose={() => setMenu(null)}
    />
  );
}
