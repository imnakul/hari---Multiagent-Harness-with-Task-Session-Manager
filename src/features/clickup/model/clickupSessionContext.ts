import { copyMessage } from "../../../platform/tauri/clipboard";
import { attachmentsFromPaths, MAX_EMBED_BYTES } from "../../sessions/model/attachments";
import { clickupApi, type ClickupTask, type ClickupTaskDetails } from "./clickupApi";
import { sessionPromptForTask } from "./clickupTasks";

/** At most this many task files ride along into one composer. */
export const MAX_SESSION_FILES = 10;

export interface ClickupSessionContext {
  text: string;
  /** Local copies of the task's files, for the composer's attachments. */
  filePaths: string[];
}

/**
 * Fork (L-381): everything a session about this task starts with: the latest
 * copy of the task, its details as text, and its files downloaded through the
 * connection. Files that are too big or fail to download are named in the
 * text instead, so a session always starts.
 */
export async function clickupSessionContext(
  task: Pick<ClickupTask, "id" | "name" | "markdownDescription">,
): Promise<ClickupSessionContext> {
  let details: ClickupTaskDetails | null;
  try {
    details = await clickupApi.taskDetails(task.id);
  } catch (error) {
    // The row's own copy is enough to start from; only the files are lost.
    console.warn("ClickUp: task details unavailable for the session", error);
    details = null;
  }
  const files = (details?.attachments ?? []).filter((file) => file.id);
  const wanted = files
    .filter((file) => file.size === null || file.size <= MAX_EMBED_BYTES)
    .slice(0, MAX_SESSION_FILES);
  const results = await Promise.allSettled(wanted.map((file) => clickupApi.downloadAttachment(task.id, file.id)));
  const filePaths: string[] = [];
  const attachedFiles: string[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      filePaths.push(result.value.path);
      attachedFiles.push(result.value.name);
    }
  });
  const attachedIds = new Set(wanted.filter((_, index) => results[index]?.status === "fulfilled").map((file) => file.id));
  const missingFiles = files.filter((file) => !attachedIds.has(file.id));
  const text = sessionPromptForTask(details?.task ?? task, { attachedFiles, missingFiles });
  return { text, filePaths };
}

/**
 * Fork (L-390): Copy for a task or subtask: the same useful text a session
 * gets, with the task's files riding along, so pasting into a composer here
 * attaches them (elsewhere, the text alone pastes).
 */
export async function copyClickupTask(task: Pick<ClickupTask, "id" | "name" | "markdownDescription">): Promise<void> {
  const context = await clickupSessionContext(task);
  const attachments = await attachmentsFromPaths(context.filePaths);
  await copyMessage(context.text, attachments);
}
