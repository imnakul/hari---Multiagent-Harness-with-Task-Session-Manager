/**
 * The Browser tab (fork, L-203): requests to open a page, and turning what
 * the user typed in the address bar into an address.
 */

/** A page the Browser tab was asked to open; `id` makes repeats distinct. */
export type BrowserRequest = { url: string; id: number };

export function nextBrowserRequest(
  current: BrowserRequest | null,
  url: string,
): BrowserRequest {
  return { url, id: (current?.id ?? 0) + 1 };
}

const OPEN_EVENT = "monocode:open-in-browser";

/** Opens `url` in the Browser tab, from anywhere in the main window. */
export function openInMonoBrowser(url: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: url }));
}

export function subscribeOpenInBrowser(onOpen: (url: string) => void) {
  const listener = (event: Event) => {
    const url = (event as CustomEvent<unknown>).detail;
    if (typeof url === "string" && isWebUrl(url)) onOpen(url);
  };
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?(\/|$)/i;
const DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/;

export const SEARCH_URL = "https://www.google.com/search?q=";

/**
 * Address-bar text to an address: full web addresses stay as they are,
 * local servers get http, bare domains get https, anything else is a search.
 */
export function addressFromInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? text : null;
  if (!/\s/.test(text)) {
    if (LOCAL_HOST.test(text)) return `http://${text}`;
    if (DOMAIN.test(text)) return `https://${text}`;
  }
  return SEARCH_URL + encodeURIComponent(text);
}

const LAST_URL_KEY = "monocode.browser.lastUrl";

export function loadLastBrowserUrl(): string | null {
  try {
    const url = localStorage.getItem(LAST_URL_KEY);
    return url && isWebUrl(url) ? url : null;
  } catch {
    return null;
  }
}

export function saveLastBrowserUrl(url: string) {
  if (!isWebUrl(url)) return;
  try {
    localStorage.setItem(LAST_URL_KEY, url);
  } catch {
    // private mode / quota
  }
}

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Whether a MonoCode layer drawn outside the app root (menus, dialogs,
 * toasts) covers the page area. The page is a native view that paints above
 * everything, so it hides while one does.
 */
export function overlapsPage(page: Rect, layer: Rect): boolean {
  return (
    layer.right > layer.left &&
    layer.bottom > layer.top &&
    layer.left < page.right &&
    layer.right > page.left &&
    layer.top < page.bottom &&
    layer.bottom > page.top
  );
}
