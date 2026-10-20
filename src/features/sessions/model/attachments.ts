import { invoke } from "@tauri-apps/api/core";
import { basename, pickFiles as pickFilePaths } from "../../../platform/tauri/fs";
import type { Attachment, AttachmentKind } from "./session";
import {
  canonicalizeProjectImagePath,
  readBinaryFile,
  readProjectImageFile,
} from "../../../platform/tauri/fs";

export const MAX_ATTACHMENTS = 20;
export const MAX_EMBED_BYTES = 20 * 1024 * 1024;

type PathInfo = {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
};

type NativeFile = File & { path?: string };

export type PromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; uri?: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      size?: number;
    };

const SKIP_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * Stands in for a turn that arrived with files but no words.
 *
 * Sent on the wire only. The transcript keeps the empty text and shows the
 * attachments on their own, so this never reaches the user's own message.
 */
export const ATTACHMENT_ONLY_PROMPT =
  "The user attached these files without saying anything. Use the conversation above to work out what they want done with them, then do that. If the conversation gives you nothing to go on, ask.";

/**
 * The turn's text, or a stand-in when files arrived without any.
 *
 * A turn carrying only attachments never says what to do with them, leaving a
 * model to guess or to ask what the files are for. The conversation so far is
 * the only clue the user left behind, so point the model at it instead.
 */
export function promptText(
  text: string,
  attachments: Attachment[] = [],
): string {
  const trimmed = text.trim();
  if (trimmed || !attachments.length) return trimmed;
  return ATTACHMENT_ONLY_PROMPT;
}

/** A copied folder. No harness can open one, so it travels as its path. */
const FOLDER_MIME = "inode/directory";

/** MIME types providers typically send as vision input. */
const VISION_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "application/toml",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/javascript",
  jsx: "text/plain",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css",
  rs: "text/plain",
  py: "text/x-python",
  go: "text/plain",
  java: "text/plain",
  kt: "text/plain",
  swift: "text/plain",
  c: "text/plain",
  h: "text/plain",
  cc: "text/plain",
  cpp: "text/plain",
  hpp: "text/plain",
  cs: "text/plain",
  rb: "text/plain",
  php: "text/plain",
  sh: "text/plain",
  zsh: "text/plain",
  bash: "text/plain",
  sql: "application/sql",
  graphql: "application/graphql",
};

export function persistableAttachment(file: Attachment): Attachment {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    kind: file.kind,
    size: file.size,
    ...(file.path ? { path: file.path } : {}),
  };
}

export function displayAttachments(files: Attachment[]): Attachment[] {
  return files.map((file) => ({
    ...persistableAttachment(file),
    ...(file.path ? { copyFromPath: true } : {}),
    ...(file.previewUrl ? { previewUrl: file.previewUrl } : {}),
    ...(file.data ? { data: file.data } : {}),
  }));
}

export function attachmentPreviewSrc(file: Attachment): string | undefined {
  if (file.previewUrl) return file.previewUrl;
  if (file.data && file.kind === "image") {
    return `data:${file.mimeType};base64,${file.data}`;
  }
  return undefined;
}

