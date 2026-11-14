import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import {
  modelEffortSetting,
  modelsFor,
  type AgentModel,
} from "../../sessions/model/models";
import type { HarnessId, Session } from "../../sessions/model/session";
import {
  classifyAsideRequest,
  parseAsideRequest,
  promptWithHistory,
  type AsideRequest,
  type AsideWork,
} from "../model/asideRequest";
import {
  asideEffort,
  asideProviders,
  parseAsideModelId,
  type AsideHarness,
} from "../model/asideModels";
import {
  conversationKey,
  findConversation,
  rememberConversation,
} from "../model/asideConversations";
import { NEW_CURSOR, replyProgress, type ReplyCursor } from "../model/asideReply";
import { asideChunk, asideCompletion } from "../model/asideStream";

/** A new session for an Aside chat, in the CLI project. */
export type AsideStart = {
  sessionId: string;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  text: string;
  requestId: string;
};

type Options = {
  sessions: readonly Session[];
  /** Harnesses offered to Aside; usually the installed ones. */
  harnesses: readonly AsideHarness[];
  start: (start: AsideStart) => Promise<void>;
  /** Sends to an existing session; throws when it is gone or cannot take it. */
  send: (sessionId: string, text: string, requestId: string) => Promise<void>;
  stop: (sessionId: string) => void;
};

type RequestEvent = { id: string; stream: boolean; body: unknown };

type Turn = {
  sessionId: string;
  requestId: string;
  cursor: ReplyCursor;
  startedAt: number;
  reply: Reply;
};

/** How long a turn may take to start before Aside is told it failed. */
const START_LIMIT_MS = 90_000;
const MEMORY_ANSWER = "No new memories.";

/**
 * Writes one Aside reply in order. Pushes are chained so a slow IPC call never
 * reorders the stream; "gone" means Aside stopped listening.
 */
class Reply {
  private chain: Promise<void> = Promise.resolve();
  private text = "";
  private started = false;
  gone = false;

  constructor(
    private readonly id: string,
    private readonly stream: boolean,
    private readonly model: string,
    private readonly onGone: () => void,
  ) {}

  private push(data: string): void {
    this.chain = this.chain.then(async () => {
      if (this.gone) return;
      try {
        await invoke("aside_link_push", { id: this.id, data });
      } catch (error) {
        this.gone = true;
        if (String(error) !== "gone") console.warn("[aside-link] push failed:", error);
        this.onGone();
      }
    });
  }

  say(content: string, reasoning = ""): void {
    if (!this.stream) {
      this.text += content;
      return;
    }
    if (!this.started) {
      this.started = true;
      this.push(asideChunk(this.id, this.model, { role: "assistant", content: "" }));
    }
    if (reasoning) this.push(asideChunk(this.id, this.model, { reasoning_content: reasoning }));
    if (content) this.push(asideChunk(this.id, this.model, { content }));
  }

  finish(): void {
    if (this.stream) this.push(asideChunk(this.id, this.model, {}, "stop"));
    else this.push(asideCompletion(this.id, this.model, this.text));
    this.chain = this.chain.then(async () => {
      if (this.gone) return;
      await invoke("aside_link_finish", { id: this.id }).catch(() => undefined);
    });
  }
}

