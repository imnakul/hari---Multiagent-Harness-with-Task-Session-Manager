import { useSyncExternalStore } from "react";

/**
 * How eagerly chat replies preview their web links (L-119). `hover` fetches a
 * page only once its link is hovered; `always` also turns each link into a
 * chip with the site icon and page title, fetched as it nears the screen (L-212).
 */
export type LinkPreviewMode = "off" | "hover" | "always";

export const LINK_PREVIEW_MODE_KEY = "monocode.linkPreviewMode";
export const LINK_PREVIEW_MODE_DEFAULT: LinkPreviewMode = "hover";

/**
 * How a page card in a reply looks when Link previews is Always (fork, L-229):
 * `compact` small with the image at the side; `wide` uses more of the reply's
 * width to show more text; `large` a big image above the text; `large-side`
 * a big image beside it.
 */
export type LinkCardStyle = "compact" | "wide" | "large" | "large-side";

export const LINK_CARD_STYLE_KEY = "monocode.linkCardStyle";
export const LINK_CARD_STYLE_DEFAULT: LinkCardStyle = "compact";

/** One choice kept in localStorage and shared live by every window. */
function storedChoice<T extends string>(
  key: string,
  changeEvent: string,
  values: readonly T[],
  fallback: T,
) {
  const isValue = (value: unknown): value is T => values.includes(value as T);
  // Holds a choice only while storage failed to keep it, so the control still
  // changes for this window when localStorage is unavailable.
  let unsaved: T | null = null;

  function readStored(): T | null {
    try {
      const value = localStorage.getItem(key);
      return isValue(value) ? value : null;
    } catch {
      return null;
    }
  }

  function load(): T {
    return unsaved ?? readStored() ?? fallback;
  }

  function save(value: T): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* unavailable storage */
    }
    unsaved = readStored() === value ? null : value;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<T>(changeEvent, { detail: value }));
  }

  function subscribe(onStoreChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    // Other windows write the same localStorage; `storage` reports their saves.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      unsaved = null;
      onStoreChange();
    };
    window.addEventListener(changeEvent, onStoreChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changeEvent, onStoreChange);
      window.removeEventListener("storage", onStorage);
    };
  }

  function use(): T {
    return useSyncExternalStore(subscribe, load, load);
  }

  return { load, save, use };
}

const mode = storedChoice<LinkPreviewMode>(
  LINK_PREVIEW_MODE_KEY,
  "monocode:linkpreviewmodechange",
  ["off", "hover", "always"],
  LINK_PREVIEW_MODE_DEFAULT,
);

export const loadLinkPreviewMode = mode.load;
export const saveLinkPreviewMode = mode.save;
export const useLinkPreviewMode = mode.use;

const cardStyle = storedChoice<LinkCardStyle>(
  LINK_CARD_STYLE_KEY,
  "monocode:linkcardstylechange",
  ["compact", "wide", "large", "large-side"],
  LINK_CARD_STYLE_DEFAULT,
);

export const loadLinkCardStyle = cardStyle.load;
export const saveLinkCardStyle = cardStyle.save;
export const useLinkCardStyle = cardStyle.use;