export function revokeAttachment(file: Attachment) {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

/** A pasted file shown at once, while it is still being read and saved (L-134). */
export type PendingAttachment = {
  id: string;
  name: string;
  /** Object URL of a pasted image; absent for other files. */
  previewUrl?: string;
  /** The pasted file, so its real attachment can reuse `previewUrl`. */
  file?: File;
};

/**
 * Placeholder chips for pasted files, so an image shows the moment it is
 * pasted instead of after it is encoded and written to disk. The caller owns
 * each `previewUrl` and revokes it once the real attachment replaces it.
 */
export function pendingAttachmentsFor(files: File[]): PendingAttachment[] {
  return files
    .filter((file) => !skipName(file.name))
    .map((file) => {
      const mimeType = mimeFromFile(file);
      return {
        id: crypto.randomUUID(),
        name: file.name.trim() || fallbackName(mimeType),
        ...(kindFromMime(mimeType) === "image"
          ? { previewUrl: URL.createObjectURL(file), file }
          : {}),
      };
    });
}

/** Preview URLs a pasted file's attachment may adopt instead of making its own. */
export function pendingPreviewUrls(
  pending: PendingAttachment[],
): Map<File, string> {
  return new Map(
    pending.flatMap((item) =>
      item.file && item.previewUrl
        ? [[item.file, item.previewUrl] as const]
        : [],
    ),
  );
}

function bytesAt(bytes: Uint8Array, offset: number, prefix: number[]): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Magic-byte sniff so a preview URL is only minted for real images — a file
 * named `.png` holding markup must never become a document URL.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytesAt(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (bytesAt(bytes, 0, [0x42, 0x4d])) return "image/bmp";
  if (bytesAt(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  // RIFF....WEBP — the four size bytes at offset 4 are skipped.
  if (
    bytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  // ....ftyp{avif,avis} — an ISO base media box, shared with HEIF and MP4.
  if (bytesAt(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

const PREVIEW_URL_CACHE = 50;
const previewUrls = new Map<string, string>();
const projectPreviewUrls = new Map<string, string>();

function cachePreviewUrl(path: string, url: string): void {
  if (previewUrls.has(path)) return;
  previewUrls.set(path, url);
  while (previewUrls.size > PREVIEW_URL_CACHE) {
    const oldest = previewUrls.keys().next();
    if (oldest.done) break;
    const evicted = previewUrls.get(oldest.value);
    previewUrls.delete(oldest.value);
    if (evicted) URL.revokeObjectURL(evicted);
  }
}

/**
 * Object URL for an image attachment that only has a disk path (reloaded
 * sessions strip inline data). Resolves null when the file is missing or not
 * a real image — callers keep the file-icon chip. Cached per path so long
 * threads don't re-read the same file on every render.
 */
export async function loadAttachmentPreviewUrl(
  path: string,
): Promise<string | null> {
  const hit = previewUrls.get(path);
  if (hit) return hit;
  try {
    const bytes = await readBinaryFile(path);
    const mime = sniffImageMime(bytes);
    if (!mime) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    cachePreviewUrl(path, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Local Markdown images use a distinct cache and validate canonical project
 * containment before every cache lookup. A path cached by an ordinary
 * user-selected attachment can never satisfy this restricted read.
 */
export async function loadProjectImagePreviewUrl(
  path: string,
  cwd: string,
): Promise<string | null> {
  if (!cwd.trim() || cwd.startsWith("remote://") || path.startsWith("remote://"))
    return null;
  try {
    const canonical = await canonicalizeProjectImagePath(path, cwd);
    const key = `${canonical.root}\0${canonical.path}`;
    const hit = projectPreviewUrls.get(key);
    if (hit) return hit;
    const bytes = await readProjectImageFile(path, cwd);
    const mime = sniffImageMime(bytes);
    if (!mime) return null;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    if (!projectPreviewUrls.has(key)) {
      projectPreviewUrls.set(key, url);
      while (projectPreviewUrls.size > PREVIEW_URL_CACHE) {
        const oldest = projectPreviewUrls.keys().next();
        if (oldest.done) break;
        const evicted = projectPreviewUrls.get(oldest.value);
        projectPreviewUrls.delete(oldest.value);
        if (evicted) URL.revokeObjectURL(evicted);
      }
    } else {
      URL.revokeObjectURL(url);
    }
    return projectPreviewUrls.get(key) ?? null;
  } catch {
    return null;
  }
}

export function mergeAttachments(
  existing: Attachment[],
  incoming: Attachment[],
): Attachment[] {
  const next = [...existing];
  for (const file of incoming) {
    const duplicate = next.some(
      (item) =>
        (item.path && file.path && item.path === file.path) ||
        item.id === file.id,
    );
    if (duplicate) continue;
    next.push(file);
    if (next.length >= MAX_ATTACHMENTS) break;
  }
  return next;
}

type ClipboardFileItem = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

/** Clipboard files plus items. WebKit's FileList is often truncated to the first file. */
export function filesFromClipboard(
  data:
    | {
        files?: ArrayLike<File> | null;
        items?: ArrayLike<ClipboardFileItem> | null;
      }
    | null
    | undefined,
): File[] {
  const fromList = arrayLike(data?.files);
  const fromItems: File[] = [];
  for (const item of arrayLike(data?.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  const files = fromItems.length > fromList.length ? fromItems : fromList;
  return dropMacScreenshotTwins(files);
}

function arrayLike<T>(list: ArrayLike<T> | null | undefined): T[] {
  return list ? Array.from(list) : [];
}

/** macOS often exposes the same screenshot as PNG and an unnamed TIFF. */
function dropMacScreenshotTwins(files: File[]): File[] {
  const unnamedTiff = (file: File) => {
    const type = file.type.toLowerCase();
    if (type !== "image/tiff" && type !== "image/tif") return false;
    const name = file.name.trim().toLowerCase();
    return (
      !name || name === "image.tiff" || name === "image.tif" || name === "image"
    );
  };
  const hasOtherImage = files.some(
    (file) => file.type.startsWith("image/") && !unnamedTiff(file),
  );
  if (!hasOtherImage) return files;
  return files.filter((file) => !unnamedTiff(file));
}

export async function pickAttachments(): Promise<Attachment[]> {
  const paths = await pickFilePaths();
  if (!paths?.length) return [];
  return attachmentsFromPaths(paths);
}

export async function attachmentsFromPaths(
  paths: string[],
): Promise<Attachment[]> {
  const unique = [...new Set(paths.filter((path) => path.trim()))];
  if (unique.length === 0) return [];
  const infos = await invoke<PathInfo[]>("inspect_paths", { paths: unique });
  const out: Attachment[] = [];
  for (const info of infos) {
    const file = await attachmentFromPath(info);
    if (file) out.push(file);
  }
  return out;
}

/**
 * `previews` lends existing object URLs (see `pendingPreviewUrls`). A lent
 * URL is never revoked here: an attachment that uses it takes ownership, and
 * the lender keeps every URL no attachment took.
 */
export async function attachmentsFromFiles(
  files: File[],
  previews?: ReadonlyMap<File, string>,
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  const pathFiles: string[] = [];
  const blobs: File[] = [];
  for (const file of files) {
    const path = nativePath(file);
    if (path) pathFiles.push(path);
    else blobs.push(file);
  }
  if (pathFiles.length) {
    out.push(...(await attachmentsFromPaths(pathFiles)));
  }
  for (const file of blobs) {
    const item = await attachmentFromBlob(file, previews?.get(file));
    if (item) out.push(item);
  }
  return out;
}

export async function prepareAttachments(
  files: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (file) => {
      if (file.data || !file.path) return file;
      if (!isVisionImage(file.mimeType) || file.size > MAX_EMBED_BYTES) {
        return file;
      }
      try {
        const data = await invoke<string>("read_file_base64", {
          path: file.path,
        });
        return { ...file, data };
      } catch {
        return file;
      }
    }),
  );
}

export function promptBlocks(
  text: string,
  attachments: Attachment[] = [],
): PromptContentBlock[] {
  const blocks: PromptContentBlock[] = [];
  const body = promptText(text, attachments);
  if (body) blocks.push({ type: "text", text: body });
  for (const file of attachments) {
    blocks.push(contentBlockFor(file));
  }
  return blocks;
}

/** Require a deliverable source instead of silently dropping an attachment. */
export function attachmentPath(file: Attachment): string {
  if (!file.path?.trim()) {
    throw new Error(
      `Cannot attach ${JSON.stringify(file.name)}: no local file path is available. Attach the file again.`,
    );
  }
  return file.path;
}

/** Native harnesses without file blocks can ask their tools to read this path. */
export function attachmentPathText(file: Attachment): string {
  if (isAttachmentFolder(file)) {
    return `Attached folder (list or read the files inside from this path): ${JSON.stringify(attachmentPath(file))}`;
  }
  return `Attached file (read from disk): ${JSON.stringify(attachmentPath(file))}`;
}

export function isAttachmentFolder(file: Attachment): boolean {
  return file.mimeType === FOLDER_MIME;
}

function contentBlockFor(file: Attachment): PromptContentBlock {
  // No harness can open a folder, so it travels as a path for the agent's own
  // tools rather than a resource link nothing can read.
  if (isAttachmentFolder(file)) {
    return { type: "text", text: attachmentPathText(file) };
  }
  if (file.data && isVisionImage(file.mimeType)) {
    return {
      type: "image",
      mimeType: normalizeImageMime(file.mimeType),
      data: file.data,
      ...(file.path ? { uri: fileUri(file.path) } : {}),
    };
  }
  return {
    type: "resource_link",
    uri: fileUri(attachmentPath(file)),
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
  };
}

async function attachmentFromPath(info: PathInfo): Promise<Attachment | null> {
  if (skipName(info.name)) return null;
  // A folder's name says nothing about its contents, and a harness handed a
  // resource_link for a directory has nothing to open.
  const mimeType = info.isDir ? FOLDER_MIME : mimeFromName(info.name);
  const kind = kindFromMime(mimeType);
  const file: Attachment = {
    id: crypto.randomUUID(),
    name: info.name,
    mimeType,
    kind,
    size: info.size,
    path: info.path,
  };
  if (
    isVisionImage(mimeType) &&
    info.size > 0 &&
    info.size <= MAX_EMBED_BYTES
  ) {
    try {
      file.data = await invoke<string>("read_file_base64", { path: info.path });
    } catch {
      // Fall back to a resource_link so the agent can still read the file.
    }
  }
  return file;
}

async function attachmentFromBlob(
  file: File,
  lentPreviewUrl?: string,
): Promise<Attachment | null> {
  if (skipName(file.name) || file.size < 0) return null;
  const mimeType = mimeFromFile(file);
  const kind = kindFromMime(mimeType);
  const name = file.name.trim() || fallbackName(mimeType);
  const previewUrl =
    kind === "image"
      ? (lentPreviewUrl ?? URL.createObjectURL(file))
      : undefined;
  const dropPreview = () => {
    if (previewUrl && previewUrl !== lentPreviewUrl)
      URL.revokeObjectURL(previewUrl);
  };
  const data = await readBlobBase64(file);
  if (kind === "image" && isVisionImage(mimeType) && data) {
    // Persist a copy alongside the inline data: the session store strips
    // data on save, and without a path the thumbnail could never reload.
    let path: string | undefined;
    try {
      path = await invoke<string>("write_attachment", { name, data });
    } catch {
      path = undefined;
    }
    return {
      id: crypto.randomUUID(),
      name,
      mimeType: normalizeImageMime(mimeType),
      kind,
      size: file.size,
      data,
      previewUrl,
      ...(path ? { path } : {}),
    };
  }
  if (data === null) {
    dropPreview();
    return null;
  }
  try {
    const path = await invoke<string>("write_attachment", { name, data });
    return {
      id: crypto.randomUUID(),
      name,
      mimeType,
      kind,
      size: file.size,
      path,
      previewUrl,
    };
  } catch {
    dropPreview();
    return null;
  }
}

function mimeFromFile(file: File): string {
  const fromName = mimeFromName(file.name);
  if (file.type && file.type !== "application/octet-stream") {
    if (fromName !== "application/octet-stream") return fromName;
    return file.type;
  }
  return fromName;
}

function mimeFromName(name: string): string {
  const ext = extension(name);
  if (!ext) return "application/octet-stream";
  return (
    MIME_BY_EXT[ext] ??
    (isTextExt(ext) ? "text/plain" : "application/octet-stream")
  );
}

function isTextExt(ext: string): boolean {
  return [
    "txt",
    "md",
    "rst",
    "log",
    "cfg",
    "ini",
    "env",
    "lock",
    "gradle",
    "cmake",
    "mk",
    "vue",
    "svelte",
    "astro",
    "scss",
    "sass",
    "less",
    "lua",
    "r",
    "jl",
    "ex",
    "exs",
    "erl",
    "hs",
    "ml",
    "clj",
    "scala",
    "groovy",
    "dart",
    "nim",
    "zig",
    "proto",
    "graphqls",
  ].includes(ext);
}

function kindFromMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

export function isVisionImage(mimeType: string): boolean {
  return VISION_MIME.has(mimeType.toLowerCase());
}

export function normalizeImageMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

function extension(name: string): string {
  const base = basename(name).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

function skipName(name: string): boolean {
  return SKIP_NAMES.has(basename(name).toLowerCase());
}

function nativePath(file: File): string | undefined {
  const path = (file as NativeFile).path;
  return path?.trim() ? path : undefined;
}

function fallbackName(mimeType: string): string {
  if (mimeType === "image/png") return "image.png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image.jpg";
  if (mimeType === "image/gif") return "image.gif";
  if (mimeType === "image/webp") return "image.webp";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "attachment";
}

function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const abs = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${abs.split("/").map(encodeURIComponent).join("/")}`;
}

function readBlobBase64(file: File): Promise<string | null> {
  if (file.size > MAX_EMBED_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        resolve(null);
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
