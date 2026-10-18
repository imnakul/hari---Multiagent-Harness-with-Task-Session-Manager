import { invoke } from "@tauri-apps/api/core";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { providerAccounts } from "./providerAccounts";
import type { Block, Session } from "../../sessions/model/session";

/** Fork feature L-102: carry a Claude chat to another account by copying its native transcript. */
export const REWIND_NOTE =
  "Rewinding to a turn from before the switch is not supported on the new account.";

export function continueCostNote(accountLabel: string): string {
  return `The first reply on ${accountLabel} is not cached, so it uses more of that account's limit once. Later replies are cached as usual.`;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claude chats that have a native transcript and live on this computer. */
export function canContinueOnAccount(
  session: Pick<
    Session,
    "harness" | "providerSessionId" | "cwd" | "ephemeral" | "inboxAsk" | "blocks"
  >,
): boolean {
  return (
    session.harness === "claude" &&
    session.blocks.length > 0 &&
    !!session.providerSessionId &&
    UUID.test(session.providerSessionId) &&
    !session.ephemeral &&
    !session.inboxAsk &&
    !isRemoteProjectPath(session.cwd)
  );
}

/** Why the chat cannot be moved right now, or null when it can. */
export function continueBlockedReason(
  session: Pick<Session, "busy" | "backgroundTasks" | "externalTurnId">,
  liveInteractive: boolean,
): string | null {
  if (session.busy || session.externalTurnId)
    return "This chat is running. Stop it or wait for it to finish, then continue on another account.";
  if (session.backgroundTasks?.length)
    return "This chat still has background tasks running. Stop them or wait, then continue on another account.";
  if (liveInteractive)
    return "The Interactive Claude process is still open. Stop it first, then continue on another account.";
  return null;
}

export async function copyClaudeSession(input: {
  fromAccount: string;
  toAccount: string;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  if (!UUID.test(input.sessionId)) throw new Error("Invalid Claude session id");
  try {
    await invoke("claude_copy_session", input);
  } catch (reason) {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
}

export function continuedMarker(accountLabel: string): Block {
  return {
    id: crypto.randomUUID(),
    role: "system",
    text: `Continued on ${accountLabel}`,
  };
}

/** Other Claude accounts a chat on `currentAccountId` could move to. */
export function continueAccountTargets(
  currentAccountId: string,
): { id: string; label: string }[] {
  return providerAccounts("claude")
    .filter((account) => account.id !== currentAccountId)
    .map(({ id, label }) => ({ id, label }));
}
