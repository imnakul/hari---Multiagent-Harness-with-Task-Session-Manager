/** Fork (L-395): files attached while creating a ClickUp task. Pure, so the limits and the upload loop are testable. */

export const MAX_TASK_FILES = 10;
export const MAX_TASK_FILE_BYTES = 25 * 1024 * 1024;

export const TOO_MANY_FILES = "Up to 10 files per task.";
export const FILE_TOO_BIG = "Files must be 25 MB or smaller.";

export interface ClickupPendingFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Absolute path of a picked or dropped file; Rust reads it. */
  path?: string;
  /** Base64 payload of a pasted blob. */
  data?: string;
  /** Object URL for an image thumbnail; revoked by the owner. */
  previewUrl?: string;
  status: "pending" | "done" | "failed";
  error?: string;
}

export interface ClickupUploadFile {
  path?: string;
  data?: string;
  name: string;
  mimeType: string;
}

export type ClickupUploader = (taskId: string, file: ClickupUploadFile) => Promise<unknown>;

/** Adds files up to the limits; a file that breaks one is skipped and the matching message returned. */
export function addPendingFiles(
  current: readonly ClickupPendingFile[],
  incoming: readonly ClickupPendingFile[],
): { files: ClickupPendingFile[]; error: string | null } {
  const files = [...current];
  let error: string | null = null;
  for (const file of incoming) {
    if (file.size > MAX_TASK_FILE_BYTES) {
      error = FILE_TOO_BIG;
      continue;
    }
    if (files.length >= MAX_TASK_FILES) {
      error = TOO_MANY_FILES;
      continue;
    }
    files.push({ ...file, status: "pending" });
  }
  return { files, error };
}

/**
 * Uploads the files that still need it, one at a time and in order. A failure
 * is recorded on its file and the rest still run. Returns the updated list;
 * `onProgress` gets the 1-based position among the files being uploaded.
 */
export async function uploadAll(
  taskId: string,
  files: readonly ClickupPendingFile[],
  upload: ClickupUploader,
  onProgress?: (position: number, total: number) => void,
  shouldContinue: () => boolean = () => true,
): Promise<ClickupPendingFile[]> {
  const todo = files.filter((file) => file.status !== "done");
  const results = new Map<string, ClickupPendingFile>();
  let position = 0;
  for (const file of todo) {
    if (!shouldContinue()) break;
    position += 1;
    onProgress?.(position, todo.length);
    try {
      await upload(taskId, { path: file.path, data: file.data, name: file.name, mimeType: file.mimeType });
      results.set(file.id, { ...file, status: "done", error: undefined });
    } catch (failure) {
      results.set(file.id, {
        ...file,
        status: "failed",
        error: failure instanceof Error ? failure.message : "Upload failed.",
      });
    }
  }
  return files.map((file) => results.get(file.id) ?? file);
}

export function failedCount(files: readonly ClickupPendingFile[]): number {
  return files.filter((file) => file.status === "failed").length;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the attachment helpers return, narrowed to what an upload needs. */
export interface UploadSource {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path?: string;
  data?: string;
  previewUrl?: string;
}

/** A picked, dropped or pasted file as a pending upload; null when it has nothing to read. */
export function toPendingFile(source: UploadSource): ClickupPendingFile | null {
  // Rust takes a path or data, never both; a file on disk wins.
  if (!source.path && !source.data) return null;
  return {
    id: source.id,
    name: source.name,
    mimeType: source.mimeType || "application/octet-stream",
    size: source.size,
    ...(source.path ? { path: source.path } : { data: source.data }),
    ...(source.previewUrl ? { previewUrl: source.previewUrl } : {}),
    status: "pending",
  };
}
