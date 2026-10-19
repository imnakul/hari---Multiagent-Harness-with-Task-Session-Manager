import { invoke } from "@tauri-apps/api/core";

export type UserLink = {
  url: string;
  host: string;
  displayUrl: string;
  githubWorkItem?: GithubWorkItemLink;
};

export type GithubWorkItemLink = {
  kind: "pr" | "issue";
  repo: string;
  number: number;
};

export type UserMessageLink = {
  link: UserLink;
  beforeText: string;
  afterText: string;
};

export type LinkPreviewMetadata = {
  title: string | null;
  faviconDataUrl: string | null;
  description?: string | null;
  siteName?: string | null;
  /** Present only on rich previews, as a small JPEG thumbnail. */
  imageDataUrl?: string | null;
};

const metadataCache = new Map<string, Promise<LinkPreviewMetadata>>();

/** Find the first web URL and preserve the rest of the user's message. */
export function parseUserMessageLink(text: string): UserMessageLink | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;

  const value = trimUrlPunctuation(match[0]);
  const link = parseHttpUrl(value);
  if (!link) return null;

  return {
    link,
    beforeText: text.slice(0, match.index),
    afterText: text.slice(match.index + value.length),
  };
}

/** Kept as a small utility for callers that need the stricter exact-URL rule. */
export function parseStandaloneHttpUrl(text: string): UserLink | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  return parseHttpUrl(value);
}

function parseHttpUrl(value: string): UserLink | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    return null;
  }

  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  const displayHost = host.startsWith("www.") ? host.slice(4) : host;
  const suffix = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
  const workItem = githubWorkItem(parsed, displayHost);

  return {
    url: parsed.href,
    host: displayHost,
    displayUrl: `${displayHost}${suffix}`,
    ...(workItem ? { githubWorkItem: workItem } : {}),
  };
}

function githubWorkItem(
  url: URL,
  displayHost: string,
): GithubWorkItemLink | null {
  if (displayHost !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const resource = parts[2]?.toLowerCase();
  if (resource !== "pull" && resource !== "issues") return null;
  const numberText = parts[3] ?? "";
  if (!/^[1-9]\d*$/.test(numberText)) return null;
  const number = Number(numberText);
  if (!Number.isSafeInteger(number)) return null;

  const owner = decodePathPart(parts[0] ?? "");
  const name = decodePathPart(parts[1] ?? "");
  if (!owner || !name || /[\s/]/.test(owner) || /[\s/]/.test(name)) return null;

  return {
    kind: resource === "pull" ? "pr" : "issue",
    repo: `${owner}/${name}`,
    number,
  };
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function trimUrlPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && /[.,!;:]/.test(value[end - 1])) end -= 1;

  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    while (
      value.slice(0, end).endsWith(closing) &&
      count(value.slice(0, end), closing) > count(value.slice(0, end), opening)
    ) {
      end -= 1;
    }
  }
  return value.slice(0, end);
}

function count(value: string, character: string): number {
  return value.split(character).length - 1;
}

export function fetchLinkPreviewMetadata(
  url: string,
): Promise<LinkPreviewMetadata> {
  const cached = metadataCache.get(url);
  if (cached) return cached;

  const pending = invoke<LinkPreviewMetadata>("fetch_link_preview", { url });
  metadataCache.set(url, pending);
  pending.catch(() => metadataCache.delete(url));
  return pending;
}

export const RICH_PREVIEW_CACHE_LIMIT = 100;
const THUMBNAIL_MAX_WIDTH = 480;
const richCache = new Map<string, Promise<LinkPreviewMetadata>>();

/**
 * A chat card's preview: page metadata plus its preview image, shrunk to a
 * JPEG thumbnail before it is kept. Held in memory for the most recent
 * {@link RICH_PREVIEW_CACHE_LIMIT} links only; nothing is written to disk.
 */
export function fetchRichLinkPreview(url: string): Promise<LinkPreviewMetadata> {
  const cached = richCache.get(url);
  if (cached) {
    // Re-insert so the map's order stays least recently used first.
    richCache.delete(url);
    richCache.set(url, cached);
    return cached;
  }
  const pending = invoke<LinkPreviewMetadata>("fetch_link_preview", {
    url,
    includeImage: true,
  }).then(async (metadata) => ({
    ...metadata,
    imageDataUrl: metadata.imageDataUrl
      ? await thumbnail(metadata.imageDataUrl).catch(() => null)
      : null,
  }));
  richCache.set(url, pending);
  pending.catch(() => richCache.delete(url));
  while (richCache.size > RICH_PREVIEW_CACHE_LIMIT) {
    const oldest = richCache.keys().next().value;
    if (oldest === undefined) break;
    richCache.delete(oldest);
  }
  return pending;
}

/** Redraws an image at card size so a 1 MB page image is kept as ~30 KB. */
function thumbnail(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / image.naturalWidth);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not draw the preview image"));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("Could not read the preview image"));
    image.src = source;
  });
}

/**
 * Distinct web links in a reply's Markdown, in order, at most `limit`. Code is
 * skipped, since a URL there is an example rather than a link.
 */
export function collectWebLinks(markdown: string, limit: number): UserLink[] {
  const prose = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  const links: UserLink[] = [];
  const seen = new Set<string>();
  // `]` ends a URL used as link text; an unbalanced `)` from `[text](url)` is
  // trimmed below.
  for (const match of prose.matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    if (links.length >= limit) break;
    const link = parseHttpUrl(trimUrlPunctuation(match[0]));
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links;
}
