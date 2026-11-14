/**
 * Fork (L-274): an Aside turn's reply, read from the MonoCode session it runs
 * in. Each call returns only what is new since the last one, so the reply
 * streams to Aside as the session fills in.
 */
import { toolCallLabel } from "../../sessions/model/transcriptActivity";
import type { Block, Session } from "../../sessions/model/session";

export type ReplyCursor = {
  /** Characters already sent, per assistant or reasoning block. */
  sent: Record<string, number>;
  /** Tool and notice blocks already reported. */
  reported: string[];
  /** Some answer text has gone out, so the next block starts a paragraph. */
  wroteText: boolean;
  /** The session was busy with this turn at some point. */
  sawBusy: boolean;
};

export type ReplyStep = {
  content: string;
  reasoning: string;
  cursor: ReplyCursor;
  done: boolean;
};

export const NEW_CURSOR: ReplyCursor = { sent: {}, reported: [], wroteText: false, sawBusy: false };

/** This turn's blocks: after its user message, up to the next one. */
function turnBlocks(session: Session, requestId: string): Block[] | undefined {
  const start = session.blocks.findIndex(
    (block) => block.role === "user" && block.appRequestId === requestId,
  );
  if (start < 0) return undefined;
  const rest = session.blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.role === "user" && !block.internal);
  return end < 0 ? rest : rest.slice(0, end);
}

export function replyProgress(session: Session, requestId: string, cursor: ReplyCursor): ReplyStep {
  const blocks = turnBlocks(session, requestId);
  const next: ReplyCursor = {
    sent: { ...cursor.sent },
    reported: [...cursor.reported],
    wroteText: cursor.wroteText,
    sawBusy: cursor.sawBusy || (!!blocks && !!session.busy),
  };
  let content = "";
  let reasoning = "";
  for (const block of blocks ?? []) {
    if (block.internal || block.draft) continue;
    if (block.role === "assistant" || block.role === "reasoning") {
      const sent = next.sent[block.id] ?? 0;
      if (block.text.length <= sent) continue;
      const fresh = block.text.slice(sent);
      next.sent[block.id] = block.text.length;
      if (block.role === "reasoning") reasoning += fresh;
      else {
        content += sent === 0 && next.wroteText ? `\n\n${fresh}` : fresh;
        next.wroteText = true;
      }
      continue;
    }
    if (next.reported.includes(block.id)) continue;
    if (block.role === "tool") {
      const label = toolCallLabel(block, session.cwd).trim();
      if (!label) continue;
      next.reported.push(block.id);
      reasoning += `\n• ${label}\n`;
    } else if (block.role === "approval" && !block.approval?.decided) {
      next.reported.push(block.id);
      reasoning += "\n• Waiting for your approval in MonoCode\n";
    } else if (block.role === "system" && block.notice === "error" && block.text.trim()) {
      next.reported.push(block.id);
      content += `${next.wroteText ? "\n\n" : ""}⚠ ${block.text.trim()}`;
      next.wroteText = true;
    }
  }
  // A turn is over once its message is in and the session went quiet after it.
  const done =
    !!blocks && !session.busy && (next.sawBusy || blocks.some((block) => block.role === "assistant"));
  return { content, reasoning, cursor: next, done };
}
