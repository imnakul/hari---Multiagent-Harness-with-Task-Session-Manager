import { sidechatContextBlock, sidechatTitle } from "./fork";
import {
  formatSessionTitle,
  newSession,
  sessionDisplayTitle,
  type Session,
} from "./session";

export type SidechatContextPrepared = {
  sourceTitle: string;
  sourceContext?: string;
};

type SidechatSubmitInput = {
  sessionId: string;
  sourceSessionId: string;
  fallback: SidechatContextPrepared;
  findLiveSource: () => Session | undefined;
  loadSavedSource: (id: string) => Promise<Session | null | undefined>;
  isStillOpen: () => boolean;
  submitPrepared: (
    sessionId: string,
    prepared: SidechatContextPrepared,
  ) => boolean | Promise<boolean>;
  onAsyncFailure: (message: string) => void;
  timeoutMs?: number;
};

/**
 * The source context to put before this send, if any. It goes with the first
 * message only: every harness keeps the sidechat's messages in its own native
 * history, so once a message was sent and the harness bound a native
 * conversation (`providerSessionId`), the agent already has the context.
 * Sending it again piled up on every turn, wasted tokens and forced frequent
 * compactions (fork, L-187 for Interactive Claude, L-188 for all harnesses).
 * Without a native conversation yet, the context goes again.
 */
export function sidechatContextForSend(
  session: Pick<Session, "blocks" | "providerSessionId">,
  prepared: SidechatContextPrepared | undefined,
): string | undefined {
  const sentBefore = session.blocks.some((block) => block.role === "user");
  if (sentBefore && session.providerSessionId) return undefined;
  return prepared?.sourceContext;
}

/** Coalesces the saved-parent lookup needed before a closed-parent sidechat send. */
export class SidechatSubmitPreflight {
  private pending = new Map<string, object>();

  has(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  cancel(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  submit(input: SidechatSubmitInput): boolean | Promise<boolean> {
    if (this.pending.has(input.sessionId)) return false;
    const liveSource = input.findLiveSource();
    const prepare = (source?: Session | null): SidechatContextPrepared => {
      if (!source) return input.fallback;
      const sourceTitle = sessionDisplayTitle(source.title, source.harness);
      const sourceContext =
        sidechatContextBlock(sourceTitle, source.blocks) ??
        input.fallback.sourceContext;
      return {
        sourceTitle,
        ...(sourceContext ? { sourceContext } : {}),
      };
    };

    if (liveSource)
      return input.submitPrepared(input.sessionId, prepare(liveSource));

    const token = {};
    this.pending.set(input.sessionId, token);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), input.timeoutMs ?? 5_000);
    });
    void Promise.race([
      Promise.resolve().then(() =>
        input.loadSavedSource(input.sourceSessionId),
      ),
      expired,
    ])
      .then(async (source) => {
        if (timeout) clearTimeout(timeout);
        if (this.pending.get(input.sessionId) !== token) return;
        this.pending.delete(input.sessionId);
        if (!input.isStillOpen()) return;
        try {
          const accepted = await input.submitPrepared(
            input.sessionId,
            prepare(source),
          );
          if (!accepted)
            input.onAsyncFailure("The sidechat could not accept this message.");
        } catch {
          if (input.isStillOpen())
            input.onAsyncFailure("The sidechat could not accept this message.");
        }
      })
      .catch(() => {
        if (timeout) clearTimeout(timeout);
        if (this.pending.get(input.sessionId) !== token) return;
        this.pending.delete(input.sessionId);
        if (!input.isStillOpen()) return;
        input.onAsyncFailure("The sidechat could not load its source context.");
      });
    return true;
  }
}

/** A side question gets its own native owner, preserving the chosen transport.
 * Use the existing context snapshot so subsequent side questions can refresh
 * their source without splicing messages into a forked native history. */
export function createSidechatSession(source: Session): Session {
  const display = sessionDisplayTitle(source.title, source.harness);
  const sourceContext = sidechatContextBlock(display, source.blocks);
  return {
    ...newSession(
      source.harness,
      source.cwd,
      source.model,
      source.runtimeMode,
      source.modelSettings,
    ),
    model: source.model,
    modelSettings: { ...source.modelSettings },
    title: formatSessionTitle(source.harness, sidechatTitle(display)),
    ...(source.providerAccountId
      ? { providerAccountId: source.providerAccountId }
      : {}),
    ...(source.worktreeCwd ? { worktreeCwd: source.worktreeCwd } : {}),
    ...(source.branch ? { branch: source.branch } : {}),
    sidechat: {
      sourceSessionId: source.id,
      sourceTitle: display,
      ...(sourceContext ? { sourceContext } : {}),
    },
  };
}
