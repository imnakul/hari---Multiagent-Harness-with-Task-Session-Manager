import { ClickupError } from "./clickupApi";

/** Fork (L-381): the user-facing line for a failed ClickUp call. Never includes the token or headers. */
export function describeClickupError(error: unknown): string {
  if (!(error instanceof ClickupError)) return "Couldn't reach ClickUp.";
  switch (error.kind) {
    case "notConnected":
    case "auth":
      return "Your ClickUp token stopped working. Connect again.";
    case "forbidden":
      return "You don't have permission to edit this list.";
    case "notFound":
      return "ClickUp can't find that. It may have been deleted.";
    case "rateLimited":
      return `ClickUp is busy. Try again in ${error.retryAfterSeconds ?? 60} s.`;
    case "invalid":
      return error.message;
    default:
      return "Couldn't reach ClickUp.";
  }
}
