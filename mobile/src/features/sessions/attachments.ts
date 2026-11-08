import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync, type ImagePickerAsset } from "expo-image-picker";

/** A file or photo held in the composer until it's sent. */
export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** On this phone, for the composer's thumbnail. */
  uri: string;
  /** The file's bytes, as the desktop takes them. */
  data: string;
  /** Fork (Hari, L-235): shown while its bytes are still being read or scaled; not sendable yet. */
  preparing?: boolean;
};

/** A pick shown at once, and its finished attachment, under the same id. */
export type Picked = { placeholder: Attachment; ready: Promise<Attachment> };

/** What the desktop is sent for each: it stages them as its own composer does. */
export type WireAttachment = Pick<Attachment, "name" | "mimeType" | "data">;

export const MAX_ATTACHMENTS = 10;
/** Per file, before it travels as base64. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The whole message's, under the link's request limit with room for the text. */
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024;
/** A photo's longer side; larger ones are scaled down, as vision models do anyway. */
const MAX_IMAGE_SIDE = 2048;
/** Sent as picked when already small and in a format every provider reads. */
const SENT_AS_IS = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_AS_IS_BYTES = 1.5 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  zip: "application/zip",
};

export const isImage = (attachment: Pick<Attachment, "mimeType">) =>
  attachment.mimeType.startsWith("image/");

export const toWire = (attachments: Attachment[]): WireAttachment[] =>
  attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }));

/** Photos from the library, scaled down and re-encoded where they need it. */
export async function pickPhotos(room: number): Promise<Picked[]> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: room,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, room).map((asset) => {
    const id = makeId();
    const mimeType = asset.mimeType ?? mimeFor(asset.fileName ?? "", null);
    return {
      placeholder: {
        id,
        name: asset.fileName ?? "photo",
        mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
        size: asset.fileSize ?? 0,
        uri: asset.uri,
        data: "",
        preparing: true,
      },
      ready: fromPhoto(asset, id),
    };
  });
}

/** Any files, from Files and its providers. */
export async function pickFiles(room: number): Promise<Picked[]> {
  const picked = await File.pickFileAsync({ multipleFiles: true });
  if (picked.canceled) return [];
  const files = picked.result.slice(0, room);
  const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES);
  if (tooLarge) throw new Error(`${tooLarge.name} is over the 10 MB limit.`);
  return files.map((file) => {
    const placeholder: Attachment = {
      id: makeId(),
      name: file.name,
      mimeType: mimeFor(file.name, file.type),
      size: file.size,
      uri: file.uri,
      data: "",
      preparing: true,
    };
    return {
      placeholder,
      ready: file.base64().then((data) => ({ ...placeholder, data, preparing: undefined })),
    };
  });
}

/** Adds picks to what's held, up to the limit. */
export function merge(existing: Attachment[], added: Attachment[]): Attachment[] {
  return [...existing, ...added].slice(0, MAX_ATTACHMENTS);
}

/** Puts a finished attachment in its placeholder's place; gone if it was removed meanwhile. */
export function settle(held: Attachment[], ready: Attachment): Attachment[] {
  return held.map((attachment) => (attachment.id === ready.id ? ready : attachment));
}

/** Why the message can't go as it is, if it can't: over the link's limit. */
export function sendProblem(attachments: Attachment[]): string | null {
  const total = attachments.reduce((sum, attachment) => sum + attachment.data.length, 0);
  return total > MAX_TOTAL_BASE64
    ? "These attachments are too large to send together. Remove some and try again."
    : null;
}

async function fromPhoto(asset: ImagePickerAsset, id: string): Promise<Attachment> {
  const mimeType = asset.mimeType ?? mimeFor(asset.fileName ?? "", null);
  const small =
    SENT_AS_IS.has(mimeType) &&
    (asset.fileSize ?? Infinity) <= MAX_AS_IS_BYTES &&
    Math.max(asset.width, asset.height) <= MAX_IMAGE_SIDE;
  if (small) {
    const file = new File(asset.uri);
    return {
      id,
      name: asset.fileName ?? `photo.${mimeType.split("/")[1]}`,
      mimeType,
      size: file.size,
      uri: asset.uri,
      data: await file.base64(),
    };
  }
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_IMAGE_SIDE)
    context.resize(
      asset.width >= asset.height ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE },
    );
  const saved = await (await context.renderAsync()).saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.85,
    base64: true,
  });
  const base = (asset.fileName ?? "photo").replace(/\.[^.]+$/, "");
  return {
    id,
    name: `${base}.jpg`,
    mimeType: "image/jpeg",
    size: Math.floor(((saved.base64 ?? "").length * 3) / 4),
    uri: saved.uri,
    data: saved.base64 ?? "",
  };
}

function mimeFor(name: string, type: string | null | undefined): string {
  if (type && type !== "application/octet-stream") return type;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