function catalogModel(harness: AsideHarness, modelId: string): AgentModel | undefined {
  return modelsFor(harness).find((model) => model.id === modelId && !model.locked);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fork (L-274): answers Aside's "Ask Aside" panel from this window. Each Aside
 * chat runs as a MonoCode session (see `asideConversations`), and its reply
 * streams back as the session fills in.
 */
export function useAsideLink(options: Options): void {
  const current = useRef(options);
  current.current = options;
  const turns = useRef(new Map<string, Turn>());
  const pump = useRef<() => void>(() => undefined);

  pump.current = () => {
    for (const [id, turn] of turns.current) {
      const session = current.current.sessions.find((entry) => entry.id === turn.sessionId);
      if (!session) continue;
      const step = replyProgress(session, turn.requestId, turn.cursor);
      turn.cursor = step.cursor;
      if (step.content || step.reasoning) turn.reply.say(step.content, step.reasoning);
      if (step.done) {
        turns.current.delete(id);
        turn.reply.finish();
      }
    }
  };
  useEffect(() => pump.current(), [options.sessions]);

  const harnessKey = options.harnesses.join(",");
  useEffect(() => {
    const models = Object.values(asideProviders(current.current.harnesses, modelsFor)).flatMap(
      (provider) => provider.models.map((model) => model.id),
    );
    const attach = () =>
      void invoke("aside_link_attach", { models }).catch((error: unknown) =>
        console.warn("[aside-link] attach failed:", error),
      );
    attach();
    window.addEventListener("focus", attach);
    return () => window.removeEventListener("focus", attach);
  }, [harnessKey]);

  useEffect(() => {
    let disposed = false;
    const live = turns.current;
    const runTurn = async (
      id: string,
      request: AsideRequest,
      work: Extract<AsideWork, { kind: "turn" }>,
      reply: Reply,
    ) => {
      const choice = parseAsideModelId(request.model);
      const model = choice && catalogModel(choice.harness, choice.modelId);
      if (!choice || !model)
        throw new Error("This model is no longer in MonoCode. Use “Add models to Aside” again.");
      const store = window.localStorage;
      const known = work.priorTexts.length
        ? findConversation(store, await conversationKey(request.model, work.priorTexts))
        : undefined;
      const requestId = `aside:${id}`;
      let sessionId = known;
      if (sessionId) {
        try {
          await current.current.send(sessionId, work.prompt, requestId);
        } catch (error) {
          console.info("[aside-link] starting a new session:", errorText(error));
          sessionId = undefined;
        }
      }
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        const effort = asideEffort(model, request.effort);
        const setting = modelEffortSetting(model);
        await current.current.start({
          sessionId,
          harness: choice.harness,
          model: model.id,
          modelSettings: {
            ...(effort && setting ? { [setting.id]: effort } : {}),
            ...(choice.harness === "claude" ? { claudeExecution: "interactive" } : {}),
          },
          text: promptWithHistory(work.prompt, work.priorTexts.length ? work.history : ""),
          requestId,
        });
      }
      rememberConversation(store, await conversationKey(request.model, work.texts), sessionId);
      if (work.droppedImages)
        reply.say("", "• Images aren't sent to MonoCode yet; answering from the text.\n");
      if (disposed || reply.gone) return;
      live.set(id, { sessionId, requestId, cursor: NEW_CURSOR, startedAt: Date.now(), reply });
      pump.current();
    };

    const handle = async ({ id, stream, body }: RequestEvent) => {
      const model =
        body && typeof body === "object" && "model" in body && typeof body.model === "string"
          ? body.model
          : "monocode";
      const reply = new Reply(id, stream, model, () => {
        const turn = live.get(id);
        live.delete(id);
        if (turn) current.current.stop(turn.sessionId);
      });
      try {
        const request = parseAsideRequest(body);
        const work = classifyAsideRequest(request);
        if (work.kind === "turn") return await runTurn(id, request, work, reply);
        reply.say(
          work.kind === "title" ? work.title : work.kind === "memory" ? MEMORY_ANSWER : work.message,
        );
      } catch (error) {
        reply.say(`⚠ ${errorText(error)}`);
      }
      reply.finish();
    };

    const unlistenRequest = listen<RequestEvent>("monocode-aside-request", (event) => {
      void handle(event.payload);
    });
    const unlistenCancel = listen<{ id: string }>("monocode-aside-cancel", (event) => {
      const turn = live.get(event.payload.id);
      if (!turn) return;
      live.delete(event.payload.id);
      turn.reply.gone = true;
      current.current.stop(turn.sessionId);
    });
    // A turn that never starts would leave Aside waiting until its own timeout.
    const timer = window.setInterval(() => {
      for (const [id, turn] of live) {
        if (turn.cursor.sawBusy || Date.now() - turn.startedAt < START_LIMIT_MS) continue;
        live.delete(id);
        turn.reply.say("⚠ MonoCode did not start this turn. Check the CLI project in MonoCode.");
        turn.reply.finish();
      }
    }, 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      void unlistenRequest.then((unlisten) => unlisten());
      void unlistenCancel.then((unlisten) => unlisten());
      for (const turn of live.values()) turn.reply.finish();
      live.clear();
      void invoke("aside_link_detach").catch(() => undefined);
    };
  }, []);
}
