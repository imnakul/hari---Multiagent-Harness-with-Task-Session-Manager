import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { AppWindow, Copy, ExternalLink, Globe, SmartPhone } from "../../../shared/ui/icons";
import { sendTextToShare } from "../../mobile/model/sendToShare";
import { ShareSentToast } from "../../mobile/ui/ShareSentToast";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { openInBackgroundTab } from "../model/backgroundTabs";
import { openInMonoBrowser } from "../model/browserRequest";
import {
  LINK_MENU_ITEMS,
  webLinkAt,
  type LinkMenuAction,
  type WebLink,
} from "../model/linkMenu";
import { BackgroundTabToast } from "./BackgroundTabToast";

const ICONS: Record<LinkMenuAction, typeof Globe> = {
  "open-mono": Globe,
  "open-background": AppWindow,
  "open-default": ExternalLink,
  "copy-link": Copy,
  "copy-text": Copy,
  "send-phone": SmartPhone,
};

const MENU_ITEMS: ExplorerMenuItem[] = LINK_MENU_ITEMS.flatMap((item, index) => {
  const Icon = ICONS[item.id];
  const entry: ExplorerMenuItem = {
    kind: "item",
    id: item.id,
    label: item.label,
    icon: <Icon aria-hidden className="size-3.5" />,
  };
  return index === 3 || index === 5 ? [{ kind: "sep" } as const, entry] : [entry];
});

/**
 * Fork (L-202): MonoCode's own menu on right-clicked web links anywhere in
 * the main window. Listens on the window in the bubble phase, after React's
 * handlers, so a file link's menu (which prevents the default) wins.
 * Ctrl+click and middle-click open a web link in a background tab (L-224).
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
    // Capture phase, so the link's own click handler doesn't also open it.
    const onClick = (event: MouseEvent) => {
      const middle = event.type === "auxclick" && event.button === 1;
      const ctrl = event.type === "click" && event.button === 0 && (event.ctrlKey || event.metaKey);
      if (!middle && !ctrl) return;
      const link = webLinkAt(event);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      openInBackgroundTab(link.href);
    };
    // A middle press on a link would otherwise start autoscroll.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1 && webLinkAt(event)) event.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("click", onClick, true);
    window.addEventListener("auxclick", onClick, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("auxclick", onClick, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);

  if (!menu)
    return (
      <>
        <BackgroundTabToast />
        <ShareSentToast />
      </>
    );

  const pick = (id: string) => {
    const { href, text } = menu;
    setMenu(null);
    switch (id as LinkMenuAction) {
      case "open-mono":
        openInMonoBrowser(href);
        break;
      case "open-background":
        openInBackgroundTab(href);
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
      case "send-phone":
        void sendTextToShare(href, "Link");
        break;
    }
  };

  return (
    <>
    <BackgroundTabToast />
    <ShareSentToast />
    <ExplorerMenu
      x={menu.x}
      y={menu.y}
      items={MENU_ITEMS}
      ariaLabel="Link actions"
      width={220}
      onPick={pick}
      onClose={() => setMenu(null)}
    />
    </>
  );
}
